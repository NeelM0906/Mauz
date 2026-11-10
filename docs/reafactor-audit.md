# Refactor audit

Date: 2026-11-10. Scope: the files at HEAD of `t3/architecture-code-audit`. Git history was not read.

This audit changed no source code. Nothing was compiled or run, because the dependencies were not
installed. Each "After (proposed)" block is untested.

In the tables, **Confirmed** means a second read or search confirmed the finding. **Reported** means the
finding comes from one review pass with its search evidence.

## Decisions

These decisions are made. They apply to the rows below.

1. **Remove the standalone API mode (row 1).** There is no plan to run the API in a different process.
   Ask calls the answer providers as a function. Delete the loopback HTTP server, its routes, the token
   and the port search. Remove `pnpm --filter @mauzai/api dev` from `setup.md`.
2. **Remove the browser preview of the renderer (row 4).** Delete the fake bridge in `mauzClient.ts`.
   The renderer runs only in Electron.
3. **Remove `installId` and `openAiAuthDisconnected` (rows 13 and 14).** Delete both fields from the
   settings service, the shared types and schemas, the renderer and the tests. An old settings file
   with `openAiAuthDisconnected: true` hides the environment key today. After removal, Mauz uses that
   key again.

## 1. Architecture fit

**Pattern.** Mauz is a modular monolith in one Electron process. The main process has service folders
(`input`, `context`, `windows`, `ipc`, `agent`, `settings`, `talk`). `apps/api` holds four answer
providers behind one `AnswerProvider` interface. `packages/shared` holds the contracts.

**Verdict.** The pattern fits the product. A cursor assistant must start fast and answer fast, and one
process gives both. The provider interface is correct, because the user selects one of four providers.

**Drift.** Five structures work against that design:

1. **Ask calls its own process through HTTP.** All other calls into `apps/api` are direct function calls.

   ```
   Now:      renderer -> IPC -> main --HTTP + token + 3 schema parses--> Fastify (same process) -> provider
   Proposed: renderer -> IPC -> main --function call--> provider
   ```

2. **Agent CLI knowledge is in two packages.** Ask finds `claude` and `codex` with `cliCommand.ts`.
   Send to agent finds them with `TaskAgentLauncher.ts`. The two give different results.
3. **The contract is written two times.** `types.ts` repeats by hand what `schemas.ts` defines. There is
   no `z.infer` in the package.
4. **One feature has several names.** Ask is also "lens" and "answer". Dictate is also "talk" and
   "pushToTalk". `openai/askMauz.ts` is not specific to OpenAI.
5. **Removed features left parts behind.** Examples: the tray label "History and settings", CSS for a
   desktop window, the `installId` setting.

### Probable defects

These were found by reading. They were not reproduced.

| Defect                                                                                                                                                                         | Where                                                   | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | --------- |
| A key that is only in `.env` works for Ask, but Settings shows no key. The next settings save deletes it. `.env` loads after `SettingsService` reads the environment.          | `index.ts:77-78,131`, `server.ts:58-60`                 | Confirmed |
| A late Ask answer can appear in the next Ask panel. The response is written to the global store with no request check.                                                         | `LensPanel.tsx:73-88`                                   | Confirmed |
| `MAUZ_CLAUDE_CODE_PATH` and `MAUZ_CODEX_PATH` apply to Ask only. `~/.claude/local` is searched for Ask only. Send to agent can report "not installed" for a CLI that Ask uses. | `cliCommand.ts:176-183`, `TaskAgentLauncher.ts:330-344` | Confirmed |
| The child-process credential list is different in each place. The desktop list does not contain `ANTHROPIC_AUTH_TOKEN`.                                                        | `TaskAgentLauncher.ts:749`, `claudeCodeProvider.ts:21`  | Confirmed |
| Settings opened from the tray can show an old task agent, and Save writes it back.                                                                                             | `useMauzStore.ts:54-63`, `MauzMenu.tsx:85`              | Reported  |

## 2. Refactoring candidates

Line counts are estimates. The total is about 2,000 lines, which is near 15% of the production source.

