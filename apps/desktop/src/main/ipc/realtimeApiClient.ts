import {
  LOCAL_API_TOKEN_HEADER,
  RealtimeConnectRequestSchema,
  RealtimeConnectResponseSchema,
  type RealtimeConnectResponse
} from "@mauzai/shared";
import type { LocalApiHandle } from "../server/launchLocalApi";
import type { FetchLike } from "./askApiClient";

export async function connectRealtimeToLocalApi(
  api: LocalApiHandle,
  localApiToken: string,
  payload: unknown,
  fetchImpl: FetchLike = fetch
): Promise<RealtimeConnectResponse> {
  const request = RealtimeConnectRequestSchema.parse(payload);
  const response = await fetchImpl(`${api.baseUrl}/api/realtime/connect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [LOCAL_API_TOKEN_HEADER]: localApiToken
    },
    body: JSON.stringify(request)
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(getFriendlyRealtimeApiError(response.status, body));
  }

  return RealtimeConnectResponseSchema.parse(body);
}

export function getFriendlyRealtimeApiError(status: number, body: unknown): string {
  const rawMessage = getErrorMessage(body);

  if (status === 401) {
    return "Mauz local API rejected the Realtime request. Restart Mauz and try again.";
  }

  if (status === 503 && rawMessage.includes("OPENAI_API_KEY")) {
    return "Add OPENAI_API_KEY to your .env file, then restart Mauz.";
  }

  if (rawMessage.length > 0) {
    return rawMessage;
  }

  return "Realtime connection failed.";
}

function getErrorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body) || typeof body.error !== "string") {
    return "";
  }

  return body.error;
}
