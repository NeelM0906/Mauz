import { tmpdir } from "node:os";
import {
  AiProviderPreferenceSchema,
  type AiProviderId,
  type AiProviderPreference,
  type AiProviderStatus,
  type AiProvidersStatusResponse
} from "@mauzai/shared";
import { NoAiProviderError } from "../errors";
import { AnthropicApiProvider, DEFAULT_ANTHROPIC_ASK_MODEL } from "./anthropicProvider";
import { ClaudeCodeProvider, DEFAULT_CLAUDE_CODE_MODEL } from "./claudeCodeProvider";
import { buildCliEnvironment, resolveCliCommand, type ResolvedCliCommand } from "./cliCommand";
import { CodexProvider } from "./codexProvider";
import { DEFAULT_OPENAI_ASK_MODEL, OpenAiApiProvider } from "./openaiProvider";
import { parseJsonLine, runAndCollect, spawnCliProcess, type SpawnLike } from "./processRunner";
import type { AskProvider, ProviderDetection } from "./types";

/**
 * Auto order, used only when the default is "auto" and several providers are ready: a key
 * the user added on purpose wins, then the subscriptions they are already signed in to.
 */
const AUTO_PROVIDER_ORDER: readonly AiProviderId[] = ["anthropic", "openai", "claude-code", "codex"];

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  "claude-code": "Claude Code subscription",
  codex: "Codex (ChatGPT) subscription",
  anthropic: "Anthropic API key",
  openai: "OpenAI API key"
};

const CLI_DETECTION_TTL_MS = 5 * 60_000;
const CLI_STATUS_TIMEOUT_MS = 15_000;

type AskProviderRegistryOptions = {
  env?: () => NodeJS.ProcessEnv;
  spawn?: SpawnLike;
  resolveCommand?: (name: string, env: NodeJS.ProcessEnv) => ResolvedCliCommand | null;
};

type CliDetectionCache = {
  detectedAt: number;
  promise: Promise<Record<"claude-code" | "codex", ProviderDetection>>;
};

export class AskProviderRegistry {
  private readonly readEnv: () => NodeJS.ProcessEnv;
  private readonly spawnProcess: SpawnLike;
  private readonly resolveCommand: (name: string, env: NodeJS.ProcessEnv) => ResolvedCliCommand | null;
  private readonly providers: Record<AiProviderId, AskProvider>;
  private cliDetection: CliDetectionCache | null = null;
  private lastCliDetection: Record<"claude-code" | "codex", ProviderDetection> | null = null;

  constructor(options: AskProviderRegistryOptions = {}) {
    this.readEnv = options.env ?? (() => process.env);
    this.spawnProcess = options.spawn ?? spawnCliProcess;
    this.resolveCommand = options.resolveCommand ?? resolveCliCommandForMauz;
    this.providers = {
      "claude-code": new ClaudeCodeProvider({ env: this.readEnv }),
      codex: new CodexProvider({ env: this.readEnv }),
      anthropic: new AnthropicApiProvider({ env: this.readEnv }),
      openai: new OpenAiApiProvider({ env: this.readEnv })
    };
  }

  /** Detects every provider; CLI sign-in checks are cached because each takes a couple of seconds. */
  async getStatus(options: { refresh?: boolean } = {}): Promise<AiProvidersStatusResponse> {
    const cli = await this.detectCliProviders(options.refresh === true);
    const env = this.readEnv();
    const providers = listProviders(cli, env);
    const preference = readPreference(env.MAUZ_AI_PROVIDER);

    return {
      preference,
      activeProviderId: pickProvider(preference, providers)?.id ?? null,
      providers
    };
  }

  /** Returns the provider that should answer now, or explains why none can. */
  async resolve(): Promise<AskProvider> {
    const status = await this.getStatus();

    if (status.activeProviderId !== null) {
      return this.providers[status.activeProviderId];
    }

    if (status.preference !== "auto") {
      const selected = status.providers.find((provider) => provider.id === status.preference);
      throw new NoAiProviderError(
        `${PROVIDER_LABELS[status.preference]} is selected in Settings but not ready: ${selected?.detail ?? "unavailable"}`
      );
    }

    throw new NoAiProviderError();
  }

  /**
   * Starts slow provider setup ahead of a likely question. Uses cached detection only,
   * so it never blocks the caller.
   */
  prewarm(systemPrompt: string): void {
    const cli = this.lastCliDetection;

    if (cli === null) {
      void this.detectCliProviders(false).catch(() => {});
      return;
    }

    const env = this.readEnv();
    const active = pickProvider(readPreference(env.MAUZ_AI_PROVIDER), listProviders(cli, env));

    if (active !== null) {
      this.providers[active.id].prewarm?.(systemPrompt);
    }
  }

  dispose(): void {
    for (const provider of Object.values(this.providers)) {
      provider.dispose?.();
    }
  }

  private detectCliProviders(refresh: boolean): Promise<Record<"claude-code" | "codex", ProviderDetection>> {
    const cached = this.cliDetection;

    if (!refresh && cached !== null && Date.now() - cached.detectedAt < CLI_DETECTION_TTL_MS) {
      return cached.promise;
    }

    const promise = Promise.all([this.detectClaudeCode(), this.detectCodex()]).then(([claudeCode, codex]) => {
      const detection = { "claude-code": claudeCode, codex };
      this.lastCliDetection = detection;
      return detection;
    });

    this.cliDetection = { detectedAt: Date.now(), promise };
    promise.catch(() => {
      if (this.cliDetection?.promise === promise) {
        this.cliDetection = null;
      }
    });

    return promise;
  }

