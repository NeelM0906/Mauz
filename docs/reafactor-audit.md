# Mauz refactoring plan

This file drives a multi-session refactor. Each Claude Code session does one phase, then stops.
The full audit is below the plan. Row numbers refer to the table in section 2 of the audit.

## Decisions

The owner made these decisions on 2026-11-10.

1. **Standalone API mode** (`pnpm --filter @mauzai/api dev`): **REMOVE.** There is no plan to run the API
   in a different process. Do row 1 as written. Delete the loopback HTTP server, its routes, the token
   and the port search. Remove the command from `setup.md`.
2. **Browser preview of the renderer** (fake bridge in `mauzClient.ts`): **REMOVE.** Do not keep a
   dev-only copy. The renderer runs only in Electron.
3. **`openAiAuthDisconnected` and `installId`** (rows 13 and 14): **REMOVE.** Delete both fields from the
   settings service, the shared types and schemas, the renderer and the tests. An old settings file
   with `openAiAuthDisconnected: true` hides the environment key today. After removal, Mauz uses that
   key again. This is accepted.

Audit base commit: `c7fd5b9`. Line numbers in the audit match this commit.

## Rules for every session

- Do only the phase that the owner gives you. If you find a problem in a different row, add it to
  "Notes" below. Do not fix it.
- The "After (proposed)" code blocks are untested. They show the intent; they are not patches. Line
  numbers can be out of date, so find code by symbol name.
- Before you change code for a row with the status **Reported** or **Part confirmed**, check the
  finding yourself. If it is wrong, stop, write it in "Notes" and tell the owner.
- Make one commit for each row: `refactor(row N): <summary>`. Defect fixes use `fix: <summary>`.
- Do not add `Co-Authored-By` lines or tool attribution to commits.
- After each row, typecheck, tests and lint must pass. Do not commit while they fail.
- If a row changes a contract that tests check, update those tests in the same commit.
- Do not change behaviour, except to fix the defects in the audit. Do not add features or dependencies.
- If a row removes an item from "Known drift" in `CLAUDE.md`, or changes its layout tables, update
  `CLAUDE.md` in the same commit.
- At the end of the phase:
  1. Start a new subagent that has not seen this work. Tell it to review `git diff <phase-start>..HEAD`
     against the rows of this phase. It must report each change in behaviour, missing part and
     leftover dead code.
  2. Fix the items that you confirm.
  3. Tick the phase below and add notes.
  4. Commit this file and stop. Give a short summary that lists each item you skipped.

## Phases

- [x] **Phase 0: baseline and defect tests** (done 2026-11-10; see "Phase 0" in Notes)
  - Install dependencies. Run typecheck, tests and lint. Record the commands that work in "Notes".
    Fix only the items that prevent a green baseline.
  - For each of the 5 defects in the "Probable defects" table, write a test that shows the defect.
    Mark it skipped or todo if it fails now. If a test is not practical (Electron or UI), write exact
    manual steps in "Notes". Record if each defect is confirmed.
  - Do not refactor in this phase.
- [x] **Phase 1: shared foundations.** (done 2026-11-10; see "Phase 1" in Notes) Row 2 (`z.infer`), then row 3 (one CLI search and one
      environment cleaner). Row 3 fixes the CLI-path defect and the credential-list defect.
- [x] **Phase 2: Ask without HTTP.** (done 2026-11-10; see "Phase 2" in Notes) Row 1. Use plan mode: show the plan and wait for approval before
      you edit. This phase fixes the `.env` defect.
- [ ] **Phase 3: renderer.** Rows 5 (fixes the late-answer defect), 4, 7, 24, 21, then 6. For row 6,
      plan first and get approval. Check the stale-task-agent defect during rows 21 and 6.
- [ ] **Phase 4: main process and API cleanup.** Rows 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20.
      Before you simplify `pickProvider` in row 19, check that both callers build the list in the auto
      order.
- [ ] **Phase 5 (optional): low impact.** Rows 22, 23, 25, 26, 27, and the items in section 4 of the
      audit: write the byte-order mark as the escape for U+FEFF, remove the "Fix 2" and "Fix 3" comments, use
      `promisify(execFile)`.

## Manual smoke test (owner, after each phase)

- Ask: ask a question. The answer streams and completes.
- Ask two times quickly: close the panel during a slow answer, open it again, ask again. No old answer
  appears.
- Ask with the key only in `.env`: Settings shows the key. A settings save keeps it.
- Dictate: record, transcribe, send to a target.
- Send to agent with Claude Code and with Codex: Mauz detects both and starts both.
- Settings from the tray: it shows the current task agent. Save does not change it.

