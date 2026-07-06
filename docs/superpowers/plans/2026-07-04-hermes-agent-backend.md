# Hermes Agent Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mauz's Ask path backend-pluggable so it can attach to a Hermes agent gateway (memory, tools, computer use) or any OpenAI-compatible endpoint, with Approvals and YOLO agent modes.

**Architecture:** Mauz's local Fastify API (`apps/api`) runs in-process with the Electron main process; settings flow via `process.env`. Phase 1 adds a configurable `baseURL` + gateway session headers to the existing OpenAI Responses call. Phase 2 adds a runs-API client (SSE) so gated tool actions surface approval prompts in the popover.

**Tech Stack:** TypeScript, pnpm monorepo, Zod, Fastify, OpenAI SDK, Electron, React, vitest.

**Spec:** `docs/superpowers/specs/2026-07-04-hermes-agent-backend-design.md`

## Global Constraints

- The `openai` preset must behave byte-for-byte like today: no session headers, no capability probe, `MissingOpenAIKeyError` when no key.
- Gateway facts (verified against hermes-agent `gateway/platforms/api_server.py`):
  - `GET {base}/capabilities` → `{ features: { session_continuity_header: "X-Hermes-Session-Id", session_key_header: "X-Hermes-Session-Key", run_submission: true, run_events_sse: true, run_approval_response: true, ... } }`
  - `POST {base}/responses` — OpenAI Responses format, accepts `input_image` parts with `data:image/...` URLs.
  - `POST {base}/runs` body `{ input, session_id?, instructions? }` → 202 `{ run_id, status: "started" }`.
  - `GET {base}/runs/{id}/events` — SSE; JSON events with `event` field: `message.delta`, `tool.started`, `tool.completed`, `reasoning.available`, `approval.request` (has `choices: ["once","session","always","deny"]`), `approval.responded`, `run.completed` (`output`, `usage`), `run.failed` (`error`), `run.cancelled`. Comment lines (`: keepalive`) must be ignored.
  - `POST {base}/runs/{id}/approval` body `{ choice: "once"|"session"|"always"|"deny" }`; `POST {base}/runs/{id}/stop`.
  - Sending `X-Hermes-Session-Key` to a gateway with **no API-key auth configured** may be rejected — only send it when a backend API key is configured (`MAUZ_BACKEND_API_KEY`).
- Env contract (set by desktop main `applyRuntimeEnvironment`, read by `apps/api`): `MAUZ_BACKEND_BASE_URL` (unset ⇒ OpenAI direct), `MAUZ_BACKEND_API_KEY` (optional, env-only in this build), `MAUZ_AGENT_MODE` (`approve`|`yolo`), `MAUZ_INSTALL_ID` (UUID).
- Commit format `<type>: <description>`, no attribution footer.
- Run tests from the repo root: `pnpm --filter @mauzai/api test` / `pnpm --filter @mauzai/desktop test`. Type-check with `pnpm -r typecheck` if defined, else `pnpm -r build`.

---

## Phase 1 — pluggable backend + sessions

### Task 1: Shared schemas — backend settings, sessionId, constants

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types.ts` (only if it declares explicit `z.infer` exports — mirror the existing pattern for the two new enums)
- Test: `apps/api/tests/askPayload.test.ts`

**Interfaces:**
- Produces: `BackendPresetSchema` (`"openai" | "hermes-gateway" | "custom"`), `AgentModeSchema` (`"approve" | "yolo"`), `MauzSettingsSchema` fields `backendPreset`, `backendBaseUrl`, `agentMode`; `AskMauzRequestSchema.sessionId?: string`; `DEFAULT_HERMES_GATEWAY_BASE_URL`.

- [ ] **Step 1: Write failing tests** — append to `apps/api/tests/askPayload.test.ts`:

```typescript
import { AskMauzRequestSchema, MauzSettingsSchema, DEFAULT_HERMES_GATEWAY_BASE_URL } from "@mauzai/shared";

describe("backend schema additions", () => {
  it("accepts an optional sessionId on ask requests", () => {
    const parsed = AskMauzRequestSchema.parse({
      question: "hi",
      context: buildContext(), // reuse the existing context fixture helper in this file
      sessionId: "conv-123"
    });
    expect(parsed.sessionId).toBe("conv-123");
  });

  it("rejects a blank sessionId", () => {
    expect(() =>
      AskMauzRequestSchema.parse({ question: "hi", context: buildContext(), sessionId: " " })
    ).toThrow();
  });

  it("parses backend settings fields", () => {
    const settings = MauzSettingsSchema.parse({
      ...buildSettingsFixture(), // reuse/construct a full valid settings object in this file
      backendPreset: "hermes-gateway",
      backendBaseUrl: "http://localhost:8642/v1",
      agentMode: "yolo"
    });
    expect(settings.backendPreset).toBe("hermes-gateway");
  });

  it("exports the Hermes gateway default base URL", () => {
    expect(DEFAULT_HERMES_GATEWAY_BASE_URL).toBe("http://localhost:8642/v1");
  });
});
```

If the file has no settings fixture, build one inline with every `MauzSettingsSchema` field (see `packages/shared/src/schemas.ts:58-72` for the full list; use defaults like `nativeShakeEnabled: true`, `askModel: "gpt-5.4-mini"`, `apiKeyConfigured: false`, `openAiCredentialSource: "none"`, `openAiAuthMode: "api-key"`, `openAiAuthDisconnected: false`).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/api test -- askPayload` → FAIL (unknown fields stripped / missing export).

- [ ] **Step 3: Implement.** In `packages/shared/src/schemas.ts`, below `OpenAiCredentialSourceSchema` (line 56):

```typescript
export const BackendPresetSchema = z.enum(["openai", "hermes-gateway", "custom"]);
export const AgentModeSchema = z.enum(["approve", "yolo"]);
```

Extend `MauzSettingsSchema` (inside the object, after `apiKeyConfigured`):

```typescript
  backendPreset: BackendPresetSchema,
  backendBaseUrl: z.string().trim().max(400),
  agentMode: AgentModeSchema
```

Extend `AskMauzRequestSchema` (after `conversationMessages`):

```typescript
  sessionId: z.string().trim().min(1).max(128).optional()
```

In `packages/shared/src/constants.ts` append:

```typescript
export const DEFAULT_HERMES_GATEWAY_BASE_URL = "http://localhost:8642/v1";
```

In `packages/shared/src/types.ts`, if it contains explicit inferred-type exports (e.g. `export type MauzSettings = z.infer<...>`), add:

```typescript
export type BackendPreset = z.infer<typeof BackendPresetSchema>;
export type AgentMode = z.infer<typeof AgentModeSchema>;
```

- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/api test -- askPayload` → PASS. Also run `pnpm --filter @mauzai/desktop test` — **expect SettingsService tests to fail** because `MauzSettingsSchema` now requires the three fields; that is Task 2's job. If they fail only for the new fields, proceed.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: add backend settings and sessionId to shared schemas"`

### Task 2: SettingsService — backend fields + stable install id

**Files:**
- Modify: `apps/desktop/src/main/settings/SettingsService.ts`
- Test: `apps/desktop/tests/SettingsService.test.ts`

**Interfaces:**
- Consumes: Task 1 schema fields.
- Produces: `StoredMauzSettings`/`MauzRuntimeSettings` gain `backendPreset`, `backendBaseUrl`, `agentMode`, `installId: string`. `installId` is storage-only (not in the public `MauzSettings`), surfaces through `getRuntime()`.