  private async detectClaudeCode(): Promise<ProviderDetection> {
    const env = this.readEnv();
    const model = env.MAUZ_CLAUDE_CODE_MODEL?.trim() || DEFAULT_CLAUDE_CODE_MODEL;
    const command = this.resolveCommand("claude", env);

    if (command === null) {
      return { available: false, detail: "Claude Code is not installed.", model };
    }

    try {
      const output = await this.runStatusCommand(command, ["auth", "status"]);
      const status = parseJsonLine(output.stdout.trim());

      if (status?.loggedIn === true) {
        const plan = typeof status.subscriptionType === "string" ? ` (${status.subscriptionType} plan)` : "";
        return { available: true, detail: `Signed in${plan}.`, model };
      }

      return { available: false, detail: "Not signed in. Run `claude` in a terminal to sign in.", model };
    } catch (error) {
      return { available: false, detail: describeDetectionError("Claude Code", error), model };
    }
  }

  private async detectCodex(): Promise<ProviderDetection> {
    const env = this.readEnv();
    const model = env.MAUZ_CODEX_MODEL?.trim() || "default";
    const command = this.resolveCommand("codex", env);

    if (command === null) {
      return { available: false, detail: "Codex is not installed.", model };
    }

    try {
      const output = await this.runStatusCommand(command, ["login", "status"]);
      const statusText = `${output.stdout}\n${output.stderr}`.trim();
      const loggedIn = /logged in/i.test(statusText) && !/not logged in/i.test(statusText);

      if (loggedIn) {
        const via = /using (chatgpt|an api key)/i.exec(statusText)?.[1];
        return {
          available: true,
          detail: via === undefined ? "Signed in." : `Signed in with ${via}.`,
          model
        };
      }

      return { available: false, detail: "Not signed in. Run `codex login` in a terminal.", model };
    } catch (error) {
      return { available: false, detail: describeDetectionError("Codex", error), model };
    }
  }

  private async runStatusCommand(
    command: ResolvedCliCommand,
    subcommand: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    const child = this.spawnProcess(command.command, [...command.args, ...subcommand], {
      cwd: tmpdir(),
      env: { ...buildCliEnvironment(this.readEnv()), ...command.env }
    });

    return runAndCollect(child, { timeoutMs: CLI_STATUS_TIMEOUT_MS });
  }
}

/** Resolves a CLI; inside Electron, npm JS shims can run on Electron itself when Node.js is missing. */
export function resolveCliCommandForMauz(name: string, env: NodeJS.ProcessEnv): ResolvedCliCommand | null {
  return resolveCliCommand(name, {
    env,
    fallbackNodeRuntime: process.versions.electron === undefined ? undefined : process.execPath
  });
}

/** Every provider's status, in AUTO_PROVIDER_ORDER. */
function listProviders(
  cli: Record<"claude-code" | "codex", ProviderDetection>,
  env: NodeJS.ProcessEnv
): AiProviderStatus[] {
  const detections: Record<AiProviderId, ProviderDetection> = {
    ...cli,
    anthropic: detectApiKey(env.ANTHROPIC_API_KEY, env.ANTHROPIC_ASK_MODEL, DEFAULT_ANTHROPIC_ASK_MODEL),
    openai: detectApiKey(env.OPENAI_API_KEY, env.OPENAI_ASK_MODEL, DEFAULT_OPENAI_ASK_MODEL)
  };

  return AUTO_PROVIDER_ORDER.map((id) => ({ id, label: PROVIDER_LABELS[id], ...detections[id] }));
}

/**
 * The selected provider when it is ready; with "auto", the first ready one.
 * `providers` must be in AUTO_PROVIDER_ORDER, as `listProviders` returns them.
 */
export function pickProvider(
  preference: AiProviderPreference,
  providers: readonly AiProviderStatus[]
): AiProviderStatus | null {
  const ready = providers.filter((provider) => provider.available);

  return (preference === "auto" ? ready[0] : ready.find((provider) => provider.id === preference)) ?? null;
}

function readPreference(value: string | undefined): AiProviderPreference {
  return AiProviderPreferenceSchema.catch("auto").parse(value?.trim());
}

function detectApiKey(
  apiKey: string | undefined,
  configuredModel: string | undefined,
  defaultModel: string
): ProviderDetection {
  const model = configuredModel?.trim() || defaultModel;

  return apiKey?.trim()
    ? { available: true, detail: "API key configured.", model }
    : { available: false, detail: "No API key added.", model };
}

function describeDetectionError(name: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = message.length <= 120 ? message : `${message.slice(0, 117)}...`;

  return `Could not check ${name} sign-in: ${detail}`;
}

let defaultRegistry: AskProviderRegistry | null = null;

export function getDefaultAskProviderRegistry(): AskProviderRegistry {
  defaultRegistry ??= new AskProviderRegistry();
  return defaultRegistry;
}
