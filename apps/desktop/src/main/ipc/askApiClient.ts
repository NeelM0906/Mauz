import {
  AskMauzRequestSchema,
  AskMauzResponseSchema,
  LOCAL_API_TOKEN_HEADER,
  type AskMauzResponse
} from "@mauzai/shared";
import type { LocalApiHandle } from "../server/launchLocalApi";

type FetchResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponseLike>;

export async function submitAskToLocalApi(
  api: LocalApiHandle,
  localApiToken: string,
  payload: unknown,
  fetchImpl: FetchLike = fetch
): Promise<AskMauzResponse> {
  const request = AskMauzRequestSchema.parse(payload);
  const response = await fetchImpl(`${api.baseUrl}/api/ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [LOCAL_API_TOKEN_HEADER]: localApiToken
    },
    body: JSON.stringify(request)
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(getFriendlyAskApiError(response.status, body));
  }

  return AskMauzResponseSchema.parse(body);
}

export function getFriendlyAskApiError(status: number, body: unknown): string {
  const rawMessage = getErrorMessage(body);

  if (status === 401) {
    return "Mauz local API rejected the request. Restart Mauz and try again.";
  }

  if (status === 503 && rawMessage.includes("OPENAI_API_KEY")) {
    return "Configure OpenAI access in Mauz settings, then try again.";
  }

  if (rawMessage.length > 0) {
    return rawMessage;
  }

  return "Ask Mauz failed.";
}

function getErrorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body) || typeof body.error !== "string") {
    return "";
  }

  return body.error;
}
