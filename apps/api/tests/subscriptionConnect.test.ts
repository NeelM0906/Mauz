import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { SubscriptionConnectState } from "@mauzai/shared";
import type { ChildProcessLike, SpawnLike } from "../src/providers/processRunner";
import { SubscriptionConnector } from "../src/providers/subscriptionConnect";

type ControlledChild = ChildProcessLike & {
  stdinText: () => string;
  print: (text: string) => void;
  exit: (code: number) => void;
};

function createControlledChild(): ControlledChild {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let received = "";
  stdin.on("data", (chunk: Buffer) => {
    received += chunk.toString("utf8");
  });

  const child: ControlledChild = {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    killed: false,
    kill() {
      child.killed = true;
      child.exit(1);
      return true;
    },
    once(event: string, listener: (...args: never[]) => void) {
      events.once(event, listener as (...args: unknown[]) => void);
      return child;
    },
    stdinText: () => received,
    print: (text) => stdout.write(text),
    exit(code) {
      if (child.exitCode !== null) {
        return;
      }

      child.exitCode = code;
      stdout.end();
      stderr.end();
      setImmediate(() => events.emit("close", code));
    }
  };

  return child;
}

function setup(options: { installed?: boolean } = {}) {
  const children: Array<{ command: string; args: readonly string[]; child: ControlledChild }> = [];
  const states: SubscriptionConnectState[] = [];
  let installed = options.installed ?? true;
  const spawn: SpawnLike = (command, args) => {
    const child = createControlledChild();
    children.push({ command, args, child });
    return child;
  };
  const onAuthChanged = vi.fn(async () => {});
  const connector = new SubscriptionConnector({
    env: () => ({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-should-not-leak" }),
    spawn,
    resolveCommand: (name) => (installed ? { command: name, args: [] } : null),
    resolveNpm: () => ({ command: "npm", args: [] }),
    onAuthChanged,
    onState: (state) => states.push(state)
  });

  return {
    connector,
    children,
    states,
    onAuthChanged,
    markInstalled: () => {
      installed = true;
    }
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("SubscriptionConnector", () => {
  it("runs Codex device sign-in and reports the link and code", async () => {
    const { connector, children, states, onAuthChanged } = setup();

    connector.connect("codex");
    await tick();

    expect(children[0]?.args).toEqual(["login", "--device-auth"]);
    children[0]!.child.print(
      "1. Open this link\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n2. Enter this one-time code\n   \u001b[94mAB12-CD34E\u001b[0m\n"
    );
    await tick();

    expect(states.at(-1)).toMatchObject({
      phase: "waiting",
      url: "https://auth.openai.com/codex/device",
      userCode: "AB12-CD34E",
      acceptsPastedCode: false
    });

    children[0]!.child.exit(0);
    await tick();

    expect(onAuthChanged).toHaveBeenCalled();
    expect(states.at(-1)?.phase).toBe("connected");
  });

  it("forwards a pasted Claude Code sign-in code to the CLI", async () => {
    const { connector, children, states } = setup();

    const started = connector.connect("claude-code");
    await tick();

    expect(children[0]?.args).toEqual(["auth", "login", "--claudeai"]);
    children[0]!.child.print(
      "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc\nPaste code here if prompted > "
    );
    await tick();

    expect(states.at(-1)).toMatchObject({
      phase: "waiting",
      url: "https://claude.com/cai/oauth/authorize?code=true&state=abc",
      acceptsPastedCode: true,
      userCode: null
    });

    connector.submitCode(started.connectId, "  pasted-code#state  ");
    await tick();

    expect(children[0]!.child.stdinText()).toBe("pasted-code#state\n");
  });

  it("keeps API keys away from the sign-in so the subscription is used", async () => {
    const env: NodeJS.ProcessEnv[] = [];
    const connector = new SubscriptionConnector({
      env: () => ({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-should-not-leak", MAUZ_INSTALL_ID: "x" }),
      spawn: (_command, _args, options) => {
        env.push(options.env);
        return createControlledChild();
      },
      resolveCommand: (name) => ({ command: name, args: [] }),
      onAuthChanged: async () => {},
      onState: () => {}
    });

    connector.connect("claude-code");
    await tick();

    expect(env[0]?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env[0]?.MAUZ_INSTALL_ID).toBeUndefined();
    connector.dispose();
  });

  it("installs a missing CLI with npm before signing in", async () => {
    const { connector, children, states, markInstalled } = setup({ installed: false });

    connector.connect("codex");
    await tick();

    expect(states.at(-1)?.phase).toBe("installing");
    expect(children[0]).toMatchObject({ command: "npm", args: ["install", "--global", "@openai/codex"] });

    markInstalled();
    children[0]!.child.exit(0);
    await tick();

    expect(children[1]?.args).toEqual(["login", "--device-auth"]);
    connector.dispose();
  });

  it("reports a failed sign-in with the CLI's last message", async () => {
    const { connector, children, states } = setup();

    connector.connect("codex");
    await tick();
    children[0]!.child.print("Error: device code expired\n");
    children[0]!.child.exit(1);
    await tick();

    expect(states.at(-1)).toMatchObject({ phase: "failed", message: "Error: device code expired" });
  });

  it("stops the CLI when sign-in is cancelled", async () => {
    const { connector, children, states } = setup();

    const started = connector.connect("codex");
    await tick();
    connector.cancel(started.connectId);
    await tick();

    expect(children[0]!.child.killed).toBe(true);
    expect(states.at(-1)?.phase).toBe("cancelled");
  });
});
