import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { SubscriptionConnectState, SubscriptionProviderId } from "@mauzai/shared";
import { buildCliEnvironment, resolveNpmCommand, type ResolvedCliCommand } from "./cliCommand";
import {
  killQuietly,
  runAndCollect,
  spawnCliProcess,
  type ChildProcessLike,
  type SpawnLike
} from "./processRunner";

type SubscriptionCli = {
  label: string;
  /** Command name; its MAUZ_*_PATH variable can override it (see resolveCliCommand). */
  command: string;
  npmPackage: string;
  loginArgs: readonly string[];
  logoutArgs: readonly string[];
  acceptsPastedCode: boolean;
};

const SUBSCRIPTION_CLIS: Record<SubscriptionProviderId, SubscriptionCli> = {
  "claude-code": {
    label: "Claude Code",
    command: "claude",
    npmPackage: "@anthropic-ai/claude-code",
    loginArgs: ["auth", "login", "--claudeai"],
    logoutArgs: ["auth", "logout"],
    // Claude Code opens the browser itself; when that fails the page shows a code to paste back.
    acceptsPastedCode: true
  },
  codex: {
    label: "Codex",
    command: "codex",
    npmPackage: "@openai/codex",
    // Device sign-in prints a link and a one-time code, then finishes once the user approves.
    loginArgs: ["login", "--device-auth"],
    logoutArgs: ["logout"],
    acceptsPastedCode: false
  }
};

