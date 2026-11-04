import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AiProviderStatus, AskMauzRequest } from "@mauzai/shared";
import { AiProviderError, NoAiProviderError } from "../src/errors";
import { askMauz, buildAnswerPrompt } from "../src/openai/askMauz";
import { ClaudeCodeProvider } from "../src/providers/claudeCodeProvider";
import { buildCliEnvironment, resolveCliCommand } from "../src/providers/cliCommand";
import { parseCodexOutput } from "../src/providers/codexProvider";
import type { ChildProcessLike, SpawnLike } from "../src/providers/processRunner";
import { AnswerProviderRegistry, pickProvider } from "../src/providers/registry";
import type { AnswerPrompt, AnswerProvider } from "../src/providers/types";

type FakeRun = {
  stdoutLines: string[];
  exitCode?: number;
  stderr?: string;
};

type FakeChild = ChildProcessLike & {
  stdinText(): string;
};

function createFakeChild(respond: (stdinText: string) => FakeRun): FakeChild {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let received = "";
  const child = {
    stdin,
    stdout,
    stderr,
    exitCode: null as number | null,
    killed: false,
    kill() {
      child.killed = true;
      finish(1);
      return true;
    },
    once(event: string, listener: (...args: never[]) => void) {
      events.once(event, listener as (...args: unknown[]) => void);
      return child;
    },
    stdinText: () => received
  };
  const finish = (code: number): void => {
    if (child.exitCode !== null) {
      return;
    }

    child.exitCode = code;
    stdout.end();
    stderr.end();
    events.emit("exit", code);
    setImmediate(() => events.emit("close", code));
  };

  stdin.on("data", (chunk: Buffer) => {
    received += chunk.toString("utf8");
  });
  stdin.on("end", () => {
    const run = respond(received);

    for (const line of run.stdoutLines) {
      stdout.write(`${line}\n`);
    }

    if (run.stderr !== undefined) {
      stderr.write(run.stderr);
    }

    finish(run.exitCode ?? 0);
  });

  return child as unknown as FakeChild;
}

const PROMPT: AnswerPrompt = {
  systemPrompt: "system",
  userText: "What is this?",
  images: [{ mimeType: "image/jpeg", base64: "aW1n", label: "Image 1: cursor crop" }]
};

function claudeSuccessLines(text: string): string[] {
  return [
    JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-5-5" }),
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(0, 4) } }
    }),
    JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(4) } }
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      usage: { output_tokens: 3 }
    })
  ];
}

describe("resolveCliCommand", () => {
  it("prefers a Windows .exe on PATH", () => {
    const resolved = resolveCliCommand("claude", {
      platform: "win32",
      env: { PATH: "C:\\tools;C:\\Users\\me\\.local\\bin" },
      homeDirectory: "C:\\Users\\me",
      pathExists: (path) => path === "C:\\Users\\me\\.local\\bin\\claude.exe"
    });

    expect(resolved).toEqual({ command: "C:\\Users\\me\\.local\\bin\\claude.exe", args: [] });
  });

  it("turns an npm .cmd shim into node plus the package entry script", () => {
    const shim = '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
    const resolved = resolveCliCommand("codex", {
      platform: "win32",
      env: { PATH: "C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs" },
      homeDirectory: "C:\\Users\\me",
      pathExists: (path) =>
        [
          "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd",
          "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
          "C:\\Program Files\\nodejs\\node.exe"
        ].includes(path),
      readTextFile: () => shim
    });

    expect(resolved).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"]
    });
  });

  it("falls back to running the shim's script with Electron as Node when node is missing", () => {
    const shim = '"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
    const resolved = resolveCliCommand("codex", {
      platform: "win32",
      env: { PATH: "C:\\npm" },
      homeDirectory: "C:\\Users\\me",
      pathExists: (path) =>
        path === "C:\\npm\\codex.cmd" || path === "C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
      readTextFile: () => shim,
      fallbackNodeRuntime: "C:\\Mauz\\electron.exe"
    });

    expect(resolved?.command).toBe("C:\\Mauz\\electron.exe");
    expect(resolved?.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
  });

  it("searches common install locations that GUI launches miss on macOS", () => {
    const resolved = resolveCliCommand("claude", {
      platform: "darwin",
      env: { PATH: "/usr/bin:/bin" },
      homeDirectory: "/Users/me",
      pathExists: (path) => path === "/Users/me/.local/bin/claude"
    });

    expect(resolved?.command).toBe("/Users/me/.local/bin/claude");
  });

  it("returns null when the CLI is not installed", () => {
    expect(
      resolveCliCommand("codex", { platform: "linux", env: { PATH: "/usr/bin" }, pathExists: () => false })
    ).toBeNull();
  });
});

