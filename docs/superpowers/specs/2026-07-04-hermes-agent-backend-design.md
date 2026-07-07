# Design: Pluggable Hermes agent backend for Mauz

**Date:** 2026-07-04
**Status:** Approved (scope and mode decisions confirmed by owner)

## 1. Context

Mauz today is a standalone answering experience: a mouse gesture opens a popover, the
desktop app collects user-approved context (cursor-centered crop, screenshot, selected
text, active app/window), and the local Fastify API (`apps/api`) makes one stateless
OpenAI Responses API call (`askMauz.ts`). There is no memory beyond replaying the last
12 messages as text, no tools, and no ability to act.

The goal is to make Mauz an **agentic experience**: the same gesture surface, but backed
by a real agent runtime with memory, persistence, tool use (MCP, browser, code execution),
and computer use.

The agent runtime is **hermes-agent** (NousResearch), which ships a gateway platform
adapter (`gateway/platforms/api_server.py`) that exposes an **OpenAI-compatible HTTP
API** (default `http://localhost:8642/v1`):

- `POST /v1/responses` — OpenAI Responses format, multimodal (`input_image` with
  `data:image/...` URLs), stateful via `previous_response_id`.
- Session headers: `X-Hermes-Session-Id` (conversation continuity),
  `X-Hermes-Session-Key` (long-term memory scoping; requires gateway API-key auth).
- `GET /v1/capabilities` — advertises the exact header names
  (`session_continuity_header`, `session_key_header`) and feature flags, so any
  custom gateway naming is handled by detection, not hardcoding.
- `POST /v1/runs` + `GET /v1/runs/{id}/events` (SSE) + `POST /v1/runs/{id}/approval`
  (choices: `once`, `session`, `always`, `deny`) + `POST /v1/runs/{id}/stop` — the run
  lifecycle API that surfaces `approval.request` events for gated tool use.

Because Mauz already speaks the OpenAI Responses format, attaching the agent backend is
primarily a matter of making the backend endpoint pluggable and adding the session and
approval plumbing.

## 2. Owner decisions

1. **Backend:** support both the Hermes gateway _and_ any plain OpenAI-compatible
   endpoint, selected in settings. OpenAI direct remains the default.
2. **Depth:** minimal swap — no streaming answer text, no tool timeline. The only new
   popover UI is the mode toggle, approval prompts, and a stop button.
3. **Agent modes:** two — **Approvals** (each gated action surfaces an approval prompt)
   and **YOLO** (full autonomy; Mauz auto-approves).
4. **Voice:** the Talk path stays on OpenAI Realtime, untouched.

## 3. Design

### 3.1 Backend configuration

New settings section (persisted by the existing `SettingsService`, editable in
`SettingsPanel`):

- `backend.preset`: `"openai"` (default) | `"hermes"` | `"custom"`.
- `backend.baseUrl`: string; implied `https://api.openai.com/v1` for `openai`,
  default `http://localhost:8642/v1` for `hermes`, free-form for `custom`.
- `backend.model`: string (existing model default logic applies for `openai`).
- `backend.apiKey`: optional; reuses the existing encrypted key storage. For
  `openai` this is the existing OpenAI key path, unchanged.
- `backend.agentMode`: `"approve"` (default) | `"yolo"` — only meaningful when the
  backend advertises run approvals (capability-detected); hidden otherwise.

`apps/api`'s `askMauz` gains a `baseURL` (OpenAI SDK option) plus optional extra
headers. All backend settings flow desktop → local API per request (the local API
stays stateless about backends).

### 3.2 Capability detection

On backend selection (and cached per baseUrl), the desktop main process calls
`GET {baseUrl}/capabilities`:

- **404 / error** → plain OpenAI-compatible endpoint: no session headers, no agent
  mode toggle, behavior identical to today.
- **200** → read `session_continuity_header`, `session_key_header`, and run/approval
  feature flags; enable agentic features accordingly.