- [ ] **Step 1: Write failing tests** in `apps/desktop/tests/SettingsService.test.ts` (follow the file's existing in-memory `readTextFile`/`writeTextFile` harness):

```typescript
it("defaults backend settings and generates a stable installId", async () => {
  const service = createService(); // existing helper pattern in this file
  const runtime = await service.getRuntime();
  expect(runtime.backendPreset).toBe("openai");
  expect(runtime.backendBaseUrl).toBe("");
  expect(runtime.agentMode).toBe("approve");
  expect(runtime.installId).toMatch(/^[0-9a-f-]{36}$/);
});

it("persists installId across loads once written", async () => {
  const files = new Map<string, string>();
  const service = createServiceWithFiles(files);
  const first = (await service.getRuntime()).installId;
  await service.update({ askModel: "gpt-5.4-mini" }); // forces a write
  const service2 = createServiceWithFiles(files);
  expect((await service2.getRuntime()).installId).toBe(first);
});

it("updates backend settings", async () => {
  const service = createService();
  const settings = await service.update({
    backendPreset: "hermes-gateway",
    backendBaseUrl: "http://localhost:8642/v1",
    agentMode: "yolo"
  });
  expect(settings.backendPreset).toBe("hermes-gateway");
  expect(settings.agentMode).toBe("yolo");
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/desktop test -- SettingsService` → FAIL.
- [ ] **Step 3: Implement** in `SettingsService.ts`:
  - `import { randomUUID } from "node:crypto";`
  - `StoredMauzSettings` already picks up the three public fields via `Omit<MauzSettings, ...>`; add `installId: string;` to the type:
    ```typescript
    type StoredMauzSettings = Omit<MauzSettings, "apiKeyConfigured" | "openAiCredentialSource"> & {
      encryptedOpenAiApiKey?: string | undefined;
      installId: string;
    };
    ```
  - `getDefaultSettings()` additions:
    ```typescript
    backendPreset:
      process.env.MAUZ_BACKEND_PRESET === "hermes-gateway" || process.env.MAUZ_BACKEND_PRESET === "custom"
        ? process.env.MAUZ_BACKEND_PRESET
        : "openai",
    backendBaseUrl: process.env.MAUZ_BACKEND_BASE_URL?.trim() ?? "",
    agentMode: process.env.MAUZ_AGENT_MODE === "yolo" ? "yolo" : "approve",
    installId: randomUUID()
    ```
  - `update()`: add three `applyDefinedSetting` lines for `backendPreset`, `backendBaseUrl`, `agentMode` after the `includeFullScreenshot` line.
  - `parseStoredSettings()`: copy the three public fields from `publicSettings.data`; preserve stored `installId` when it is a non-empty string, else keep the generated default:
    ```typescript
    installId:
      typeof parsedRecord.installId === "string" && parsedRecord.installId.trim().length > 0
        ? parsedRecord.installId.trim()
        : getDefaultSettings().installId
    ```
    (Bind `getDefaultSettings()` once at the top of the function to avoid generating two different UUIDs in one parse.)
  - `shouldSanitizeStoredSettings()`: also return `true` when `!("installId" in parsed)` so pre-existing installs persist their id on first launch.
  - `toPublicSettings()`: include `backendPreset`, `backendBaseUrl`, `agentMode` (NOT `installId`).
- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/desktop test -- SettingsService` → PASS; run the full desktop suite to catch fixture fallout: `pnpm --filter @mauzai/desktop test`.
- [ ] **Step 5: Commit** — `git commit -am "feat: persist backend settings and install id in SettingsService"`

### Task 3: Backend capability detection module

**Files:**
- Create: `apps/api/src/backend/capabilities.ts`
- Test: `apps/api/tests/backendCapabilities.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type BackendCapabilities = {
    sessionIdHeader: string;
    sessionKeyHeader: string;
    supportsRuns: boolean;
  };
  export async function detectBackendCapabilities(
    baseUrl: string,
    fetchImpl?: typeof fetch
  ): Promise<BackendCapabilities | null>;
  export function clearBackendCapabilitiesCache(): void;
  ```

- [ ] **Step 1: Write failing tests** in `apps/api/tests/backendCapabilities.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearBackendCapabilitiesCache,
  detectBackendCapabilities
} from "../src/backend/capabilities";

const GATEWAY_CAPABILITIES = {
  object: "hermes.api_server.capabilities",
  features: {
    responses_api: true,
    run_submission: true,
    run_events_sse: true,
    run_approval_response: true,
    session_continuity_header: "X-Hermes-Session-Id",
    session_key_header: "X-Hermes-Session-Key"
  }
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => clearBackendCapabilitiesCache());

describe("detectBackendCapabilities", () => {
  it("parses gateway capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(GATEWAY_CAPABILITIES));
    const caps = await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(caps).toEqual({
      sessionIdHeader: "X-Hermes-Session-Id",
      sessionKeyHeader: "X-Hermes-Session-Key",
      supportsRuns: true
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/capabilities", expect.anything());
  });

  it("returns null for plain OpenAI-compatible endpoints (404)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await detectBackendCapabilities("https://api.example.com/v1", fetchMock)).toBeNull();
  });

  it("returns null when the probe throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await detectBackendCapabilities("http://localhost:9/v1", fetchMock)).toBeNull();
  });

  it("caches per baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(GATEWAY_CAPABILITIES));
    await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat missing run features as runs support", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({ features: { session_continuity_header: "X-Hermes-Session-Id", session_key_header: "X-Hermes-Session-Key" } })
    );
    const caps = await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(caps).toEqual({
      sessionIdHeader: "X-Hermes-Session-Id",
      sessionKeyHeader: "X-Hermes-Session-Key",
      supportsRuns: false
    });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/api test -- backendCapabilities` → FAIL (module not found).
- [ ] **Step 3: Implement** `apps/api/src/backend/capabilities.ts`:

```typescript
export type BackendCapabilities = {
  sessionIdHeader: string;
  sessionKeyHeader: string;
  supportsRuns: boolean;
};

const capabilitiesCache = new Map<string, BackendCapabilities | null>();
const PROBE_TIMEOUT_MS = 3_000;

export async function detectBackendCapabilities(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<BackendCapabilities | null> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  if (capabilitiesCache.has(normalizedBaseUrl)) {
    return capabilitiesCache.get(normalizedBaseUrl) ?? null;
  }

  const capabilities = await probeCapabilities(normalizedBaseUrl, fetchImpl);
  capabilitiesCache.set(normalizedBaseUrl, capabilities);

  return capabilities;
}

export function clearBackendCapabilitiesCache(): void {
  capabilitiesCache.clear();
}

async function probeCapabilities(
  baseUrl: string,
  fetchImpl: typeof fetch
): Promise<BackendCapabilities | null> {
  try {
    const response = await fetchImpl(`${baseUrl}/capabilities`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });

    if (!response.ok) {
      return null;
    }

    return parseCapabilities(await response.json());
  } catch {
    return null;
  }
}

function parseCapabilities(body: unknown): BackendCapabilities | null {
  if (typeof body !== "object" || body === null || !("features" in body)) {
    return null;
  }

  const features = (body as { features: unknown }).features;

  if (typeof features !== "object" || features === null) {
    return null;
  }

  const featureRecord = features as Record<string, unknown>;
  const sessionIdHeader = featureRecord.session_continuity_header;
  const sessionKeyHeader = featureRecord.session_key_header;

  if (typeof sessionIdHeader !== "string" || typeof sessionKeyHeader !== "string") {
    return null;
  }

  return {
    sessionIdHeader,
    sessionKeyHeader,
    supportsRuns:
      featureRecord.run_submission === true &&
      featureRecord.run_events_sse === true &&
      featureRecord.run_approval_response === true
  };
}
```

- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/api test -- backendCapabilities` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: add backend capability detection for agent gateways"`

### Task 4: askMauz — baseURL, session headers, backend-aware errors

**Files:**
- Modify: `apps/api/src/openai/askMauz.ts`
- Modify: `apps/api/src/errors.ts`
- Modify: `apps/api/src/routes/ask.ts`
- Test: `apps/api/tests/askMauz.test.ts`