| #   | Impact | Type             | Candidate                                                                                                                                              | Location                                                                           | Lines               | Status                  |
| --- | ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------- | ----------------------- |
| 1   | High   | Over-engineering | Ask uses a loopback HTTP server inside one process                                                                                                     | `launchLocalApi.ts`, `askApiClient.ts`, `apps/api/src/routes/*`, `server.ts:47-75` | ~300 (+430 test)    | Confirmed               |
| 2   | High   | Duplication      | `types.ts` repeats `schemas.ts`                                                                                                                        | `packages/shared/src/types.ts:1-366`                                               | ~290                | Confirmed               |
| 3   | High   | Duplication      | CLI search and environment cleaning exist two times and disagree                                                                                       | `cliCommand.ts:78-95,167-195`, `TaskAgentLauncher.ts:305-347,748-774`              | ~70                 | Confirmed               |
| 4   | High   | Over-engineering | `mauzClient.ts` is a pass-through wrapper plus a fake bridge                                                                                           | `mauzClient.ts:30-259`                                                             | ~245                | Confirmed               |
| 5   | High   | Defect source    | Ask request state is in the global store                                                                                                               | `useMauzStore.ts`, `LensPanel.tsx:58-89`                                           | ~25                 | Confirmed               |
| 6   | High   | Verbosity        | `SettingsPanel` does eight jobs with 16 `useState`; two identical API-key blocks                                                                       | `SettingsPanel.tsx:76-640`                                                         | ~35 cut, ~200 moved | Reported                |
| 7   | Med    | Duplication      | Panel header and "back" sequence written five times                                                                                                    | `LensPanel.tsx:107-131`, `TaskPanel.tsx:135-159`, `DictatePanel.tsx:183-210`       | ~55                 | Reported                |
| 8   | Med    | Over-engineering | Input providers keep listener sets for one subscriber                                                                                                  | `input/*.ts`, `index.ts:419-432`                                                   | ~80                 | Confirmed               |
| 9   | Med    | Verbosity        | Four helpers copy fields only to omit `undefined`                                                                                                      | `ContextCollector.ts:401-489`                                                      | ~75                 | Confirmed               |
| 10  | Med    | Verbosity        | 20 hand-copied `assertTrustedSender` lines and a parallel channel list                                                                                 | `registerIpcHandlers.ts:67-88,104-298`                                             | ~60                 | Confirmed               |
| 11  | Med    | Dead code        | The abort `signal` path goes through five files; no caller supplies a signal                                                                           | `processRunner.ts:41-91`, `claudeCodeProvider.ts:237-254`                          | ~35                 | Confirmed               |
| 12  | Med    | Dead code        | Provider options that no caller and no test passes                                                                                                     | `codexProvider.ts:20-28`, `registry.ts:45-46`, `transcribeAudio.ts:6-12`           | ~65                 | Reported                |
| 13  | Med    | Dead code        | `installId` is created, saved and exported; nothing reads it                                                                                           | `index.ts:290`, `SettingsService.ts:73,228-233,541-546`                            | ~30                 | Confirmed               |
| 14  | Med    | Dead code        | `openAiAuthDisconnected` is never set to `true` in production                                                                                          | `SettingsService.ts:133,284,478`, `SettingsPanel.tsx:262,467`                      | ~35                 | Confirmed               |
| 15  | Med    | Dead code        | `findDefaultHelperPath` never runs; it repeats `getNativeInputAgentPath`                                                                               | `MacInputAgentProvider.ts:79,323-362`                                              | ~43                 | Confirmed               |
| 16  | Med    | Dead code        | Response fields that no reader uses: `usage`, `model`, `kind`, `engine`, `agentLabel`                                                                  | `askMauz.ts:29-60`, `schemas.ts`                                                   | ~45                 | Reported                |
| 17  | Med    | Duplication      | `runTurn` repeats `runAndCollect`; two "explain CLI failure" functions                                                                                 | `claudeCodeProvider.ts:216-315,356-378`, `codexProvider.ts:201-221`                | ~85                 | Reported                |
| 18  | Med    | Duplication      | Two near-identical API-key update functions                                                                                                            | `SettingsService.ts:259-315`                                                       | ~25                 | Confirmed               |
| 19  | Med    | Verbosity        | The provider list is built two times; the preference parse is hand-written                                                                             | `registry.ts:85-90,131-138,255-284`                                                | ~40                 | Confirmed               |
| 20  | Med    | Verbosity        | Preload has six hand-written subscriptions and 20 casts                                                                                                | `preload/index.ts:39-141`                                                          | ~65                 | Confirmed               |
| 21  | Med    | Dead code        | `setLensExpanded` is only called with `true`; settings are fetched in three places                                                                     | `MauzMenu.tsx:66-92,117`, `registerIpcHandlers.ts:123-133`                         | ~60                 | Confirmed               |
| 22  | Med    | Dead code        | CSS selectors and variables with no reference                                                                                                          | `styles.css:229-232,292-299,770-773,935-948,1282-1289`                             | ~80                 | Confirmed (4 selectors) |
| 23  | Low    | Verbosity        | Five hand-written line splitters; `codexAppServer.ts` already uses `node:readline`                                                                     | `processRunner.ts:116-147`, `WindowsContextHelper.ts:110-123`                      | ~60                 | Reported                |
| 24  | Low    | Verbosity        | Small `switch` and `if` chains that are lookups                                                                                                        | `DictatePanel.tsx:260-271`, `App.tsx:62-78`, `anthropicProvider.ts:94-130`         | ~35                 | Confirmed               |
| 25  | Low    | Dead code        | Items used only by tests or by nothing: `captureDisplayNear`, the Swift `--socket` transport, the `ShakeDetector` `reason`, about 30 `export` keywords | several                                                                            | ~200                | Part confirmed          |
| 26  | Low    | Consistency      | IPC trusts any `localhost` port; navigation trusts only the dev-server origin                                                                          | `registerIpcHandlers.ts:319-334`, `WindowSecurity.ts:18-38`                        | ~20                 | Confirmed               |
| 27  | Low    | Readability      | Two files do many jobs: `TaskAgentLauncher.ts` (928 lines), `WindowsContextHelper.ts` (852 lines, 350 of them PowerShell in a string)                  | —                                                                                  | move only           | Reported                |

