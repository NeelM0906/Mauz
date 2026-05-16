import {
  ChatTitleRequestSchema,
  ChatTitleResponseSchema,
  LOCAL_API_TOKEN_HEADER,
  type ChatTitleResponse
} from "@mauzai/shared";
import type { LocalApiHandle } from "../server/launchLocalApi";
import type { FetchLike } from "./askApiClient";

export async function generateChatTitleFromLocalApi(
  api: LocalApiHandle,
  localApiToken: string,
  payload: unknown,
  fetchImpl: FetchLike = fetch
): Promise<ChatTitleResponse> {
  const request = ChatTitleRequestSchema.parse(payload);
  const response = await fetchImpl(`${api.baseUrl}/api/chat/title`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [LOCAL_API_TOKEN_HEADER]: localApiToken
    },
    body: JSON.stringify(request)
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(getFriendlyChatTitleApiError(response.status, body));
  }

  return ChatTitleResponseSchema.parse(body);
}

export function getFriendlyChatTitleApiError(status: number, body: unknown): string {
  const rawMessage = getErrorMessage(body);

  if (status === 401) {
    return "Mauz local API rejected the title request.";
  }

  if (status === 503 && rawMessage.includes("OPENAI_API_KEY")) {
    return "Set OPENAI_API_KEY before launching Mauz, then try again.";
  }

  if (rawMessage.length > 0) {
    return rawMessage;
  }

  return "Chat title generation failed.";
}

function getErrorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body) || typeof body.error !== "string") {
    return "";
  }

  return body.error;
}