**Interfaces:**
- Consumes: `detectBackendCapabilities` (Task 3), `AskMauzRequest.sessionId` (Task 1).
- Produces: `AskMauzOptions` gains `baseUrl?: string`, `backendApiKey?: string`, `installId?: string`, `fetchImpl?: typeof fetch`. New `BackendUnreachableError` in `errors.ts`. Route maps it to 503 with the backend-named message.

- [ ] **Step 1: Write failing tests** — add to `apps/api/tests/askMauz.test.ts` (reuse the file's existing mocked-OpenAI-client pattern; it constructs `askMauz(request, { client })`):

```typescript
it("sends session headers when a gateway backend is detected", async () => {
  const create = vi.fn().mockResolvedValue({ output_text: "ok", usage: undefined });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        features: {
          session_continuity_header: "X-Hermes-Session-Id",
          session_key_header: "X-Hermes-Session-Key",
          run_submission: true,
          run_events_sse: true,
          run_approval_response: true
        }
      }),
      { status: 200 }
    )
  );
  const response = await askMauz(
    { ...buildRequest(), sessionId: "conv-1" },
    {
      client: { responses: { create } } as never,
      baseUrl: "http://localhost:8642/v1",
      backendApiKey: "gw-key",
      installId: "install-uuid",
      fetchImpl: fetchMock
    }
  );
  expect(response.answer).toBe("ok");
  const requestOptions = create.mock.calls[0]?.[1];
  expect(requestOptions?.headers).toMatchObject({
    "X-Hermes-Session-Id": "conv-1",
    "X-Hermes-Session-Key": "install-uuid"
  });
});

it("omits the session key header without a backend api key", async () => {
  const create = vi.fn().mockResolvedValue({ output_text: "ok" });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        features: {
          session_continuity_header: "X-Hermes-Session-Id",
          session_key_header: "X-Hermes-Session-Key"
        }
      }),
      { status: 200 }
    )
  );
  await askMauz(
    { ...buildRequest(), sessionId: "conv-1" },
    {
      client: { responses: { create } } as never,
      baseUrl: "http://localhost:8642/v1",
      installId: "install-uuid",
      fetchImpl: fetchMock
    }
  );
  const requestOptions = create.mock.calls[0]?.[1];
  expect(requestOptions?.headers).not.toHaveProperty("X-Hermes-Session-Key");
});

it("does not require an OpenAI key when a custom backend is configured", async () => {
  const create = vi.fn().mockResolvedValue({ output_text: "ok" });
  const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
  await expect(
    askMauz(buildRequest(), {
      client: { responses: { create } } as never,
      baseUrl: "http://localhost:8642/v1",
      fetchImpl: fetchMock
    })
  ).resolves.toMatchObject({ answer: "ok" });
});

it("raises BackendUnreachableError when the backend connection fails", async () => {
  const create = vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), { name: "APIConnectionError" }));
  const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
  await expect(
    askMauz(buildRequest(), {
      client: { responses: { create } } as never,
      baseUrl: "http://localhost:8642/v1",
      fetchImpl: fetchMock
    })
  ).rejects.toThrow(/localhost:8642 is not responding/);
});
```

Remember `clearBackendCapabilitiesCache()` in this file's `afterEach`.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/api test -- askMauz` → FAIL.
- [ ] **Step 3: Implement.**
  - `apps/api/src/errors.ts`:
    ```typescript
    export class BackendUnreachableError extends Error {
      constructor(baseUrl: string, options: { cause?: unknown } = {}) {
        super(
          `Mauz backend at ${formatBackendHost(baseUrl)} is not responding. Check that it is running, then try again.`,
          options.cause === undefined ? undefined : { cause: options.cause }
        );
        this.name = "BackendUnreachableError";
      }
    }

    function formatBackendHost(baseUrl: string): string {
      try {
        return new URL(baseUrl).host;
      } catch {
        return baseUrl;
      }
    }
    ```
  - `apps/api/src/openai/askMauz.ts`:
    ```typescript
    export type AskMauzOptions = {
      apiKey?: string;
      model?: string;
      client?: OpenAI;
      baseUrl?: string;
      backendApiKey?: string;
      installId?: string;
      fetchImpl?: typeof fetch;
    };
    ```
    In the function body, replace the key/client bootstrap:
    ```typescript
    const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.MAUZ_BACKEND_BASE_URL);
    const backendApiKey = options.backendApiKey ?? process.env.MAUZ_BACKEND_API_KEY?.trim() ?? undefined;
    const installId = options.installId ?? process.env.MAUZ_INSTALL_ID?.trim() ?? undefined;
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

    if (baseUrl === undefined && !apiKey && options.client === undefined) {
      throw new MissingOpenAIKeyError();
    }

    const client =
      options.client ??
      (baseUrl === undefined
        ? new OpenAI({ apiKey })
        : new OpenAI({ apiKey: backendApiKey ?? "mauz-local-backend", baseURL: baseUrl }));

    const capabilities =
      baseUrl === undefined ? null : await detectBackendCapabilities(baseUrl, options.fetchImpl ?? fetch);
    const headers = buildBackendHeaders(capabilities, request.sessionId, backendApiKey ? installId : undefined);
    ```
    Wrap the `client.responses.create` call:
    ```typescript
    let response;
    try {
      response = await client.responses.create(
        { /* unchanged payload */ },
        Object.keys(headers).length > 0 ? { headers } : undefined
      );
    } catch (error) {
      if (baseUrl !== undefined && isConnectionError(error)) {
        throw new BackendUnreachableError(baseUrl, { cause: error });
      }
      throw error;
    }
    ```
    New helpers at the bottom of the file:
    ```typescript
    function normalizeBaseUrl(value: string | undefined): string | undefined {
      const trimmed = value?.trim() ?? "";
      return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : undefined;
    }

    function buildBackendHeaders(
      capabilities: BackendCapabilities | null,
      sessionId: string | undefined,
      installId: string | undefined
    ): Record<string, string> {
      if (capabilities === null) {
        return {};
      }
      return {
        ...(sessionId === undefined ? {} : { [capabilities.sessionIdHeader]: sessionId }),
        ...(installId === undefined ? {} : { [capabilities.sessionKeyHeader]: installId })
      };
    }

    function isConnectionError(error: unknown): boolean {
      if (typeof error !== "object" || error === null) {
        return false;
      }
      if ("name" in error && error.name === "APIConnectionError") {
        return true;
      }
      return "cause" in error && isConnectionError(error.cause);
    }
    ```
  - `apps/api/src/routes/ask.ts`: import `BackendUnreachableError`; in the catch block, before the generic 502:
    ```typescript
    if (error instanceof BackendUnreachableError) {
      return reply.status(503).send({ error: error.message });
    }
    ```
- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/api test` (full API suite) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: route asks through a configurable backend with gateway session headers"`

### Task 5: Desktop env plumbing + sessionId forwarding

**Files:**
- Modify: `apps/desktop/src/main/index.ts:132-145` (`applyRuntimeEnvironment`)
- Modify: `apps/desktop/src/main/ipc/registerIpcHandlers.ts:169-173` (`chatHistoryContinue`)
- Test: `apps/desktop/tests/registerIpcHandlers.test.ts`

**Interfaces:**
- Consumes: `MauzRuntimeSettings.backendPreset/backendBaseUrl/agentMode/installId` (Task 2), `DEFAULT_HERMES_GATEWAY_BASE_URL` (Task 1).
- Produces: env vars per Global Constraints; continue-chat asks carry `sessionId`.

- [ ] **Step 1: Write failing test** in `apps/desktop/tests/registerIpcHandlers.test.ts` (follow the file's existing fake-fetch/handler harness): assert that invoking the `chatHistoryContinue` handler results in a `POST /api/ask` body containing `"sessionId":"<conversation id>"`.

```typescript
it("forwards the conversation id as sessionId when continuing a chat", async () => {
  // reuse the existing harness that registers handlers with a stubbed fetch;
  // invoke the chatHistoryContinue handler for a stored conversation with id "conv-42"
  // and inspect the JSON body sent to /api/ask:
  expect(capturedAskBody.sessionId).toBe("conv-42");
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/desktop test -- registerIpcHandlers` → FAIL.
- [ ] **Step 3: Implement.**
  - `registerIpcHandlers.ts` `chatHistoryContinue`:
    ```typescript
    const response = await submitAskToLocalApi(api, localApiToken, {
      question: request.question,
      context,
      conversationMessages: conversation.messages,
      sessionId: request.id
    });
    ```
  - `index.ts` `applyRuntimeEnvironment` — append (import `DEFAULT_HERMES_GATEWAY_BASE_URL` from `@mauzai/shared`):
    ```typescript
    const backendBaseUrl = resolveBackendBaseUrl(settings);

    if (backendBaseUrl === undefined) {
      delete process.env.MAUZ_BACKEND_BASE_URL;
    } else {
      process.env.MAUZ_BACKEND_BASE_URL = backendBaseUrl;
    }

    process.env.MAUZ_AGENT_MODE = settings.agentMode;
    process.env.MAUZ_INSTALL_ID = settings.installId;
    ```
    New function below `applyRuntimeEnvironment`:
    ```typescript
    function resolveBackendBaseUrl(settings: MauzRuntimeSettings): string | undefined {
      if (settings.backendPreset === "openai") {
        return undefined;
      }

      const configured = settings.backendBaseUrl.trim();

      if (configured.length > 0) {
        return configured;
      }

      return settings.backendPreset === "hermes-gateway" ? DEFAULT_HERMES_GATEWAY_BASE_URL : undefined;
    }
    ```
    Note: `MAUZ_BACKEND_API_KEY` is intentionally env-only in this build (set it before launching Mauz when the gateway requires auth); do not plumb it through settings.
- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/desktop test` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: plumb backend env vars and continue-chat session ids"`

### Task 6: Settings UI — Backend section

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/SettingsPanel.tsx`
- Test: none automated (the repo has no renderer component tests); verified in Task 7.

**Interfaces:**
- Consumes: settings fields from Task 1/2 (already in the `MauzSettings` draft object), `DEFAULT_HERMES_GATEWAY_BASE_URL`.

- [ ] **Step 1: Add draft plumbing.** The panel edits a `draft: MauzSettings` object via `updateDraft(key, value)`; the new fields are already part of `MauzSettings`, so no state changes are needed.
- [ ] **Step 2: Add the section JSX** after the model-selection section (the one containing the `askModel` `SettingsSelect` at ~line 351), reusing the existing `SettingsSelect` component (defined at the bottom of the file):

```tsx
<div className="settings-section">
  <div className="settings-label">
    <Server aria-hidden="true" size={15} />
    <span>Backend</span>
  </div>
  <SettingsSelect
    label="Provider"
    value={draft.backendPreset}
    options={["openai", "hermes-gateway", "custom"]}
    onChange={(backendPreset) =>
      updateDraft("backendPreset", backendPreset as MauzSettings["backendPreset"])
    }
  />
  {draft.backendPreset !== "openai" ? (
    <>
      <label className="settings-field">
        <span>Base URL</span>
        <input
          type="text"
          value={draft.backendBaseUrl}
          placeholder={draft.backendPreset === "hermes-gateway" ? DEFAULT_HERMES_GATEWAY_BASE_URL : "https://host/v1"}
          onChange={(event) => updateDraft("backendBaseUrl", event.target.value)}
        />
      </label>
      <SettingsSelect
        label="Agent mode"
        value={draft.agentMode}
        options={["approve", "yolo"]}
        onChange={(agentMode) => updateDraft("agentMode", agentMode as MauzSettings["agentMode"])}
      />
    </>
  ) : null}
</div>
```

Import `Server` from `lucide-react` alongside the existing icon imports, and `DEFAULT_HERMES_GATEWAY_BASE_URL` from `@mauzai/shared`.

- [ ] **Step 3: Extend `handleSave`** (~line 201) — add to the `update` object:

```typescript
backendPreset: draft.backendPreset,
backendBaseUrl: draft.backendBaseUrl,
agentMode: draft.agentMode
```

- [ ] **Step 4: Verify** — `pnpm --filter @mauzai/desktop test` (no regressions) and `pnpm -r build` (or the repo's typecheck script) → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: add backend provider section to settings panel"`

### Task 7: Phase 1 E2E verification + setup docs

**Files:**
- Modify: `setup.md` (new "Hermes agent backend" section)
- No code changes.

- [ ] **Step 1: Start the Hermes gateway** with the API-server platform enabled (`API_SERVER_ENABLED=true`; the platform listens on `127.0.0.1:8642`). Confirm: `curl -s http://localhost:8642/v1/capabilities | head -c 200` returns the capabilities JSON (or, with auth enabled, a 401 — then export the key as `MAUZ_BACKEND_API_KEY`).
- [ ] **Step 2: Run Mauz from source** (`pnpm --filter @mauzai/desktop dev` per `setup.md`), open Settings → Backend, choose `hermes-gateway`, save.
- [ ] **Step 3: Verify agentic answering** — gesture → Ask → a question that requires a tool (e.g. "what's in my home directory?" or a live web question). Expect an agent answer, not an OpenAI refusal.
- [ ] **Step 4: Verify continuity** — from the desktop history window, continue a conversation and confirm the gateway session log shows the same session id across turns.
- [ ] **Step 5: Verify fallback** — switch preset back to `openai` and confirm asks behave exactly as before (including the missing-key 503 when no `OPENAI_API_KEY`).
- [ ] **Step 6: Document** in `setup.md`: the three presets, the default gateway URL, `MAUZ_BACKEND_API_KEY` for authed gateways, and the Phase 1 note that tool approvals are governed by the gateway's own approval configuration until agent modes land.
- [ ] **Step 7: Commit** — `git commit -am "docs: document Hermes gateway backend setup"`

---

## Phase 2 — agent modes (approvals + YOLO via runs API)

### Task 8: Runs API client

**Files:**
- Create: `apps/api/src/backend/runsClient.ts`
- Test: `apps/api/tests/runsClient.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type RunEvent = { event: string; run_id?: string } & Record<string, unknown>;
  export type RunsClientOptions = { baseUrl: string; apiKey?: string; fetchImpl?: typeof fetch };
  export async function startRun(
    options: RunsClientOptions & { input: unknown; instructions?: string; sessionId?: string; sessionKey?: string }
  ): Promise<{ runId: string }>;
  export async function* streamRunEvents(options: RunsClientOptions & { runId: string }): AsyncGenerator<RunEvent>;
  export async function resolveRunApproval(
    options: RunsClientOptions & { runId: string; choice: "once" | "session" | "always" | "deny" }
  ): Promise<void>;
  export async function stopRun(options: RunsClientOptions & { runId: string }): Promise<void>;
  export type RunStatus = { status: string; output?: string; usage?: unknown };
  export async function getRunStatus(options: RunsClientOptions & { runId: string }): Promise<RunStatus | null>;
  ```

- [ ] **Step 1: Write failing tests** in `apps/api/tests/runsClient.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { getRunStatus, resolveRunApproval, startRun, stopRun, streamRunEvents } from "../src/backend/runsClient";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("runsClient", () => {
  it("starts a run with session id, key and auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ run_id: "run_abc", status: "started" }), { status: 202 })
    );
    const result = await startRun({
      baseUrl: "http://localhost:8642/v1",
      apiKey: "gw",
      input: [{ role: "user", content: "hi" }],
      instructions: "system prompt",
      sessionId: "conv-1",
      sessionKey: "install-1",
      fetchImpl: fetchMock
    });
    expect(result.runId).toBe("run_abc");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8642/v1/runs");
    expect(init.headers).toMatchObject({
      authorization: "Bearer gw",
      "X-Hermes-Session-Key": "install-1"
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      input: [{ role: "user", content: "hi" }],
      instructions: "system prompt",
      session_id: "conv-1"
    });
  });

  it("parses SSE events and ignores keepalive comments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        ": keepalive\n\n",
        'data: {"event":"tool.started","run_id":"r","tool":"terminal"}\n\n',
        'data: {"event":"run.completed","run_id":"r","output":"done",',
        '"usage":{"total_tokens":5}}\n\n'
      ])
    );
    const events = [];
    for await (const event of streamRunEvents({ baseUrl: "http://x/v1", runId: "r", fetchImpl: fetchMock })) {
      events.push(event);
    }
    expect(events.map((event) => event.event)).toEqual(["tool.started", "run.completed"]);
    expect(events[1]?.output).toBe("done");
  });

  it("posts approval choices", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await resolveRunApproval({ baseUrl: "http://x/v1", runId: "r", choice: "session", fetchImpl: fetchMock });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://x/v1/runs/r/approval");
    expect(JSON.parse(init.body as string)).toEqual({ choice: "session" });
  });

  it("returns run status and null for unknown runs", async () => {
    const okMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: "done" }), { status: 200 })
    );
    expect(await getRunStatus({ baseUrl: "http://x/v1", runId: "r", fetchImpl: okMock })).toMatchObject({
      status: "completed",
      output: "done"
    });

    const missingMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await getRunStatus({ baseUrl: "http://x/v1", runId: "r", fetchImpl: missingMock })).toBeNull();
  });

  it("stops runs and throws on failed start", async () => {
    const stopMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await stopRun({ baseUrl: "http://x/v1", runId: "r", fetchImpl: stopMock });
    expect(stopMock.mock.calls[0]![0]).toBe("http://x/v1/runs/r/stop");

    const failMock = vi.fn().mockResolvedValue(new Response("busy", { status: 429 }));
    await expect(
      startRun({ baseUrl: "http://x/v1", input: "hi", fetchImpl: failMock })
    ).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/api test -- runsClient` → FAIL.
- [ ] **Step 3: Implement** `apps/api/src/backend/runsClient.ts`:

```typescript
export type RunEvent = { event: string; run_id?: string } & Record<string, unknown>;

export type RunsClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export async function startRun(
  options: RunsClientOptions & {
    input: unknown;
    instructions?: string;
    sessionId?: string;
    sessionKey?: string;
  }
): Promise<{ runId: string }> {
  const response = await request(options, "POST", "/runs", {
    body: {
      input: options.input,
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
      ...(options.sessionId === undefined ? {} : { session_id: options.sessionId })
    },
    extraHeaders:
      options.sessionKey === undefined ? {} : { [sessionKeyHeader]: options.sessionKey }
  });
  const body = (await response.json()) as { run_id?: string };

  if (typeof body.run_id !== "string" || body.run_id.length === 0) {
    throw new Error("Agent backend did not return a run id.");
  }

  return { runId: body.run_id };
}

export async function* streamRunEvents(
  options: RunsClientOptions & { runId: string }
): AsyncGenerator<RunEvent> {
  const response = await request(options, "GET", `/runs/${options.runId}/events`);

  if (response.body === null) {
    throw new Error("Agent backend returned no event stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");

      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const event = parseSseEvent(rawEvent);

        if (event !== null) {
          yield event;
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function resolveRunApproval(
  options: RunsClientOptions & { runId: string; choice: "once" | "session" | "always" | "deny" }
): Promise<void> {
  await request(options, "POST", `/runs/${options.runId}/approval`, {
    body: { choice: options.choice }
  });
}

export async function stopRun(options: RunsClientOptions & { runId: string }): Promise<void> {
  await request(options, "POST", `/runs/${options.runId}/stop`);
}

export type RunStatus = { status: string; output?: string; usage?: unknown };

export async function getRunStatus(
  options: RunsClientOptions & { runId: string }
): Promise<RunStatus | null> {
  try {
    const response = await request(options, "GET", `/runs/${options.runId}`);
    const body = (await response.json()) as unknown;

    if (typeof body === "object" && body !== null && "status" in body) {
      return body as RunStatus;
    }

    return null;
  } catch {
    return null;
  }
}

async function request(
  options: RunsClientOptions,
  method: "GET" | "POST",
  path: string,
  init: { body?: unknown; extraHeaders?: Record<string, string> } = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
      ...(init.extraHeaders ?? {})
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
  });

  if (!response.ok && response.status !== 202) {
    throw new Error(`Agent backend request ${method} ${path} failed with status ${response.status}.`);
  }

  return response;
}

function parseSseEvent(rawEvent: string): RunEvent | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(dataLines.join("")) as unknown;

    if (typeof parsed === "object" && parsed !== null && "event" in parsed) {
      return parsed as RunEvent;
    }

    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/api test -- runsClient` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: add agent runs API client with SSE event streaming"`

### Task 9: askViaRuns orchestration + ask dispatch

**Files:**
- Create: `apps/api/src/backend/askViaRuns.ts`
- Modify: `apps/api/src/routes/ask.ts` (dispatch + new options)
- Modify: `apps/api/src/server.ts` (thread options through)
- Modify: `apps/api/src/errors.ts` (add `AgentRunStoppedError`)
- Test: `apps/api/tests/askViaRuns.test.ts`

**Interfaces:**
- Consumes: `startRun`/`streamRunEvents`/`resolveRunApproval` (Task 8), `buildResponseContent` + `MAUZ_SYSTEM_PROMPT` (existing `askMauz.ts` exports — `buildResponseContent` is already exported), `detectBackendCapabilities` (Task 3).
- Produces:
  ```typescript
  export type AgentApprovalChoice = "once" | "session" | "always" | "deny";
  export type AgentApprovalRequest = { runId: string; description: string; raw: Record<string, unknown> };
  export type ApprovalRequestHandler = (request: AgentApprovalRequest) => Promise<AgentApprovalChoice>;
  export type RunLifecycleHooks = {
    onApprovalRequest?: ApprovalRequestHandler;
    onRunStarted?: (run: { runId: string }) => void;
    onRunFinished?: (run: { runId: string }) => void;
  };
  export async function askViaRuns(
    request: AskMauzRequest,
    options: {
      baseUrl: string; model: string; agentMode: "approve" | "yolo";
      apiKey?: string; installId?: string; fetchImpl?: typeof fetch;
    } & RunLifecycleHooks
  ): Promise<AskMauzResponse>;
  ```
  `CreateMauzApiServerOptions` and `RegisterAskRouteOptions` both gain `runHooks?: RunLifecycleHooks`.

- [ ] **Step 1: Write failing tests** in `apps/api/tests/askViaRuns.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { askViaRuns } from "../src/backend/askViaRuns";

function runsFetchMock(events: string[]): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/runs")) {
      return Promise.resolve(new Response(JSON.stringify({ run_id: "run_1", status: "started" }), { status: 202 }));
    }
    if (url.endsWith("/events")) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(new TextEncoder().encode(`data: ${event}\n\n`));
          }
          controller.close();
        }
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
}

const BASE_OPTIONS = {
  baseUrl: "http://localhost:8642/v1",
  model: "hermes-agent",
  installId: "install-1"
} as const;

describe("askViaRuns", () => {
  it("returns the run output as the answer", async () => {
    const fetchImpl = runsFetchMock(['{"event":"run.completed","run_id":"run_1","output":"answer text","usage":{"total_tokens":9}}']);
    const response = await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl });
    expect(response).toMatchObject({ answer: "answer text", model: "hermes-agent" });
  });

  it("auto-approves in yolo mode without invoking the handler", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"approval.request","run_id":"run_1","description":"run terminal command"}',
      '{"event":"run.completed","run_id":"run_1","output":"done"}'
    ]);
    const onApprovalRequest = vi.fn();
    await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl, onApprovalRequest });
    expect(onApprovalRequest).not.toHaveBeenCalled();
    const approvalCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/approval"));
    expect(approvalCall).toBeDefined();
    expect(JSON.parse(approvalCall![1].body as string)).toEqual({ choice: "session" });
  });

  it("asks the approval handler in approve mode and forwards the choice", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"approval.request","run_id":"run_1","description":"edit file"}',
      '{"event":"run.completed","run_id":"run_1","output":"done"}'
    ]);
    const onApprovalRequest = vi.fn().mockResolvedValue("deny");
    await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "approve", fetchImpl, onApprovalRequest });
    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run_1", description: "edit file" })
    );
    const approvalCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/approval"));
    expect(JSON.parse(approvalCall![1].body as string)).toEqual({ choice: "deny" });
  });

  it("throws on run.failed and on run.cancelled", async () => {
    const failed = runsFetchMock(['{"event":"run.failed","run_id":"run_1","error":"boom"}']);
    await expect(askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl: failed })).rejects.toThrow("boom");

    const cancelled = runsFetchMock(['{"event":"run.cancelled","run_id":"run_1"}']);
    await expect(
      askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl: cancelled })
    ).rejects.toThrow(/stopped/i);
  });
});
```

(`buildRequest()` — reuse or copy the minimal valid `AskMauzRequest` fixture used in `askMauz.test.ts`.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/api test -- askViaRuns` → FAIL.
- [ ] **Step 3: Implement** `apps/api/src/backend/askViaRuns.ts`:

```typescript
import type { AskMauzRequest, AskMauzResponse } from "@mauzai/shared";
import { MAUZ_SYSTEM_PROMPT } from "../prompts/mauzSystemPrompt";
import { buildResponseContent } from "../openai/askMauz";
import { AgentRunStoppedError } from "../errors";
import { getRunStatus, resolveRunApproval, startRun, streamRunEvents } from "./runsClient";

export type AgentApprovalChoice = "once" | "session" | "always" | "deny";

export type AgentApprovalRequest = {
  runId: string;
  description: string;
  raw: Record<string, unknown>;
};

export type ApprovalRequestHandler = (request: AgentApprovalRequest) => Promise<AgentApprovalChoice>;

export type RunLifecycleHooks = {
  onApprovalRequest?: ApprovalRequestHandler;
  onRunStarted?: (run: { runId: string }) => void;
  onRunFinished?: (run: { runId: string }) => void;
};

export type AskViaRunsOptions = RunLifecycleHooks & {
  baseUrl: string;
  model: string;
  agentMode: "approve" | "yolo";
  apiKey?: string;
  installId?: string;
  fetchImpl?: typeof fetch;
};

export async function askViaRuns(
  request: AskMauzRequest,
  options: AskViaRunsOptions
): Promise<AskMauzResponse> {
  const clientOptions = {
    baseUrl: options.baseUrl,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
  };
  const { runId } = await startRun({
    ...clientOptions,
    input: [{ role: "user", content: buildResponseContent(request) }],
    instructions: MAUZ_SYSTEM_PROMPT,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    ...(options.apiKey !== undefined && options.installId !== undefined
      ? { sessionKey: options.installId }
      : {})
  });

  options.onRunStarted?.({ runId });

  try {
    for await (const event of streamRunEvents({ ...clientOptions, runId })) {
      if (event.event === "approval.request") {
        const choice =
          options.agentMode === "yolo"
            ? "session"
            : await (options.onApprovalRequest ?? denyByDefault)({
                runId,
                description: typeof event.description === "string" ? event.description : "Agent action",
                raw: event
              });

        await resolveRunApproval({ ...clientOptions, runId, choice });
        continue;
      }

      if (event.event === "run.completed") {
        const answer = typeof event.output === "string" ? event.output.trim() : "";

        if (answer.length === 0) {
          throw new Error("Agent run completed without a text answer.");
        }

        return {
          answer,
          model: options.model,
          ...(event.usage === undefined ? {} : { usage: event.usage })
        };
      }

      if (event.event === "run.failed") {
        throw new Error(typeof event.error === "string" ? event.error : "Agent run failed.");
      }

      if (event.event === "run.cancelled") {
        throw new AgentRunStoppedError();
      }
    }

    // SSE stream dropped without a terminal event (spec §3.6): poll status once.
    const status = await getRunStatus({ ...clientOptions, runId });

    if (status?.status === "completed" && typeof status.output === "string" && status.output.trim().length > 0) {
      return {
        answer: status.output.trim(),
        model: options.model,
        ...(status.usage === undefined ? {} : { usage: status.usage })
      };
    }

    if (status?.status === "cancelled") {
      throw new AgentRunStoppedError();
    }

    throw new Error("Lost connection to the agent run before it completed.");
  } finally {
    options.onRunFinished?.({ runId });
  }
}

async function denyByDefault(): Promise<AgentApprovalChoice> {
  return "deny";
}
```

  - `apps/api/src/errors.ts` addition:
    ```typescript
    export class AgentRunStoppedError extends Error {
      constructor() {
        super("The agent run was stopped.");
        this.name = "AgentRunStoppedError";
      }
    }
    ```
  - `apps/api/src/routes/ask.ts` — replace the fixed default handler with a dispatcher. `RegisterAskRouteOptions` gains `runHooks?: RunLifecycleHooks`. Default handler:
    ```typescript
    const askHandler = options.askHandler ?? createDefaultAskHandler(options.runHooks);
    ```
    ```typescript
    function createDefaultAskHandler(runHooks: RunLifecycleHooks | undefined): AskMauzHandler {
      return async (request) => {
        const baseUrl = process.env.MAUZ_BACKEND_BASE_URL?.trim();

        if (baseUrl) {
          const capabilities = await detectBackendCapabilities(baseUrl);

          if (capabilities?.supportsRuns) {
            const backendApiKey = process.env.MAUZ_BACKEND_API_KEY?.trim();

            return askViaRuns(request, {
              baseUrl,
              model: process.env.OPENAI_ASK_MODEL?.trim() || "hermes-agent",
              agentMode: process.env.MAUZ_AGENT_MODE === "yolo" ? "yolo" : "approve",
              ...(backendApiKey ? { apiKey: backendApiKey } : {}),
              ...(process.env.MAUZ_INSTALL_ID ? { installId: process.env.MAUZ_INSTALL_ID } : {}),
              ...runHooks
            });
          }
        }

        return askMauz(request);
      };
    }
    ```
    Error mapping in the route's catch: `AgentRunStoppedError` → `reply.status(499).send({ error: error.message })` (add before the generic 502; also add a test asserting the 499 in `apps/api/tests/askMauz.test.ts`'s route section or a new route test).
  - `apps/api/src/server.ts`: `CreateMauzApiServerOptions` gains `runHooks?: RunLifecycleHooks`; pass through to `registerAskRoute` like the existing options.
- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/api test` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: run asks through the agent runs API with approval and yolo modes"`

### Task 10: Desktop approval bridge — IPC, preload, stop

**Files:**
- Modify: `packages/shared/src/constants.ts` (`IPC_CHANNELS` additions)
- Create: `apps/desktop/src/main/agent/AgentRunBridge.ts`
- Modify: `apps/desktop/src/main/ipc/registerIpcHandlers.ts`
- Modify: `apps/desktop/src/main/index.ts` (construct bridge, pass `runHooks` to `launchLocalApi`)
- Modify: `apps/desktop/src/main/server/launchLocalApi.ts` (accept and forward `runHooks`)
- Modify: `apps/desktop/src/preload/index.ts` + `apps/desktop/src/renderer/src/global.d.ts` + `apps/desktop/src/renderer/src/lib/mauzClient.ts`
- Test: `apps/desktop/tests/AgentRunBridge.test.ts`

**Interfaces:**
- Consumes: `RunLifecycleHooks`, `AgentApprovalRequest`, `AgentApprovalChoice` (import type from `@mauzai/api/server` re-export — add `export type { RunLifecycleHooks, AgentApprovalRequest, AgentApprovalChoice } from "./backend/askViaRuns";` to `apps/api/src/server.ts`), `stopRun` (re-export `stopRun` and `RunsClientOptions` from `server.ts` the same way).
- Produces:
  - `IPC_CHANNELS` additions: `agentApprovalRequest: "mauz:agent:approval-request"` (main→renderer push), `agentApprovalRespond: "mauz:agent:approval-respond"`, `agentRunState: "mauz:agent:run-state"` (main→renderer push `{ runId: string | null }`), `agentStop: "mauz:agent:stop"`.
  - `AgentRunBridge` class:
    ```typescript
    export class AgentRunBridge {
      constructor(options: { getPopoverWebContents(): Electron.WebContents | null });
      readonly runHooks: RunLifecycleHooks;            // wire into launchLocalApi
      respondToApproval(approvalId: string, choice: AgentApprovalChoice): void;  // from IPC
      async stopActiveRun(): Promise<void>;            // from IPC and popover close
      get activeRunId(): string | null;
    }
    ```
  - `mauzClient` additions: `onAgentApprovalRequest(cb)`, `respondAgentApproval({ approvalId, choice })`, `onAgentRunState(cb)`, `stopAgentRun()`.

- [ ] **Step 1: Write failing tests** in `apps/desktop/tests/AgentRunBridge.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { AgentRunBridge } from "../src/main/agent/AgentRunBridge";

function createWebContentsStub() {
  return { send: vi.fn(), isDestroyed: () => false };
}

describe("AgentRunBridge", () => {
  it("forwards approval requests to the popover and resolves with the user's choice", async () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });

    const pending = bridge.runHooks.onApprovalRequest!({
      runId: "run_1",
      description: "edit file",
      raw: {}
    });
    const [channel, payload] = webContents.send.mock.calls[0]!;
    expect(channel).toBe("mauz:agent:approval-request");
    expect(payload).toMatchObject({ runId: "run_1", description: "edit file" });

    bridge.respondToApproval(payload.approvalId, "once");
    await expect(pending).resolves.toBe("once");
  });

  it("denies when no popover window is available", async () => {
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => null });
    await expect(
      bridge.runHooks.onApprovalRequest!({ runId: "r", description: "x", raw: {} })
    ).resolves.toBe("deny");
  });

  it("tracks the active run id and pushes run state", () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });
    bridge.runHooks.onRunStarted!({ runId: "run_9" });
    expect(bridge.activeRunId).toBe("run_9");
    expect(webContents.send).toHaveBeenCalledWith("mauz:agent:run-state", { runId: "run_9" });
    bridge.runHooks.onRunFinished!({ runId: "run_9" });
    expect(bridge.activeRunId).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @mauzai/desktop test -- AgentRunBridge` → FAIL.
- [ ] **Step 3: Implement.**
  - `packages/shared/src/constants.ts` `IPC_CHANNELS` additions (after `askSubmit`):
    ```typescript
    agentApprovalRequest: "mauz:agent:approval-request",
    agentApprovalRespond: "mauz:agent:approval-respond",
    agentRunState: "mauz:agent:run-state",
    agentStop: "mauz:agent:stop",
    ```
  - `apps/desktop/src/main/agent/AgentRunBridge.ts`:
    ```typescript
    import { randomUUID } from "node:crypto";
    import type { WebContents } from "electron";
    import { IPC_CHANNELS } from "@mauzai/shared";
    import {
      stopRun,
      type AgentApprovalChoice,
      type AgentApprovalRequest,
      type RunLifecycleHooks
    } from "@mauzai/api/server";

    type AgentRunBridgeOptions = {
      getPopoverWebContents(): WebContents | null;
    };

    export class AgentRunBridge {
      readonly runHooks: RunLifecycleHooks;
      private readonly getPopoverWebContents: () => WebContents | null;
      private readonly pendingApprovals = new Map<string, (choice: AgentApprovalChoice) => void>();
      private currentRunId: string | null = null;

      constructor(options: AgentRunBridgeOptions) {
        this.getPopoverWebContents = options.getPopoverWebContents;
        this.runHooks = {
          onApprovalRequest: (request) => this.requestApproval(request),
          onRunStarted: ({ runId }) => this.setActiveRun(runId),
          onRunFinished: () => this.setActiveRun(null)
        };
      }

      get activeRunId(): string | null {
        return this.currentRunId;
      }

      respondToApproval(approvalId: string, choice: AgentApprovalChoice): void {
        const resolve = this.pendingApprovals.get(approvalId);

        if (resolve !== undefined) {
          this.pendingApprovals.delete(approvalId);
          resolve(choice);
        }
      }

      async stopActiveRun(): Promise<void> {
        const runId = this.currentRunId;
        const baseUrl = process.env.MAUZ_BACKEND_BASE_URL?.trim();

        for (const [approvalId] of this.pendingApprovals) {
          this.respondToApproval(approvalId, "deny");
        }

        if (runId === null || !baseUrl) {
          return;
        }

        const apiKey = process.env.MAUZ_BACKEND_API_KEY?.trim();
        await stopRun({ baseUrl, runId, ...(apiKey ? { apiKey } : {}) });
      }

      private requestApproval(request: AgentApprovalRequest): Promise<AgentApprovalChoice> {
        const webContents = this.getPopoverWebContents();

        if (webContents === null || webContents.isDestroyed()) {
          return Promise.resolve("deny");
        }

        const approvalId = randomUUID();

        return new Promise((resolve) => {
          this.pendingApprovals.set(approvalId, resolve);
          webContents.send(IPC_CHANNELS.agentApprovalRequest, {
            approvalId,
            runId: request.runId,
            description: request.description
          });
        });
      }

      private setActiveRun(runId: string | null): void {
        this.currentRunId = runId;
        const webContents = this.getPopoverWebContents();

        if (webContents !== null && !webContents.isDestroyed()) {
          webContents.send(IPC_CHANNELS.agentRunState, { runId });
        }
      }
    }
    ```
  - `apps/api/src/server.ts` — add the type/function re-exports listed in Interfaces.
  - `apps/desktop/src/main/server/launchLocalApi.ts` — `LaunchLocalApiOptions` gains `runHooks?: RunLifecycleHooks` (type import from `@mauzai/api/server`); pass into `createMauzApiServer`.
  - `apps/desktop/src/main/index.ts` — construct `const agentRunBridge = new AgentRunBridge({ getPopoverWebContents: () => popover?.window?.webContents ?? null })` (adapt to how the popover controller exposes its `BrowserWindow` — see `PopoverWindowController`); pass `runHooks: agentRunBridge.runHooks` to `launchLocalApi`; pass the bridge into `registerIpcHandlers`. Also wire popover close to run containment (spec §3.6): where the popover hide/close is handled (`PopoverWindowController` or its call site in `index.ts`), call `void agentRunBridge.stopActiveRun()` so closing the popover stops any in-flight agent run.
  - `registerIpcHandlers.ts` — new handlers:
    ```typescript
    ipcMain.handle(IPC_CHANNELS.agentApprovalRespond, (event, payload: unknown) => {
      assertTrustedSurface(event, ["popover"]);
      const parsed = AgentApprovalResponseSchema.parse(payload);
      agentRunBridge.respondToApproval(parsed.approvalId, parsed.choice);
    });

    ipcMain.handle(IPC_CHANNELS.agentStop, async (event) => {
      assertTrustedSurface(event, ["popover"]);
      await agentRunBridge.stopActiveRun();
    });
    ```
    Add to `packages/shared/src/schemas.ts`:
    ```typescript
    export const AgentApprovalResponseSchema = z.object({
      approvalId: z.string().min(1),
      choice: z.enum(["once", "session", "always", "deny"])
    });
    ```
  - `apps/desktop/src/preload/index.ts` — expose (following the existing bridge namespace pattern):
    ```typescript
    agent: {
      respondApproval: (payload: unknown) => ipcRenderer.invoke(IPC_CHANNELS.agentApprovalRespond, payload),
      stop: () => ipcRenderer.invoke(IPC_CHANNELS.agentStop),
      onApprovalRequest: (callback: (payload: { approvalId: string; runId: string; description: string }) => void) => {
        const listener = (_event: unknown, payload: never) => callback(payload);
        ipcRenderer.on(IPC_CHANNELS.agentApprovalRequest, listener);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.agentApprovalRequest, listener);
      },
      onRunState: (callback: (payload: { runId: string | null }) => void) => {
        const listener = (_event: unknown, payload: never) => callback(payload);
        ipcRenderer.on(IPC_CHANNELS.agentRunState, listener);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.agentRunState, listener);
      }
    }
    ```
    Mirror the shape in `global.d.ts` and add the four `mauzClient` methods delegating to `getBridge().agent.*`.
- [ ] **Step 4: Run tests** — `pnpm --filter @mauzai/desktop test` → PASS; `pnpm -r build` type-checks the cross-package imports.
- [ ] **Step 5: Commit** — `git commit -am "feat: bridge agent approval requests and stop control to the popover"`

### Task 11: Popover UI — approval prompt, stop button, mode toggle

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/AskPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/styles.css` (minimal styles for the new elements, following existing class conventions)
- Test: manual (no renderer test harness); covered by Task 12.

**Interfaces:**
- Consumes: `mauzClient.onAgentApprovalRequest` / `respondAgentApproval` / `onAgentRunState` / `stopAgentRun` / `updateSettings` (Task 10), `settings.agentMode`.

- [ ] **Step 1: Add state + subscriptions** inside the `AskPanel` component:

```tsx
const [approvalRequest, setApprovalRequest] = useState<{
  approvalId: string;
  runId: string;
  description: string;
} | null>(null);
const [activeRunId, setActiveRunId] = useState<string | null>(null);

useEffect(() => {
  const unsubscribeApproval = mauzClient.onAgentApprovalRequest((payload) => setApprovalRequest(payload));
  const unsubscribeRunState = mauzClient.onAgentRunState(({ runId }) => {
    setActiveRunId(runId);
    if (runId === null) {
      setApprovalRequest(null);
    }
  });

  return () => {
    unsubscribeApproval();
    unsubscribeRunState();
  };
}, []);

const handleApprovalChoice = (choice: "once" | "session" | "always" | "deny"): void => {
  if (approvalRequest === null) {
    return;
  }
  void mauzClient.respondAgentApproval({ approvalId: approvalRequest.approvalId, choice });
  setApprovalRequest(null);
};
```

- [ ] **Step 2: Render the approval card** inside the answer area (above the answer/loading display):

```tsx
{approvalRequest !== null ? (
  <div className="agent-approval" role="alertdialog" aria-label="Agent approval request">
    <p className="agent-approval-description">
      <ShieldAlert aria-hidden="true" size={14} /> {approvalRequest.description}
    </p>
    <div className="agent-approval-actions">
      <button type="button" onClick={() => handleApprovalChoice("once")}>Allow once</button>
      <button type="button" onClick={() => handleApprovalChoice("session")}>Allow for session</button>
      <button type="button" onClick={() => handleApprovalChoice("always")}>Always allow</button>
      <button type="button" className="agent-approval-deny" onClick={() => handleApprovalChoice("deny")}>Deny</button>
    </div>
  </div>
) : null}
```

- [ ] **Step 3: Stop button** — while `askLoading && activeRunId !== null`, render next to the loading indicator:

```tsx
<button type="button" className="agent-stop-button" onClick={() => void mauzClient.stopAgentRun()}>
  <Square aria-hidden="true" size={12} /> Stop
</button>
```

- [ ] **Step 4: Mode toggle** — in the ask form header/footer, a two-option segmented control shown only when the loaded settings have `backendPreset !== "openai"` (fetch settings via the existing pattern the popover uses, or `mauzClient.openSettings` equivalent read — `AskPanel` can receive settings through `useMauzStore` if already present; otherwise call `mauzClient.updateSettings({})` is NOT acceptable — read via `getBridge().settings.open` only opens the panel; instead pass the current settings into the popover state the same way `SettingsPanel` loads them, using `mauzClient.getSettings()` if it exists or adding `settingsGet` alongside `settingsOpen` following the same IPC pattern):

```tsx
<div className="agent-mode-toggle" role="radiogroup" aria-label="Agent mode">
  <button type="button" aria-pressed={agentMode === "approve"} onClick={() => void handleModeChange("approve")}>Approve</button>
  <button type="button" aria-pressed={agentMode === "yolo"} onClick={() => void handleModeChange("yolo")}>YOLO</button>
</div>
```

with `handleModeChange` calling `mauzClient.updateSettings({ agentMode: mode })` and storing the result. Add the read-only `settingsGet` IPC channel (`mauz:settings:get`) + `mauzClient.getSettings()` if no non-opening settings read exists — same handler body as `settingsOpen` minus the popover resize.

- [ ] **Step 5: Styles** — add `.agent-approval`, `.agent-approval-actions`, `.agent-stop-button`, `.agent-mode-toggle` rules to `styles.css` consistent with existing button/panel styling (reuse `settings-field`-adjacent variables).
- [ ] **Step 6: Verify** — `pnpm --filter @mauzai/desktop test` and `pnpm -r build` → PASS.
- [ ] **Step 7: Commit** — `git commit -am "feat: popover approval prompts, stop button, and agent mode toggle"`

### Task 12: Phase 2 E2E verification + docs

**Files:**
- Modify: `setup.md`, `README.md` (short "Agent backends" paragraph)

- [ ] **Step 1: Approvals mode E2E** — Hermes gateway running; preset `hermes`, mode Approve. Ask something requiring a gated tool ("create a file named mauz-test.txt on my Desktop"). Expect: approval card appears in the popover → Allow once → file exists → answer arrives.
- [ ] **Step 2: Deny path** — same ask, press Deny; expect the agent to report it could not perform the action; no file created.
- [ ] **Step 3: YOLO mode E2E** — switch mode to YOLO, repeat; expect no approval card and the action performed.
- [ ] **Step 4: Stop** — start a long ask ("summarize every file in my home directory"), press Stop; expect the popover to show the stopped-run error (499 message) and the gateway run status `cancelled`.
- [ ] **Step 5: Multimodal check** — confirm a cursor-crop ask (pointing at something on screen) works through the runs path. If the gateway rejects multimodal `input` on `/v1/runs` (it does not normalize image parts the way `/v1/responses` does), change `askViaRuns` to flatten the input to `buildContextText(request)` (already exported from `askMauz.ts`) and note the limitation in `setup.md` ("screenshots are described but not attached in agent-mode asks") — then re-run this step.
- [ ] **Step 6: Update docs** — `setup.md` agent modes section; `README.md` one-paragraph mention of Hermes backend support.
- [ ] **Step 7: Full suite + commit** — `pnpm -r test && pnpm -r build`, then `git commit -am "docs: agent mode setup and verification notes"`.