**Over-built parts.** There are few. They are rows 1, 4, 8 and 12. The provider interface and the warm
Claude Code process are justified.

## 3. Before and after

### Row 1: Ask calls a function, not a server

**Before** (`registerIpcHandlers.ts:156-160`, `askApiClient.ts:23-38`)

```ts
ipcMain.handle(IPC_CHANNELS.askSubmit, async (event, payload: unknown) => {
  assertTrustedSender(event);
  const request = AskMauzRequestSchema.parse(payload); // parse 1
  return submitAskToLocalApi(api, localApiToken, request);
});

const request = AskMauzRequestSchema.parse(payload); // parse 2
const response = await fetchImpl(`${api.baseUrl}/api/ask`, {
  method: "POST",
  headers: { "content-type": "application/json", [LOCAL_API_TOKEN_HEADER]: localApiToken },
  body: JSON.stringify(request) // the screenshot becomes JSON text
});
const body = await response.json();
if (!response.ok) throw new Error(getFriendlyAskApiError(response.status, body));
return AskMauzResponseSchema.parse(body); // the route parses a third time
```

**After (proposed)**

```ts
// apps/api/src/server.ts
export async function answerAsk(request: AskMauzRequest, onText?: (text: string) => void) {
  try {
    return await askMauz(request, onText === undefined ? {} : { onText });
  } catch (error) {
    // Same rule as routes/ask.ts:54-67: only provider errors keep their message.
    if (error instanceof NoAiProviderError || error instanceof AiProviderError) throw error;
    throw new Error("Ask Mauz failed while contacting the model.");
  }
}

// registerIpcHandlers.ts
ipcMain.handle(IPC_CHANNELS.askSubmit, async (event, payload: unknown) => {
  assertTrustedSender(event);
  const request = AskMauzRequestSchema.parse(payload);
  const { requestId } = request;
  return answerAsk(
    request,
    requestId === undefined ? undefined : (text) => sendAskDelta({ requestId, text })
  );
});
```