describe("buildCliEnvironment", () => {
  it("removes Mauz internals and requested credentials", () => {
    const env = buildCliEnvironment(
      { PATH: "/bin", MAUZ_LOCAL_API_TOKEN: "secret", ANTHROPIC_API_KEY: "sk-ant", HOME: "/home/me" },
      ["ANTHROPIC_API_KEY"]
    );

    expect(env).toEqual({ PATH: "/bin", HOME: "/home/me" });
  });
});

describe("ClaudeCodeProvider", () => {
  it("sends images over stream-json, streams text, and reports the model", async () => {
    const children: FakeChild[] = [];
    const spawn: SpawnLike = vi.fn(() => {
      const child = createFakeChild(() => ({ stdoutLines: claudeSuccessLines("It is a chart.") }));
      children.push(child);
      return child;
    });
    const provider = new ClaudeCodeProvider({
      spawn,
      resolveCommand: () => ({ command: "claude", args: [] }),
      env: () => ({ ANTHROPIC_API_KEY: "sk-ant-should-not-leak", PATH: "/bin" }),
      makeWorkingDirectory: () => "/tmp"
    });
    const updates: string[] = [];

    const result = await provider.answer(PROMPT, { onText: (text) => updates.push(text) });

    expect(result).toMatchObject({ text: "It is a chart.", model: "claude-sonnet-5-5" });
    expect(updates).toEqual(["It i", "It is a chart."]);
    const [, args, options] = (spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["-p", "--tools", "", "--no-session-persistence"]));
    expect(args).toContain("--strict-mcp-config");
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    const sent = JSON.parse(children[0]!.stdinText().trim()) as {
      message: { content: Array<{ type: string }> };
    };
    expect(sent.message.content.map((block) => block.type)).toEqual(["text", "image", "text"]);
  });

  it("reuses a prewarmed process for the next answer", async () => {
    const spawn: SpawnLike = vi.fn(() =>
      createFakeChild(() => ({ stdoutLines: claudeSuccessLines("Prewarmed.") }))
    );
    const provider = new ClaudeCodeProvider({
      spawn,
      resolveCommand: () => ({ command: "claude", args: [] }),
      env: () => ({}),
      makeWorkingDirectory: () => "/tmp"
    });

    provider.prewarm(PROMPT.systemPrompt);
    const result = await provider.answer(PROMPT);

    expect(result.text).toBe("Prewarmed.");
    expect(spawn).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it("explains how to sign in when the CLI reports an auth error", async () => {
    const provider = new ClaudeCodeProvider({
      spawn: () =>
        createFakeChild(() => ({
          stdoutLines: [
            JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: true,
              result: "Invalid API key · Please run /login"
            })
          ],
          exitCode: 1
        })),
      resolveCommand: () => ({ command: "claude", args: [] }),
      env: () => ({}),
      makeWorkingDirectory: () => "/tmp"
    });

    await expect(provider.answer(PROMPT)).rejects.toThrow(/isn't signed in/);
  });

  it("reports a missing CLI as a provider error", async () => {
    const provider = new ClaudeCodeProvider({ resolveCommand: () => null, env: () => ({}) });

    await expect(provider.answer(PROMPT)).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("parseCodexOutput", () => {
  it("reads the final agent message and usage from JSONL events", () => {
    const parsed = parseCodexOutput(
      [
        JSON.stringify({ type: "thread.started", thread_id: "t1" }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: " It says 4817. " } }),
        JSON.stringify({ type: "turn.completed", usage: { output_tokens: 6 } })
      ].join("\n")
    );

    expect(parsed).toEqual({ text: "It says 4817.", error: undefined, usage: { output_tokens: 6 } });
  });

  it("captures turn failures", () => {
    const parsed = parseCodexOutput(
      JSON.stringify({ type: "turn.failed", error: { message: "usage limit" } })
    );

    expect(parsed.text).toBe("");
    expect(parsed.error).toBe("usage limit");
  });
});

describe("pickProvider", () => {
  const providers = (available: Record<string, boolean>): AiProviderStatus[] =>
    (["anthropic", "openai", "claude-code", "codex"] as const).map((id) => ({
      id,
      label: id,
      kind: id === "anthropic" || id === "openai" ? "api-key" : "subscription",
      available: available[id] === true,
      detail: "",
      model: "m"
    }));

  it("prefers an API key the user added, then subscriptions", () => {
    expect(pickProvider("auto", providers({ "claude-code": true, openai: true }))?.id).toBe("openai");
    expect(pickProvider("auto", providers({ "claude-code": true, codex: true }))?.id).toBe("claude-code");
  });

  it("honors an explicit choice only when that provider is ready", () => {
    expect(pickProvider("codex", providers({ codex: true, anthropic: true }))?.id).toBe("codex");
    expect(pickProvider("codex", providers({ anthropic: true }))).toBeNull();
  });
});

describe("AnswerProviderRegistry", () => {
  function createRegistry(env: NodeJS.ProcessEnv, cliStatus: { claude: string; codex: string }) {
    const spawn: SpawnLike = (_command, args) =>
      createFakeChild(() =>
        args.includes("auth") ? { stdoutLines: [cliStatus.claude] } : { stdoutLines: [cliStatus.codex] }
      );

    return new AnswerProviderRegistry({
      env: () => env,
      spawn,
      resolveCommand: (name) => ({ command: name, args: [] })
    });
  }

  it("detects signed-in subscriptions and picks Claude Code automatically", async () => {
    const registry = createRegistry(
      {},
      {
        claude: JSON.stringify({ loggedIn: true, subscriptionType: "max" }),
        codex: "Logged in using ChatGPT"
      }
    );

    const status = await registry.getStatus();

    expect(status.activeProviderId).toBe("claude-code");
    expect(status.providers.find((provider) => provider.id === "claude-code")?.detail).toBe(
      "Signed in (max plan)."
    );
    expect(status.providers.find((provider) => provider.id === "codex")?.available).toBe(true);
  });

  it("explains when the selected provider is not ready", async () => {
    const registry = createRegistry(
      { MAUZ_AI_PROVIDER: "anthropic" },
      { claude: JSON.stringify({ loggedIn: false }), codex: "Not logged in" }
    );

    await expect(registry.resolve()).rejects.toThrow(/Anthropic API key is selected/);
  });

  it("reports that no provider is available", async () => {
    const registry = createRegistry(
      {},
      { claude: JSON.stringify({ loggedIn: false }), codex: "Not logged in" }
    );

    await expect(registry.resolve()).rejects.toBeInstanceOf(NoAiProviderError);
  });
});

describe("askMauz provider routing", () => {
  const request: AskMauzRequest = {
    question: "What is this?",
    context: {
      timestamp: new Date().toISOString(),
      platform: "win32",
      cursor: { x: 1, y: 2 },
      pointer: {
        cursor: { x: 1, y: 2 },
        cursorCrop: { mimeType: "image/jpeg", base64: "Y3JvcA==", width: 768, height: 576 },
        screenshot: { mimeType: "image/jpeg", base64: "ZnVsbA==", width: 1280, height: 720 }
      }
    }
  };

  it("answers through the resolved provider and streams text", async () => {
    const answer = vi.fn<AnswerProvider["answer"]>(async (_prompt, options) => {
      options?.onText?.("Partial");
      return { text: "Final answer", model: "claude-sonnet-5-5" };
    });
    const onText = vi.fn();

    const response = await askMauz(request, {
      registry: { resolve: async () => ({ id: "claude-code", answer }) },
      onText
    });

    expect(response).toEqual({ answer: "Final answer", model: "claude-sonnet-5-5" });
    expect(onText).toHaveBeenCalledWith("Partial");
  });

  it("sends the cursor crop and leaves the full screenshot out by default", () => {
    const prompt = buildAnswerPrompt(request);

    expect(prompt.images).toHaveLength(1);
    expect(prompt.images[0]?.label).toMatch(/cursor-centered crop/);
    expect(prompt.userText).toContain("User question: What is this?");
  });

  it("uses the spoken-style system prompt for voice turns", () => {
    const textPrompt = buildAnswerPrompt(request);
    const voicePrompt = buildAnswerPrompt({ ...request, responseStyle: "voice" });

    expect(voicePrompt.systemPrompt).not.toBe(textPrompt.systemPrompt);
    expect(voicePrompt.systemPrompt).toMatch(/read aloud/);
  });
});