## Notes

_(Sessions add text here: baseline commands, defect confirmations, skipped items, wrong audit findings.)_

### Phase 0 (2026-11-10, base `926e10b`)

**Baseline.** On Windows, `pnpm` is not on PATH in the agent shell, so use `corepack pnpm`. The root
scripts `pnpm test` and `pnpm typecheck` call `pnpm -r`, so call the recursive form directly:

| Step      | Command                      | Result                                       |
| --------- | ---------------------------- | -------------------------------------------- |
| Install   | `corepack pnpm install`      | OK                                           |
| Typecheck | `corepack pnpm -r typecheck` | OK, 3 packages                               |
| Tests     | `corepack pnpm -r test`      | api 46 passed; desktop 172 passed, 5 skipped |
| Lint      | `corepack pnpm lint`         | OK                                           |

One fix was needed for lint. On Windows, `core.autocrlf=true` checks files out with CRLF line endings,
and Prettier expected LF, so `pnpm lint` failed on 130 files. `.prettierrc.json` now has
`"endOfLine": "auto"`. Git still stores LF, because `autocrlf` converts on commit.

**Defects.** The 5 skipped tests fail today for the stated reason. This was checked by running them
without `.skip`. The fix that removes each `.skip` must make the test pass.

| Defect                     | Status after Phase 0 | Evidence                                                       |
| -------------------------- | -------------------- | -------------------------------------------------------------- |
| `.env` key hidden          | Confirmed by test    | `dotenvStartOrder.test.ts` (skipped)                           |
| Late Ask answer            | Confirmed by reading | Manual steps below; the renderer has no DOM test setup         |
| CLI path for Ask only      | Confirmed by tests   | `TaskAgentLauncher.test.ts` "known defects": 3 tests (skipped) |
| Credential list differs    | Confirmed by test    | `TaskAgentLauncher.test.ts` "known defects" (skipped)          |
| Stale task agent from tray | Confirmed by reading | Manual steps below; status was "Reported"                      |

- **`.env` test and row 1.** The test builds the start order by hand: `SettingsService`, then
  `createMauzApiServer()`, which loads `.env`. Row 1 deletes `createMauzApiServer` and fixes the order
  inside `bootstrap()`, which a test cannot run. So row 1 must rewrite or delete this test (for example,
  call the exported `loadLocalEnv()` before `new SettingsService()`), and the owner checks the fix with
  the smoke step "Ask with the key only in `.env`". The test is in its own file, so that the other
  settings tests do not load the API server and do not break when row 1 removes it. It restores the
  whole environment after it runs, because `.env` files in parent folders can add any variable.
- **CLI-path tests and row 3.** The tests check `listAgents()`. `launch()` calls the same
  `findExecutable(agent.command)`, so row 3 must fix that function, not `listAgents()` alone.
- **Credential list.** Mauz never sets `ANTHROPIC_AUTH_TOKEN` itself (`applyRuntimeEnvironment` sets
  only `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`). So today Send to agent passes on a token that came
  from the user's own environment. Row 3 removes it, as the Ask CLI providers do.

**Manual steps: late Ask answer** (`LensPanel.tsx` `submitQuestion`)

1. Select Claude Code or Codex as the Ask provider, so that an answer takes several seconds.
2. Open Mauz, choose Ask, and ask a long question, for example "Explain this in 300 words".
3. While the answer streams, click the X button ("Close Mauz"). Escape does not work while the question
   field has focus.
4. Open Mauz again and choose Ask. Do not ask anything.
5. Wait until the first answer would be complete.
6. Expected: the panel stays empty. Defect: the first answer appears. If you ask a second question
   during step 5, the first answer appears and the loading state ends before the second answer comes.

Cause: the old `LensPanel` is unmounted, but its `submitQuestion` still calls `setAskAnswer` and
`setAskLoading(false)` on the global store with no request check.

**Manual steps: stale task agent from the tray** (`App.tsx` `onOpenSettings`, `SettingsPanel.tsx`)

1. In Settings, set Task agent to Claude Code and save.
2. Open Mauz with a shake or the hotkey. The menu loads settings into the store.
3. Choose Send to agent, pick Codex, and send a task. The main process saves `taskAgent: "codex"`
   (`registerIpcHandlers.ts`, the task launch handler).
4. Open Settings from the tray.
5. Expected: Task agent shows Codex. Defect: it shows Claude Code, and Save writes Claude Code back.

Cause: `onOpenSettings` calls `reset()`, which keeps `settings`. `SettingsPanel` reloads only when
`settings` is `null`. The menu's own Settings button is not affected, because `handleSettings` reloads.