Delete `routes/`, `apps/api/src/index.ts`, `launchLocalApi.ts`, `askApiClient.ts`, the token, the port
search and the "port in use" start error. Call `loadLocalEnv()` as the first line of `bootstrap()`; this
also corrects the `.env` defect.

### Row 2: one definition for each contract

**Before** (`schemas.ts:64-68` and `types.ts:202-206`)

```ts
export const AiProvidersStatusResponseSchema = z.object({
  preference: AiProviderPreferenceSchema,
  activeProviderId: AiProviderIdSchema.nullable(),
  providers: z.array(AiProviderStatusSchema)
});

export type AiProvidersStatusResponse = {
  preference: AiProviderPreference;
  activeProviderId: AiProviderId | null;
  providers: AiProviderStatus[];
};
```

**After (proposed)**

```ts
export type AiProvidersStatusResponse = z.infer<typeof AiProvidersStatusResponseSchema>;
```

About 45 types change in the same way. Only `MauzBridge`, `BrowserExtensionStatus` and
`MauzSettingsOpenOptions` have no schema.

### Row 3: one function cleans the child environment

**Before** (five of the lists)

```ts
// claudeCodeProvider.ts:21
const CREDENTIAL_ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"] as const;
// codexProvider.ts:18
const CREDENTIAL_ENV_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;
// subscriptionConnect.ts:32
removeEnvKeys: (["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  // registry.ts:188
  ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);
// TaskAgentLauncher.ts:749
const MAUZ_RUNTIME_VARIABLES = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_ASK_MODEL"]);
```

**After (proposed)**

```ts
// apps/api/src/providers/cliCommand.ts, exported from @mauzai/api/server
const MAUZ_CREDENTIAL_KEYS = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);

export function buildCliEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => {
      const name = key.toUpperCase();
      return !name.startsWith("MAUZ_") && name !== "ELECTRON_RUN_AS_NODE" && !MAUZ_CREDENTIAL_KEYS.has(name);
    })
  );
}
```

`buildAgentEnvironment` calls this function, then removes `OPENAI_ASK_MODEL` and the parent-session
variables. Export `getSearchDirectories` in the same way, so both features search the same folders.

### Row 4: the renderer uses the bridge directly

**Before** (`mauzClient.ts:180-259`, 26 methods of this shape)

```ts
export const mauzClient = {
  showMenu(): Promise<void> {
    return getBridge().menu.showMenu();
  },
  submitAsk(payload: AskMauzRequest): Promise<AskMauzResponse> {
    return getBridge().ask.submit(payload);
  },
  getTaskFolders(agentId: TaskAgentId): Promise<TaskFoldersResponse> {
    return getBridge().task.folders({ agentId });
  }
  // ...23 more
};
```

**After (proposed)** (the full file)

```ts
import type { MauzBridge } from "@mauzai/shared";

/** The preload bridge. It throws when the preload script did not run. */
export function mauz(): MauzBridge {
  if (window.mauz === undefined) {
    throw new Error("Mauz desktop bridge is unavailable. Quit and reopen the installed MauzAI app.");
  }
  return window.mauz;
}
// Call site: mauzClient.getTaskFolders(agentId)  ->  mauz().task.folders({ agentId })
```

Delete the 105-line fake bridge (`mauzClient.ts:30-135`). See decision 2.

### Row 5: Ask state is local and has one shape

**Before** (`LensPanel.tsx:67-88`)

```ts
askRequestIdRef.current = requestId;
setStreamingAnswer(null);
setAskLoading(true); // global store
setAskError(null); // global store
setAskAnswer(null); // global store
try {
  const response = await mauzClient.submitAsk({ question: prompt, context: currentContext, requestId });
  setAskAnswer(response.answer); // no check: an old request can write here
  setQuestion("");
} catch (error) {
  setAskError(error instanceof Error ? error.message : "Ask failed.");
} finally {
  askRequestIdRef.current = null;
  setStreamingAnswer(null);
  setAskLoading(false);
}
```

