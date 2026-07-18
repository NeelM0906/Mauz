import type { AssistantMode, GatewayReadinessResult } from "@mauzai/shared";

export type BackendCapabilities = {
  sessionIdHeader: string;
  sessionKeyHeader: string;
  supportsRuns: boolean;
};

type CachedCapabilities = {
  value: BackendCapabilities;
  expiresAt: number;
};

const capabilitiesCache = new Map<string, CachedCapabilities>();
const PROBE_TIMEOUT_MS = 3_000;
const CAPABILITIES_TTL_MS = 60_000;

export async function detectBackendCapabilities(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<BackendCapabilities | null> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  const cached = capabilitiesCache.get(normalizedBaseUrl);
  if (cached !== undefined && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const capabilities = await probeCapabilities(normalizedBaseUrl, fetchImpl);

  // Only cache successful probes; null means the gateway was unreachable or
  // returned an unrecognized response, so re-probe on the next call to allow
  // the user to start the gateway after the app without requiring a restart.
  if (capabilities !== null) {
    capabilitiesCache.set(normalizedBaseUrl, {
      value: capabilities,
      expiresAt: Date.now() + CAPABILITIES_TTL_MS
    });
  }

  return capabilities;
}

export function clearBackendCapabilitiesCache(): void {
  capabilitiesCache.clear();
}

export async function getGatewayReadinessStatus(
  assistantMode: AssistantMode,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<GatewayReadinessResult> {
  if (assistantMode === "simple") {
    return { status: "simple", message: "Using the fast simple answer flow." };
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  if (normalizedBaseUrl.length === 0) {
    return { status: "unavailable", message: "No gateway URL is configured." };
  }

  const capabilities = await detectBackendCapabilities(normalizedBaseUrl, fetchImpl);

  if (capabilities === null) {
    return { status: "unavailable", message: "The configured gateway is not reachable." };
  }

  if (!capabilities.supportsRuns) {
    return { status: "unsupported", message: "The gateway does not support supervised runs." };
  }

  return { status: "ready", message: "Gateway is ready for supervised Work tasks." };
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