### 3.3 Sessions and memory

- **Conversation continuity:** each Mauz chat conversation (existing
  `ChatHistoryService` conversation id) maps 1:1 to a gateway session id sent via the
  detected continuity header. Follow-up asks in the same popover conversation continue
  the same agent session server-side, replacing the client-side "last 12 messages"
  replay when a gateway backend is active.
- **Long-term memory:** a stable per-install UUID (generated once, stored in settings)
  is sent as the session key header, scoping the agent's persistent memory to this
  Mauz install. Sent only when the gateway has API-key auth configured (the gateway
  rejects session keys otherwise); Mauz degrades gracefully to continuity-only.

### 3.4 Ask flow by mode

- **YOLO mode (Phase 1):** `POST {baseUrl}/responses` with the same multimodal payload
  Mauz builds today (context text + cursor crop + screenshot as `input_image` data
  URLs) plus session headers. The agent runs tools autonomously; Mauz renders the
  final text answer. In Phase 1, the gateway's own approval configuration governs
  gated actions (documented in setup); the Phase 2 runs path makes YOLO fully
  client-driven.
- **Approvals mode (Phase 2):** `POST {baseUrl}/runs` with the same payload; the local
  API subscribes to `GET /runs/{id}/events` (SSE) and forwards two event kinds to the
  desktop over the existing local-API/IPC path: `approval.request` and terminal
  completion. The popover shows the approval description with four buttons —
  **Allow once / Allow for session / Always allow / Deny** — mapping to the gateway's
  approval choices, plus a **Stop** button that calls `POST /runs/{id}/stop`.
- **YOLO mode (Phase 2 final form):** also uses the runs API, but Mauz auto-responds
  `session` to every `approval.request` without showing UI. This keeps YOLO purely
  client-side (no gateway config changes) while the agent's hard floor of
  never-allowed destructive patterns still applies server-side.

### 3.5 What does not change

Gesture detection (`MauzInputAgent`, `ShakeDetector`), context collection and its
consent model, the popover lifecycle, chat history storage, the Talk/Realtime voice
path, and the `openai` default backend behavior. Existing users see zero difference
until they switch the backend preset.

### 3.6 Error handling

- Gateway unreachable → the existing 502/503 error surface in the popover, with a
  message naming the configured backend ("Hermes gateway at localhost:8642 is not
  responding") rather than the generic OpenAI message.
- SSE stream drop mid-run → local API polls `GET /runs/{id}` once for terminal status;
  if still running, surface "lost connection to the agent run" with the Stop button
  still wired (stop is idempotent server-side).
- Approval left unanswered → no client timeout; the run stays parked server-side. The
  popover keeps the prompt until answered or stopped. Closing the popover in Approvals
  mode stops the active run (explicit, predictable containment).
- Invalid/missing capability data → treat as plain OpenAI endpoint (safe degradation).

## 4. Phases

**Phase 1 — pluggable backend + sessions (YOLO-capable via gateway config):**
settings schema + UI, `baseURL`/headers in `askMauz`, capability detection, session
continuity + memory key, error messages. Verified end-to-end against the local Hermes
gateway. Backwards compatible; agent mode toggle not yet shown.

**Phase 2 — agent modes:** runs API client in `apps/api`, SSE event forwarding,
approval prompt + stop button in the popover, mode toggle, YOLO auto-approval.

Each phase extends the existing vitest suites (`askMauz.test.ts`, `askPayload.test.ts`,
`AskApiClient.test.ts`, `SettingsService.test.ts`, `registerIpcHandlers.test.ts`) with
the new paths; the runs/SSE client gets its own unit tests with a mocked gateway.

## 5. Out of scope

Streaming answer text, tool-activity timeline UI, voice through the agent, gateway
process management (Mauz does not launch or supervise the Hermes gateway), upstream
hermes-agent code changes, signed builds, and non-macOS targets.