**After (proposed)**

```ts
type AskState =
  | { status: "idle" }
  | { status: "loading"; partial: string | null }
  | { status: "answered"; answer: string }
  | { status: "failed"; message: string };

const [ask, setAsk] = useState<AskState>({ status: "idle" });

requestIdRef.current = requestId;
setAsk({ status: "loading", partial: null });
try {
  const response = await mauzClient.submitAsk({ question: prompt, context: currentContext, requestId });
  if (requestIdRef.current !== requestId) return;
  setAsk({ status: "answered", answer: response.answer });
  setQuestion("");
} catch (error) {
  setAsk({ status: "failed", message: error instanceof Error ? error.message : "Ask failed." });
}
```

Four variables become one. Delete six store members and the three places that clear them.

### Row 8: input providers receive callbacks

**Before** (`DevHotkeyInputProvider.ts:45-69`, repeated in three providers)

```ts
onActivation(callback: (event: ActivationEvent) => void): Unsubscribe {
  this.activationListeners.add(callback);
  return () => {
    this.activationListeners.delete(callback);
  };
}
private emitActivation(event: ActivationEvent): void {
  for (const listener of this.activationListeners) {
    listener(event);
  }
}
// ...the same two methods again for permission errors
```

**After (proposed)**

```ts
export type InputProviderCallbacks = {
  onActivation(cursor: { x: number; y: number }): void;
  onPermissionError(error: PermissionError): void;
};

constructor(private readonly callbacks: InputProviderCallbacks) {}
// in start(): this.callbacks.onActivation(screen.getCursorScreenPoint());
```

`index.ts:423-429` is the only subscriber. No caller keeps the unsubscribe function.

### Row 9: do not copy fields to omit `undefined`

**Before** (`ContextCollector.ts:434-446`; three more helpers have the same shape)

```ts
function getActivationMetadata(snapshot: ActivationSnapshot): ActiveWindowMetadata {
  const metadata: ActiveWindowMetadata = {};
  if (snapshot.activeApp !== undefined) {
    metadata.activeApp = snapshot.activeApp;
  }
  if (snapshot.activeWindow !== undefined) {
    metadata.activeWindow = snapshot.activeWindow;
  }
  return metadata;
}
```

**After (proposed)**

```ts
const metadata = { activeApp: snapshot.activeApp, activeWindow: snapshot.activeWindow };
```

This needs the shared types to declare each field as `?: T | undefined`. That part is reported, not
confirmed.

### Row 18: one function saves an API key

**Before** (`SettingsService.ts:259-315`): `applyApiKeyUpdate` and `applyAnthropicKeyUpdate` are 57
lines. They differ in the field name, the label and one line.

**After (proposed)**

```ts
function applySecretUpdate(
  settings: StoredMauzSettings,
  field: "encryptedOpenAiApiKey" | "encryptedAnthropicApiKey",
  label: string,
  value: string | null | undefined,
  clear: boolean | undefined,
  secretCodec: SecretCodec
): void {
  if (clear === true || value === null) delete settings[field];

  const apiKey = typeof value === "string" ? normalizeApiKey(value) : undefined;
  if (apiKey === undefined) return;

  try {
    if (!secretCodec.isAvailable()) throw new Error("unavailable");
    settings[field] = secretCodec.encrypt(apiKey);
  } catch {
    throw new Error(`Mauz could not save the ${label} API key securely on this computer.`);
  }
}
```

### Row 19: use the schema and one `find`

**Before** (`registry.ts:255-284`)

