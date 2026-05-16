import type {
  Bounds,
  MauzDesktopContext,
  RealtimeConnectRequest,
  RealtimeConnectResponse
} from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";

const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_REALTIME_VOICE = "marin";
const DEFAULT_REALTIME_REASONING_EFFORT = "low";
const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type CreateRealtimeAnswerOptions = {
  apiKey?: string;
  model?: string;
  voice?: string;
  transcriptionModel?: string;
  fetchImpl?: FetchLike;
};

export async function createRealtimeAnswer(
  request: RealtimeConnectRequest,
  options: CreateRealtimeAnswerOptions = {}
): Promise<RealtimeConnectResponse> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;

  if (!apiKey) {
    throw new MissingOpenAIKeyError();
  }

  const formData = new FormData();
  formData.set("sdp", request.offerSdp);
  formData.set(
    "session",
    JSON.stringify(
      buildRealtimeSessionConfig(request, {
        model,
        voice: options.voice ?? process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE,
        reasoningEffort: process.env.OPENAI_REALTIME_REASONING_EFFORT ?? DEFAULT_REALTIME_REASONING_EFFORT,
        transcriptionModel:
          options.transcriptionModel ??
          process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ??
          DEFAULT_REALTIME_TRANSCRIPTION_MODEL
      })
    )
  );

  const response = await (options.fetchImpl ?? fetch)(REALTIME_CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });
  const answerSdp = await response.text();

  if (!response.ok) {
    throw new Error(getRealtimeErrorMessage(response.status, answerSdp));
  }

  return {
    answerSdp,
    model
  };
}

export type RealtimeSessionConfigOptions = {
  model: string;
  voice: string;
  reasoningEffort: string;
  transcriptionModel: string;
};

export function buildRealtimeSessionConfig(
  request: RealtimeConnectRequest,
  options: RealtimeSessionConfigOptions
): Record<string, unknown> {
  return {
    type: "realtime",
    model: options.model,
    instructions: buildRealtimeInstructions(request),
    output_modalities: ["audio"],
    reasoning: {
      effort: options.reasoningEffort
    },
    audio: {
      input: {
        transcription: {
          model: options.transcriptionModel
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "auto",
          create_response: true,
          interrupt_response: true
        }
      },
      output: {
        voice: options.voice
      }
    }
  };
}

export function buildRealtimeInstructions({ context }: RealtimeConnectRequest): string {
  return [
    "You are Mauz, a concise desktop assistant summoned at the user's cursor.",
    "The user may speak while looking at their desktop. Use the provided pointer context to resolve vague references like this, that, and here.",
    "Resolve references in this order: selected text, cursor crop, active window metadata, full screenshot, cursor position.",
    "Answer directly unless the pointed target is genuinely ambiguous. If it is ambiguous, ask one short follow-up.",
    "The user explicitly enabled voice chat. Use the initial screenshot context only unless they share more context.",
    "",
    "Initial desktop context:",
    formatRealtimeContext(context)
  ].join("\n");
}

function formatRealtimeContext(context: MauzDesktopContext): string {
  const pointer = context.pointer;
  const selectedText = context.selectedText ?? pointer?.selectedText;
  const activeApp = context.activeApp ?? pointer?.activeApp;
  const activeWindow = context.activeWindow ?? pointer?.activeWindow;
  const screenshot = pointer?.screenshot ?? context.screenshot;

  return [
    `- Timestamp: ${context.timestamp}`,
    `- Platform: ${context.platform}`,
    `- Cursor: (${Math.round(context.cursor.x)}, ${Math.round(context.cursor.y)})`,
    `- Selected text: ${selectedText?.trim() ? selectedText : "none provided"}`,
    `- Cursor crop: ${pointer?.cursorCrop === undefined ? "not attached" : `${pointer.cursorCrop.mimeType}, ${pointer.cursorCrop.width}x${pointer.cursorCrop.height}, sent as primary image context`}`,
    `- Full screenshot: ${screenshot === undefined ? "not attached" : `${screenshot.mimeType}, ${screenshot.width}x${screenshot.height}, sent as broad context`}`,
    `- Active app: ${activeApp === undefined ? "unknown" : [activeApp.name, activeApp.bundleId].filter(Boolean).join(", ") || "unknown"}`,
    `- Active window: ${activeWindow === undefined ? "unknown" : [activeWindow.title, formatBounds(activeWindow.bounds)].filter(Boolean).join(", ") || "unknown"}`
  ].join("\n");
}

function formatBounds(bounds: Bounds | undefined): string | undefined {
  if (bounds === undefined) {
    return undefined;
  }

  return `${Math.round(bounds.width)}x${Math.round(bounds.height)} at ${Math.round(bounds.x)},${Math.round(bounds.y)}`;
}

function getRealtimeErrorMessage(status: number, body: string): string {
  if (status === 401) {
    return "OpenAI rejected the Realtime request. Check OPENAI_API_KEY before launching Mauz.";
  }

  if (body.trim().length > 0) {
    return "OpenAI Realtime connection failed.";
  }

  return "OpenAI Realtime connection failed.";
}