**Skipped in Phase 0:** none of the plan items. Not done: a test that loads the real `bootstrap()`
(it needs Electron).

### Phase 1 (2026-11-10, base `9767caa`)

Gates after each row: typecheck, tests (api 47 passed; desktop 176 passed, 1 skipped, which is
`dotenvStartOrder.test.ts` for row 1), lint. `corepack pnpm -r build` passes.

**Row 2.** Every type with a schema is now `z.infer`. Zod 4 infers `.optional()` as `?: T | undefined`,
so the types match the old hand-written ones and no caller changed. Changes in `schemas.ts`: the inline
objects for `TaskAgentStatus` and `TaskFolder` are now `TaskAgentStatusSchema` and `TaskFolderSchema`;
the doc comments moved from `types.ts` to the schema fields. `AiProvidersStatusRequest` is
`NonNullable<...>`, because its schema is `.optional()`. `PointerTargetSource`, `SubscriptionConnectPhase`
and `TalkTranscriptionEngine` are indexed types. Hand-written still: `MauzBridge`,
`BrowserExtensionStatus`, `MauzSettingsOpenOptions` (no schema), as the audit said.

- For row 9: the precondition "shared types declare each field as `?: T | undefined`" is now true for
  every schema type.
- For rows 13, 14 and 16: a field is now removed from the schema only; the type follows.

**Row 3.** The audit finding is correct. Changes:

- `cliCommand.ts` exports `getCliSearchDirectories` (the union of both old folder lists),
  `applyCliPathOverride` (`claude` -> `MAUZ_CLAUDE_CODE_PATH`, `codex` -> `MAUZ_CODEX_PATH`), and a
  `buildCliEnvironment(env)` with no second argument. `server.ts` re-exports the three.
- `resolveCliCommand` applies the override itself, so the six `env.MAUZ_..._PATH?.trim() || "claude"`
  expressions in the providers, `registry.ts` and `subscriptionConnect.ts` are gone. An injected
  `resolveCommand` (tests) now receives `"claude"` or `"codex"`, not the override path.
- `TaskAgentLauncher.findExecutable` uses the shared folders and override. It still returns a Windows
  `.cmd` as it is, and still checks `.exe`, `.cmd`, `.bat` for each folder in turn. Ask still checks
  `.exe` in every folder first, then turns a `.cmd` into `node <script>`. Both Windows tests pass.
- `buildAgentEnvironment` calls `buildCliEnvironment`, then removes `OPENAI_ASK_MODEL` and the
  parent-session variables. The 4 "known defects" tests pass without `.skip`.

Changes in behaviour that the reviewer should check (all are in the direction of removing more):

- Every CLI child now loses all three credentials. Before: the Claude status check and sign-in kept
  `OPENAI_API_KEY`; the Codex status check and sign-in kept `ANTHROPIC_API_KEY` and
  `ANTHROPIC_AUTH_TOKEN`; `npm install` of a CLI kept all three. None of these programs reads the other
  vendor's key, and the answer runs already removed all three.
- Variable names are compared in upper case (`mauz_x`, `openai_api_key` are removed too), as Windows
  treats them.
- Ask now also searches `~/.hermes/bin`, `%LOCALAPPDATA%\hermes\bin` and `/usr/bin`. Send to agent now
  also searches `~/.claude/local` and `~/.bun/bin`, and skips repeated folders.

For later phases:

- Row 1 must keep the three `cliCommand` exports in the module that `@mauzai/api/server` points to.
  `TaskAgentLauncher.ts` now imports from it.
- Rows 12 and 17: the default `resolveCommand` with `fallbackNodeRuntime` is written three times
  (`claudeCodeProvider.ts`, `codexProvider.ts`, `registry.ts` `resolveCliCommandForMauz`).

**Skipped in Phase 1:** nothing from rows 2 and 3.

**Review.** A separate agent reviewed the phase and found no bugs. Fixed from its list: `setup.md` says the
`MAUZ_*_PATH` overrides also apply to Send to agent; CLAUDE.md has the `z.infer` rule; new tests for a
Windows `.cmd` override in Send to agent, repeated and Hermes search folders, and a Codex sign-in that
gets no credentials. Left for Phase 2: the launcher's import of `@mauzai/api/server`.

### Phase 2 (2026-11-10, base `844822e`)

Row 1 is done as the approved plan says, in one commit. Gates: typecheck, tests (after the review fixes:
api 47 passed; desktop 176 passed, 0 skipped), lint, `node scripts/check-env.mjs`, `node scripts/check-secrets.mjs`,
`corepack pnpm -r build`. `check-env.mjs` needs no real `.env`.