```ts
export function pickProvider(preference, providers) {
  if (preference !== "auto") {
    const selected = providers.find((provider) => provider.id === preference);
    return selected?.available === true ? selected : null;
  }
  for (const id of AUTO_PROVIDER_ORDER) {
    const provider = providers.find((candidate) => candidate.id === id);
    if (provider?.available === true) {
      return provider;
    }
  }
  return null;
}

function readPreference(value: string | undefined): AiProviderPreference {
  const normalized = value?.trim();
  return normalized === "claude-code" ||
    normalized === "codex" ||
    normalized === "anthropic" ||
    normalized === "openai"
    ? normalized
    : "auto";
}
```

**After (proposed)**

```ts
export function pickProvider(preference: AiProviderPreference, providers: readonly AiProviderStatus[]) {
  const ready = providers.filter((provider) => provider.available);
  return (preference === "auto" ? ready[0] : ready.find((provider) => provider.id === preference)) ?? null;
}

const readPreference = (value: string | undefined) =>
  AiProviderPreferenceSchema.catch("auto").parse(value?.trim());
```

`SettingsService.ts:348` already uses the schema form. The short `pickProvider` needs `providers` in the
auto order; both callers build the list in that order.

### Row 24: lookups in place of `switch` and `if` chains

**Before** (`DictatePanel.tsx:260-271`, `App.tsx:62-78`)

```tsx
switch (state) {
  case "starting":
    return "Opening the microphone...";
  case "listening":
    return "Listening. Press Stop or Space when you're done.";
  case "transcribing":
    return "Turning your words into text...";
  default:
    return "Edit the text if needed, then pick where it goes.";
}

if (mode === "lens") return <LensPanel />;
if (mode === "task") return <TaskPanel />;
if (mode === "dictate") return <DictatePanel />;
if (mode === "settings") return <SettingsPanel />;
return <MauzMenu />;
```

**After (proposed)**

```tsx
const READY_TEXT = "Edit the text if needed, then pick where it goes.";
const STATUS_TEXT: Record<DictateState, string> = {
  starting: "Opening the microphone...",
  listening: "Listening. Press Stop or Space when you're done.",
  transcribing: "Turning your words into text...",
  ready: READY_TEXT,
  error: READY_TEXT
};

const PANELS: Record<MauzMode, React.ComponentType> = {
  menu: MauzMenu,
  lens: LensPanel,
  task: TaskPanel,
  dictate: DictatePanel,
  settings: SettingsPanel
};
const Panel = PANELS[mode];
return <Panel />;
```

## 4. TypeScript standards and readability

**Good.** The code uses `async`/`await` throughout. There are no deeply nested callbacks and no large
`switch` statements. No `any` was found in the renderer.

**Verbose patterns that repeat:**

- `...(x === undefined ? {} : { x })` to pass an optional value (`server.ts:68-72`,
  `launchLocalApi.ts:25`, `index.ts:100-106,156-157`). Declare the fields as `?: T | undefined` and pass
  the object.
- `error instanceof Error ? error.message : "..."` appears 12 times in the renderer.
- The same "is the window alive" block appears three times in `index.ts` (93-97, 135-139, 579-583).
- `new Promise` around `execFile` appears three times; `node:util` `promisify` does this.

**Places where a junior developer has difficulty:**

- The main process sends an HTTP request to itself (row 1). No comment gives the reason.
- `startAsk` captures context for all three features, not only Ask (`MauzMenu.tsx:115`).
- `openSettings` reads settings and can also change the window size.
- `LensPanel.tsx:92-93` keeps the latest `submitQuestion` in a ref so that an effect can call it.
- `TaskAgentLauncher.ts:661` has an invisible byte-order mark inside a template string. Write `﻿`.
- `MacInputAgentProvider.ts:241,247,286` has comments "Fix 2:" and "Fix 3:". They refer to a review
  that the reader cannot see.
- `WindowsContextHelper.ts:500-852` is a PowerShell and C# program in a string, with no syntax colour.

## 5. Limits of this audit

- Rows 1, 2 and 16 change contracts that tests assert. Change those tests in the same commit.
- The macOS and Swift code was read but not run or compiled.
- The embedded PowerShell was not reviewed line by line.
- Tailwind and Zustand practice were not reviewed.
