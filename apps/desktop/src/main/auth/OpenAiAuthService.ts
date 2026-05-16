import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface, type Interface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OpenAiAuthStatus } from "@mauzai/shared";

type JsonRpcRequest = {
  method: string;
  id?: number | undefined;
  params?: unknown;
};

type JsonRpcResponse = {
  id?: number | undefined;
  result?: unknown;
  error?: {
    message?: string | undefined;
  };
  method?: string | undefined;
  params?: unknown;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

type CodexAccountReadResult = {
  account?: {
    type?: string | undefined;
    email?: string | undefined;
    planType?: string | undefined;
  } | null;
};

type CodexAuthFile = {
  authMode: string;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
};

type OpenAiAuthServiceOptions = {
  authFilePath?: string;
  codexCommandCandidates?: string[];
  readTextFile?: (path: string) => Promise<string>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

export class OpenAiAuthService {
  private readonly authFilePath: string;
  private readonly codexCommandCandidates: string[];
  private readonly readTextFile: (path: string) => Promise<string>;
  private pendingLogin: OpenAiAuthStatus | null = null;
  private pendingLoginClient: CodexAppServerClient | null = null;

  constructor(options: OpenAiAuthServiceOptions = {}) {
    this.authFilePath =
      options.authFilePath ?? join(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"), "auth.json");
    this.codexCommandCandidates = options.codexCommandCandidates ?? getDefaultCodexCommandCandidates();
    this.readTextFile = options.readTextFile ?? readFileUtf8;
  }

  async getStatus(): Promise<OpenAiAuthStatus> {
    if (this.pendingLogin !== null) {
      return this.pendingLogin;
    }

    const account = await this.readAccount(false);

    if (account?.account?.type === "chatgpt") {
      return {
        state: "connected",
        account: {
          type: "openai",
          ...(account.account.email === undefined ? {} : { email: account.account.email }),
          ...(account.account.planType === undefined ? {} : { planType: account.account.planType })
        }
      };
    }

    const authFile = await this.readCodexAuthFile();

    if (isUsableCodexChatGptAuth(authFile)) {
      return {
        state: "connected",
        account: {
          type: "openai"
        }
      };
    }

    return {
      state: "signed-out"
    };
  }

  async startLogin(): Promise<OpenAiAuthStatus> {
    const currentStatus = await this.getStatus();

    if (currentStatus.state === "connected" || currentStatus.state === "pending") {
      return currentStatus;
    }

    const codexCommand = this.getCodexCommand();

    if (codexCommand === null) {
      return {
        state: "unavailable",
        message: "Codex OpenAI auth is not installed on this Mac."
      };
    }

    const client = new CodexAppServerClient(codexCommand, (message) => this.handleNotification(message));

    try {
      await client.initialize();
      const result = parseLoginStartResult(
        await client.request("account/login/start", {
          type: "chatgptDeviceCode"
        })
      );

      if (result === null) {
        client.close();
        return {
          state: "unavailable",
          message: "Codex did not return an OpenAI login code."
        };
      }

      this.pendingLoginClient = client;
      this.pendingLogin = {
        state: "pending",
        loginId: result.loginId,
        verificationUrl: result.verificationUrl,
        userCode: result.userCode
      };

      return this.pendingLogin;
    } catch (error) {
      client.close();

      return {
        state: "unavailable",
        message: error instanceof Error ? error.message : "Could not start OpenAI login."
      };
    }
  }

  async getAccessToken(): Promise<string | undefined> {
    await this.readAccount(true).catch(() => null);

    return this.readCodexAuthFile().then((authFile) =>
      isUsableCodexChatGptAuth(authFile) ? authFile.accessToken : undefined
    );
  }

  dispose(): void {
    this.pendingLoginClient?.close();
    this.pendingLoginClient = null;
    this.pendingLogin = null;
  }

  private async readAccount(refreshToken: boolean): Promise<CodexAccountReadResult | null> {
    const codexCommand = this.getCodexCommand();

    if (codexCommand === null) {
      return null;
    }

    const client = new CodexAppServerClient(codexCommand);

    try {
      await client.initialize();
      return parseAccountReadResult(
        await client.request("account/read", {
          refreshToken
        })
      );
    } finally {
      client.close();
    }
  }

  private async readCodexAuthFile(): Promise<CodexAuthFile | null> {
    try {
      return parseCodexAuthJson(await this.readTextFile(this.authFilePath));
    } catch {
      return null;
    }
  }

  private handleNotification(message: JsonRpcResponse): void {
    if (message.method !== "account/login/completed") {
      return;
    }

    const params = message.params;

    if (typeof params !== "object" || params === null || !("success" in params)) {
      return;
    }

    const paramsRecord = params as Record<string, unknown>;

    if (paramsRecord.success === true) {
      this.pendingLogin = null;
    } else {
      this.pendingLogin = {
        state: "unavailable",
        message:
          typeof paramsRecord.error === "string" && paramsRecord.error.trim().length > 0
            ? paramsRecord.error
            : "OpenAI login did not complete."
      };
    }

    this.pendingLoginClient?.close();
    this.pendingLoginClient = null;
  }

  private getCodexCommand(): string | null {
    for (const candidate of this.codexCommandCandidates) {
      if (candidate === "codex" || existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}

class CodexAppServerClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private requestId = 0;
  private stderrTail = "";

  constructor(
    codexCommand: string,
    private readonly onNotification?: (message: JsonRpcResponse) => void
  ) {
    this.process = spawn(codexCommand, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.lines = createInterface({
      input: this.process.stdout
    });

    this.process.stderr.on("data", (data: Buffer) => {
      this.stderrTail = `${this.stderrTail}${data.toString("utf8")}`.slice(-1_200);
    });
    this.process.on("error", (error) => {
      this.rejectAll(error instanceof Error ? error : new Error("Could not start Codex app-server."));
    });
    this.process.on("exit", () => {
      this.rejectAll(new Error(this.getFailureMessage()));
    });
    this.lines.on("line", (line) => this.handleLine(line));
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "mauzai_desktop",
        title: "MauzAI",
        version: "0.1.0"
      }
    });
    this.send({
      method: "initialized",
      params: {}
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server timed out while handling ${method}.`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve,
        reject,
        timeout
      });
      this.send({
        method,
        id,
        ...(params === undefined ? {} : { params })
      });
    });
  }

  close(): void {
    this.lines.close();
    this.process.kill();
    this.rejectAll(new Error("Codex app-server closed."));
  }

  private send(message: JsonRpcRequest): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;

    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);

      if (pending === undefined) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(message.id);

      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message ?? "Codex app-server request failed."));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    this.onNotification?.(message);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private getFailureMessage(): string {
    const detail = this.stderrTail.trim();

    return detail.length > 0 ? detail : "Codex app-server exited before completing OpenAI auth.";
  }
}

export function parseCodexAuthJson(raw: string): CodexAuthFile | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const tokens = typeof record.tokens === "object" && record.tokens !== null ? record.tokens : null;
  const tokenRecord = tokens as Record<string, unknown> | null;
  const accessToken =
    typeof tokenRecord?.access_token === "string" && tokenRecord.access_token.trim().length > 0
      ? tokenRecord.access_token
      : undefined;
  const refreshToken =
    typeof tokenRecord?.refresh_token === "string" && tokenRecord.refresh_token.trim().length > 0
      ? tokenRecord.refresh_token
      : undefined;

  return {
    authMode: typeof record.auth_mode === "string" ? record.auth_mode : "",
    ...(accessToken === undefined ? {} : { accessToken }),
    ...(refreshToken === undefined ? {} : { refreshToken })
  };
}

function parseAccountReadResult(value: unknown): CodexAccountReadResult | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const account = (value as Record<string, unknown>).account;

  if (account !== null && (typeof account !== "object" || account === undefined)) {
    return null;
  }

  const accountRecord = account as Record<string, unknown> | null | undefined;
  const type = typeof accountRecord?.type === "string" ? accountRecord.type : undefined;
  const email = typeof accountRecord?.email === "string" ? accountRecord.email : undefined;
  const planType = typeof accountRecord?.planType === "string" ? accountRecord.planType : undefined;

  return {
    account:
      accountRecord === null || accountRecord === undefined
        ? null
        : {
            ...(type === undefined ? {} : { type }),
            ...(email === undefined ? {} : { email }),
            ...(planType === undefined ? {} : { planType })
          }
  };
}

function parseLoginStartResult(value: unknown): {
  type: "chatgptDeviceCode";
  loginId: string;
  verificationUrl: string;
  userCode: string;
} | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  const loginId = typeof record.loginId === "string" ? record.loginId : undefined;
  const verificationUrl = typeof record.verificationUrl === "string" ? record.verificationUrl : undefined;
  const userCode = typeof record.userCode === "string" ? record.userCode : undefined;

  if (
    type !== "chatgptDeviceCode" ||
    loginId === undefined ||
    verificationUrl === undefined ||
    userCode === undefined
  ) {
    return null;
  }

  return {
    type,
    loginId,
    verificationUrl,
    userCode
  };
}

function isUsableCodexChatGptAuth(authFile: CodexAuthFile | null): authFile is CodexAuthFile & {
  accessToken: string;
  refreshToken: string;
} {
  return (
    authFile !== null &&
    authFile.authMode === "chatgpt" &&
    authFile.accessToken !== undefined &&
    authFile.refreshToken !== undefined
  );
}

function getDefaultCodexCommandCandidates(): string[] {
  return [
    process.env.MAUZ_CODEX_PATH?.trim(),
    "/Applications/Codex.app/Contents/Resources/codex",
    join(homedir(), "Applications/Codex.app/Contents/Resources/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "codex"
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}