const LOGIN_TIMEOUT_MS = 15 * 60_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const LOGOUT_TIMEOUT_MS = 30_000;
const URL_PATTERN = /https:\/\/[^\s"'<>\u001b]+/;
const DEVICE_CODE_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/;
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

export type SubscriptionConnectorOptions = {
  env?: () => NodeJS.ProcessEnv;
  spawn?: SpawnLike;
  resolveCommand: (name: string, env: NodeJS.ProcessEnv) => ResolvedCliCommand | null;
  resolveNpm?: (env: NodeJS.ProcessEnv) => ResolvedCliCommand | null;
  /** Called after a sign-in or sign-out changes what is available. */
  onAuthChanged: () => Promise<unknown>;
  onState: (state: SubscriptionConnectState) => void;
};

type ConnectSession = {
  state: SubscriptionConnectState;
  child: ChildProcessLike | null;
  cancelled: boolean;
};

/**
 * Connects a Claude Code or Codex subscription from inside Mauz: installs the CLI when it is
 * missing, then runs the CLI's own sign-in so credentials stay with the CLI, exactly as if the
 * user had signed in from a terminal.
 */
export class SubscriptionConnector {
  private readonly readEnv: () => NodeJS.ProcessEnv;
  private readonly spawnProcess: SpawnLike;
  private readonly resolveCommand: SubscriptionConnectorOptions["resolveCommand"];
  private readonly resolveNpm: (env: NodeJS.ProcessEnv) => ResolvedCliCommand | null;
  private readonly onAuthChanged: () => Promise<unknown>;
  private readonly onState: (state: SubscriptionConnectState) => void;
  private readonly sessions = new Map<string, ConnectSession>();

  constructor(options: SubscriptionConnectorOptions) {
    this.readEnv = options.env ?? (() => process.env);
    this.spawnProcess = options.spawn ?? spawnCliProcess;
    this.resolveCommand = options.resolveCommand;
    this.resolveNpm = options.resolveNpm ?? ((env) => resolveNpmCommand({ env }));
    this.onAuthChanged = options.onAuthChanged;
    this.onState = options.onState;
  }

  /** Starts connecting; progress is reported through `onState`. */
  connect(providerId: SubscriptionProviderId): SubscriptionConnectState {
    for (const session of this.sessions.values()) {
      if (session.state.providerId === providerId) {
        this.cancelSession(session);
      }
    }

    const session: ConnectSession = {
      state: {
        connectId: randomUUID(),
        providerId,
        phase: "starting",
        url: null,
        userCode: null,
        acceptsPastedCode: false,
        message: null
      },
      child: null,
      cancelled: false
    };

    this.sessions.set(session.state.connectId, session);
    void this.run(session);

    return session.state;
  }

  submitCode(connectId: string, code: string): void {
    const stdin = this.sessions.get(connectId)?.child?.stdin;

    if (stdin === null || stdin === undefined) {
      throw new Error("This sign-in is no longer waiting for a code.");
    }

    stdin.write(`${code.trim()}\n`);
  }

  cancel(connectId: string): void {
    const session = this.sessions.get(connectId);

    if (session !== undefined) {
      this.cancelSession(session);
    }
  }

  getState(connectId: string): SubscriptionConnectState | null {
    return this.sessions.get(connectId)?.state ?? null;
  }

  async disconnect(providerId: SubscriptionProviderId): Promise<void> {
    const cli = SUBSCRIPTION_CLIS[providerId];
    const env = this.readEnv();
    const command = this.resolveCommand(cli.command, env);

    if (command === null) {
      return;
    }

    const output = await runAndCollect(this.spawnCli(command, cli.logoutArgs), {
      timeoutMs: LOGOUT_TIMEOUT_MS
    });

    await this.onAuthChanged();

    if (output.exitCode !== 0) {
      throw new Error(lastLine(`${output.stderr}\n${output.stdout}`) ?? `${cli.label} could not sign out.`);
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      this.cancelSession(session);
    }
  }

  private async run(session: ConnectSession): Promise<void> {
    const cli = SUBSCRIPTION_CLIS[session.state.providerId];

    try {
      let command = this.resolveCommand(cli.command, this.readEnv());

      if (command === null) {
        command = await this.install(session, cli);
      }

      if (command === null || session.cancelled) {
        return;
      }

      await this.login(session, cli, command);
    } catch (error) {
      if (!session.cancelled) {
        this.update(session, {
          phase: "failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      session.child = null;
    }
  }

  private async install(session: ConnectSession, cli: SubscriptionCli): Promise<ResolvedCliCommand | null> {
    const env = this.readEnv();
    const npm = this.resolveNpm(env);

    if (npm === null) {
      this.update(session, {
        phase: "failed",
        message: `${cli.label} is not installed, and npm was not found to install it. Install Node.js, then try again.`
      });
      return null;
    }

    this.update(session, { phase: "installing", message: `Installing ${cli.label}...` });

    const child = this.spawnCli(npm, ["install", "--global", cli.npmPackage]);
    session.child = child;
    const output = await runAndCollect(child, { timeoutMs: INSTALL_TIMEOUT_MS });
    session.child = null;

    if (session.cancelled) {
      return null;
    }

    if (output.exitCode !== 0) {
      throw new Error(
        `Could not install ${cli.label}: ${lastLine(output.stderr) ?? `npm exited with code ${output.exitCode}`}`
      );
    }

    const command = this.resolveCommand(cli.command, this.readEnv());

    if (command === null) {
      throw new Error(`${cli.label} was installed, but Mauz cannot find it yet. Restart Mauz and try again.`);
    }

    return command;
  }

  private login(session: ConnectSession, cli: SubscriptionCli, command: ResolvedCliCommand): Promise<void> {
    this.update(session, { phase: "starting", message: `Starting ${cli.label} sign-in...` });

    const child = this.spawnCli(command, cli.loginArgs);
    session.child = child;

    return new Promise((resolve) => {
      let output = "";
      const timer = setTimeout(() => {
        killQuietly(child);
        this.update(session, { phase: "failed", message: "Sign-in timed out. Try again." });
      }, LOGIN_TIMEOUT_MS);

      const onOutput = (chunk: Buffer): void => {
        output += chunk.toString("utf8").replace(ANSI_PATTERN, "");

        if (session.state.url !== null) {
          return;
        }

        const url = URL_PATTERN.exec(output)?.[0];

        if (url !== undefined) {
          this.update(session, {
            phase: "waiting",
            url,
            userCode: cli.acceptsPastedCode ? null : (DEVICE_CODE_PATTERN.exec(output)?.[0] ?? null),
            acceptsPastedCode: cli.acceptsPastedCode,
            message: null
          });
        }
      };

      child.stdout?.on("data", onOutput);
      child.stderr?.on("data", onOutput);
      child.stdin?.on("error", () => {
        // The CLI may exit before reading a pasted code; the close handler reports the outcome.
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        this.update(session, { phase: "failed", message: error.message });
        resolve();
      });
      child.once("close", (code) => {
        clearTimeout(timer);

        if (session.cancelled || session.state.phase === "failed") {
          resolve();
          return;
        }

        if (code === 0) {
          void this.onAuthChanged()
            .catch(() => {})
            .finally(() => {
              this.update(session, { phase: "connected", message: `${cli.label} is connected.` });
              resolve();
            });
          return;
        }

        this.update(session, {
          phase: "failed",
          message: lastLine(output) ?? `${cli.label} sign-in did not finish (exit code ${code}).`
        });
        resolve();
      });
    });
  }

  private spawnCli(command: ResolvedCliCommand, args: readonly string[]): ChildProcessLike {
    return this.spawnProcess(command.command, [...command.args, ...args], {
      cwd: tmpdir(),
      env: { ...buildCliEnvironment(this.readEnv()), ...command.env }
    });
  }

  private cancelSession(session: ConnectSession): void {
    if (session.state.phase === "connected" || session.state.phase === "failed") {
      this.sessions.delete(session.state.connectId);
      return;
    }

    session.cancelled = true;

    if (session.child !== null) {
      killQuietly(session.child);
    }

    this.update(session, { phase: "cancelled", message: null });
    this.sessions.delete(session.state.connectId);
  }

  private update(session: ConnectSession, patch: Partial<SubscriptionConnectState>): void {
    session.state = { ...session.state, ...patch };
    this.onState(session.state);
  }
}

function lastLine(text: string): string | null {
  const lines = text
    .replace(ANSI_PATTERN, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("npm warn"));
  const line = lines.at(-1);

  if (line === undefined) {
    return null;
  }

  return line.length <= 300 ? line : `${line.slice(0, 297)}...`;
}