- `server.ts` exports `answerAsk(request, onText?)` and `loadLocalEnv()`. The three `cliCommand`
  re-exports stay, so `TaskAgentLauncher.ts` still imports from `@mauzai/api/server`.
- The `askSubmit` handler sends `ask:delta` to `event.sender` (the popover, the only trusted sender),
  not to `popover.getWebContents()`. It skips the send when the sender is destroyed.
- `bootstrap()` calls `loadLocalEnv()` first. `dotenvStartOrder.test.ts` runs without `.skip`.
- `apps/api/package.json` exports only `./server`; `main`/`types` point at `dist/server.*`. `tsx` stays in
  the lockfile only as an optional transitive package.

Differences from the plan:

- `showBootstrapError()` lost its `error` parameter, because only the "port in use" branch read it.
  The error was not logged before either.
- `apps/api/tests/providers.test.ts` used `MAUZ_LOCAL_API_TOKEN` as sample data for the `MAUZ_` prefix
  rule. It now uses `MAUZ_BROWSER_TOKEN`, so the leftover grep is clean. Same test.
- `askPayload.test.ts` also lost three unused imports and an unused `buildContext` helper.
- `registerIpcHandlers.test.ts` has one more test than planned: no `ask:delta` to a destroyed sender.
- `CLAUDE.md` says that every call into `apps/api` is a direct import and that `bootstrap()` loads `.env`
  first. The `apps/api` layout row did not mention HTTP, so it is unchanged. `README.md` had nothing to
  change.

Error mapping, checked against the old code: `MissingOpenAIKeyError`'s default text is the same text that
`getFriendlyAskApiError` produced for a 503 with `OPENAI_API_KEY`, so the user sees the same message.
The HTTP-only messages (401 "local API rejected", 400 "Invalid Ask Mauz request", fetch or JSON errors)
are gone; an invalid payload is still a `ZodError` from the IPC handler.

Accepted risks (owner-approved):

- Ask timeout: `fetch` used to stop a silent Ask at 300 s (`headersTimeout`). Now the OpenAI and
  Anthropic SDK default (10 minutes) applies. The CLI providers keep their own timeouts.
- `.env` now applies to everything `bootstrap()` reads: `MAUZ_EXCLUDE_FROM_CAPTURE`,
  `ELECTRON_RENDERER_URL`, and the settings defaults (`MAUZ_ENABLE_NATIVE_INPUT`, `MAUZ_ENABLE_DEV_HOTKEY`,
  `OPENAI_ASK_MODEL`, `MAUZ_TASK_AGENT`, `MAUZ_AI_PROVIDER`). Set variables still win (`override: false`),
  and saved settings still win at runtime.
- Users with `openAiAuthDisconnected: true`: before, the old server loaded `.env` after
  `applyRuntimeEnvironment` had deleted `OPENAI_API_KEY`, and put the key back. Now it stays deleted.
  Row 13 removes the field anyway.
- `dotenvStartOrder.test.ts` calls `loadLocalEnv()` itself, so it cannot catch a regression in the order
  inside `bootstrap()`. The owner's smoke step "Ask with the key only in `.env`" covers that.
- The module name `@mauzai/api/server` is kept, although there is no server.

For later phases:

- `shutdownResources()` stays `async` with nothing to await. `beginShutdown` needs the promise: its
  `.catch` reports a throw, `shutdownPromise` is the "shutting down" flag, and `.finally` calls
  `app.quit()` after the `before-quit` handler has returned. A synchronous `app.quit()` inside that
  handler would start `before-quit` again while the first call still prevents the quit.
- Row 11: `askMauz` still accepts `signal`; `answerAsk` does not pass one.
- Row 26: `isTrustedRendererOrigin` still trusts `127.0.0.1` and `localhost` on any port (dev renderer).

**Skipped in Phase 2:** nothing from row 1.

**Review.** A separate agent reviewed the phase and found no bugs. Fixed: provider errors reach the
renderer as a plain `Error`, so the text stays "Error: <message>" as before (Electron uses
`err.toString()`); new tests for an Ask without a `requestId` and for a response that fails the schema.
Left: `shutdownResources()` stays `async` (reason above).

---

# Audit

Date: 2026-11-10. Scope: the files at commit `c7fd5b9`. Git history was not read.

This audit changed no source code. Nothing was compiled or run, because the dependencies were not
installed. Each "After (proposed)" block is untested.

In the tables, **Confirmed** means a second read or search confirmed the finding. **Reported** means the
finding comes from one review pass with its search evidence.

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
