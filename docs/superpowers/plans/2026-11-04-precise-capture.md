# Precise Context Capture

> **Update 2026-11-05:** Talk, OpenAI Realtime, and Select area (the user-drawn region) have been removed. Mauz now does Ask, Dictate, and Send to agent only, so the parts of this document about them are history.

Spec: `docs/superpowers/specs/2026-11-04-precise-capture-design.md`

## Goal

Send the model what the user is pointing at, as text where possible, with an image framed
on that thing rather than a fixed square around the pointer. Drop the whole-display
screenshot option. Give users a never-capture list and a view of what was sent.

## Phase 1 (Windows UIA, framing, privacy)

**Status (2026-11-04):** Tasks 1–7 are implemented on `feat/precise-capture`, with unit tests.
`elementAtPoint` was run live on Windows (T3 Code panes, the taskbar). The end-to-end
shake checks in "Phase 1 acceptance" have not been run yet.

### Task 1: Remove the full-screenshot option

- **Files:** `packages/shared/src/{types.ts,schemas.ts}`, `apps/api/src/openai/askMauz.ts`,
  `apps/desktop/src/main/{index.ts,settings/SettingsService.ts}`,
  `apps/desktop/src/renderer/src/{components/SettingsPanel.tsx,lib/mauzClient.ts}`,
  `.env.example`, `scripts/check-env.mjs`, affected tests.
- **Spec:** Delete `includeFullScreenshot`, `OPENAI_INCLUDE_FULL_SCREENSHOT` and
  `shouldIncludeFullScreenshot`. The model gets the focus crop, or the overview image only
  when there is no crop. Old stored settings still load.
- **Tests:** settings load with a stale `includeFullScreenshot` key; image selection in
  `askMauz` / `buildAnswerPrompt`.

### Task 2: Pointed element via UI Automation

- **Files:** `apps/desktop/src/main/context/WindowsContextHelper.ts`, `apps/desktop/src/main/index.ts`,
  `packages/shared/src/{types.ts,schemas.ts}`, `apps/desktop/tests/WindowsContextHelper.test.ts`.
- **Spec:** Helper becomes per-monitor DPI aware. New `elementAtPoint` command (spec §3.1).
  `getElementAtPoint(dipPoint)` converts DIP→physical on the way in and physical→DIP for
  every returned rectangle (active-window bounds included), via injected converters
  (identity by default; Electron `screen` on win32). Output is parsed defensively into
  `PointerTarget` with length caps.
- **Tests:** request shape, coordinate conversion, parsing/caps, garbage tolerance.
- **Live check:** run the helper against this machine's open apps.

### Task 3: Collect the target at activation and on Talk turns

- **Files:** `apps/desktop/src/main/context/ContextCollector.ts`, tests.
- **Spec:** `prepareForActivation` also fetches the target at the activation cursor. Ask
  uses it when the activation cursor is used. Talk turns (current cursor) do a live lookup.
  Targets whose window belongs to the Mauz process are dropped. The target's container or
  element bounds and the window bounds are passed to `ScreenshotService`.
- **Tests:** activation target attached; live lookup dropping own-process results; no
  target when the cursor does not match.

### Task 4: Element-framed crop, window-bounded overview

- **Files:** `apps/desktop/src/main/context/ScreenshotService.ts`, tests.
- **Spec:** Spec §3.3: native-resolution capture (≤ 2560 px wide), frame = window ∩ display,
  element crop (pad 16, min 360×240, max 1400×1000 DIP), pointer-area fallback (900×600
  DIP), output ≤ 1280×960, `cursorCropFocus` with the pointer's crop coordinates, overview
  only on crop failure.
- **Tests:** each framing branch, clamping, the scale math, overview fallback.

### Task 5: Prompt and labels

- **Files:** `apps/api/src/openai/askMauz.ts`, `apps/api/src/prompts/mauzSystemPrompt.ts`,
  `apps/api/src/openai/createRealtimeAnswer.ts`, `apps/desktop/src/renderer/src/lib/realtimeConversation.ts`, tests.
- **Spec:** "Pointed element" block, new reference priority, crop label naming the framing
  and pointer position, `captureBlocked` notice.
- **Tests:** context text and image labels for element, pointer-area and blocked cases.

### Task 6: Never-capture apps

- **Files:** shared settings schema/types, `SettingsService.ts`, `ContextCollector.ts`,
  `index.ts`, `SettingsPanel.tsx`, `mauzClient.ts`, tests.
- **Spec:** `captureBlockedApps` setting with default password-manager list; ≤ 50 entries of
  ≤ 120 characters. A match on the foreground app or the pointer window yields
  `captureBlocked` and no pixels or text (spec §3.5).
- **Tests:** match on either app, case-insensitivity, default list, settings round trip.

### Task 7: "What Mauz saw" chip

- **Files:** `apps/desktop/src/renderer/src/lib/lensObject.ts`, `LensPanel.tsx`, `TaskPanel.tsx`,
  `styles.css`, `lensObject.test.ts`.
- **Spec:** Lens object types `element` and `blocked`; the privacy chip names what is sent and
  expands to show the crop thumbnail and the element text.
- **Tests:** `detectLensObject` for element/blocked/pointer-area cases.

### Phase 1 acceptance

- `corepack pnpm -r typecheck` and `corepack pnpm -r test` pass; prettier passes on changed files.
- Live on Windows: shake over a web page product card, a native dialog button and a
  terminal; the Lens chip shows the element, and the answer quotes the exact text.

## Phase 2

**Status (2026-11-04):** OCR and region selection are implemented with unit tests. OCR was
run live through the helper on this machine. The region overlay has not been tried by hand.
macOS element lookup is deferred (spec §3.1).

- Windows OCR fallback in the helper (spec §3.6): `WindowsContextHelper.recognizeText`;
  `ContextCollector` runs it when there is no app or page text, and always for a region.
- User-drawn region (spec §3.7): `RegionSelector`, the `menuSelectRegion` IPC,
  `ContextCollector.collectForRegion`, `PointerCaptureFocus.region`, and the "Select area"
  bubble.
- Deferred: macOS `AXUIElementCopyElementAtPosition` (needs a Mac to build and test).

## Phase 3

**Status (2026-11-04):** Implemented. Live checks on Windows: the unpacked extension in
headless Edge with a temporary profile returned the pointed element, card text and product
data, and refused a blocked host. Native messaging ran end to end (Edge → `.cmd` launcher →
`host.cjs` → named pipe), with the registry key removed afterwards. Chrome has not been
tried. Branded Chrome ignores `--load-extension`, so it needs a manual Load unpacked.

- `browser-extension/`: MV3 extension (`page.js` extraction, `content.js`, `background.js`)
  and `native-host/host.cjs`.
- `BrowserBridge`: pipe server, page requests, re-check against blocked sites, and native host
  registration.
- `captureBlockedSites` setting, Settings sections for blocked sites and the extension,
  `browserStatus` / `browserOpenExtensionFolder` IPC.
- Prompt: `formatScreenContent` (page, element, OCR); Lens types `page` and `region`.
