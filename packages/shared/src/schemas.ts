import { z } from "zod";

const MAX_TEXT_FIELD_CHARS = 8_000;
const MAX_QUESTION_CHARS = 4_000;
const MAX_ANSWER_CHARS = 40_000;
const MAX_IMAGE_BASE64_CHARS = 3_500_000;
const MAX_SDP_CHARS = 240_000;
const MAX_WINDOW_TEXT_CHARS = 500;
const MAX_MODEL_NAME_CHARS = 128;
const MAX_VOICE_NAME_CHARS = 64;
const MAX_CONVERSATION_MESSAGES = 32;
const ModelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_MODEL_NAME_CHARS)
  .regex(/^[A-Za-z0-9._:/-]+$/);
const VoiceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_VOICE_NAME_CHARS)
  .regex(/^[A-Za-z0-9._-]+$/);
const WindowTextSchema = z.string().max(MAX_WINDOW_TEXT_CHARS);
const UserTextSchema = z.string().max(MAX_TEXT_FIELD_CHARS);

export const PlatformSchema = z.enum(["darwin", "win32", "linux"]);

export const ScreenshotPayloadSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png"]),
  base64: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096)
});

export const BoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative()
});

export const CursorPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

export const PermissionErrorSchema = z.object({
  permission: z.enum(["accessibility", "screen-recording", "microphone", "unknown"]),
  message: z.string()
});

export const ShakeSensitivitySchema = z.enum(["relaxed", "normal", "strict"]);
export const RealtimeReasoningEffortSchema = z.enum(["low", "medium", "high"]);
export const OpenAiAuthModeSchema = z.preprocess(() => "api-key", z.literal("api-key"));
export const OpenAiCredentialSourceSchema = z.enum(["none", "environment", "saved"]);

export const AssistantModeSchema = z.enum(["simple", "agentic"]);
export const AgentModeSchema = z.enum(["approve", "yolo"]);

export const MauzSettingsSchema = z.object({
  nativeShakeEnabled: z.boolean(),
  devHotkeyEnabled: z.boolean(),
  shakeSensitivity: ShakeSensitivitySchema,
  openAiAuthMode: OpenAiAuthModeSchema,
  openAiAuthDisconnected: z.boolean(),
  openAiCredentialSource: OpenAiCredentialSourceSchema,
  askModel: ModelNameSchema,
  chatTitleModel: ModelNameSchema,
  realtimeModel: ModelNameSchema,
  realtimeVoice: VoiceNameSchema,
  realtimeReasoningEffort: RealtimeReasoningEffortSchema,
  includeFullScreenshot: z.boolean(),
  apiKeyConfigured: z.boolean(),
  assistantMode: AssistantModeSchema,
  backendBaseUrl: z.string().trim().max(400),
  agentMode: AgentModeSchema
});

export const MauzSettingsUpdateSchema = MauzSettingsSchema.omit({
  apiKeyConfigured: true,
  openAiCredentialSource: true
})
  .partial()
  .extend({
    openAiApiKey: z.string().nullable().optional(),
    clearOpenAiApiKey: z.boolean().optional()
  });

export const MouseMoveSampleSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  ts: z.number().int().nonnegative(),
  buttons: z.number().int().nonnegative().optional()
});

export const MacInputAgentMouseMoveEventSchema = MouseMoveSampleSchema.extend({
  type: z.literal("mouse_move")
});

export const MacInputAgentPermissionErrorEventSchema = PermissionErrorSchema.extend({
  type: z.literal("permission_error")
});

export const MacInputAgentEventSchema = z.discriminatedUnion("type", [
  MacInputAgentMouseMoveEventSchema,
  MacInputAgentPermissionErrorEventSchema
]);

export const PointerContextSchema = z.object({
  cursor: CursorPositionSchema,
  display: z
    .object({
      id: z.string().optional(),
      scaleFactor: z.number().positive().optional(),
      bounds: BoundsSchema.optional()
    })
    .optional(),
  activeApp: z
    .object({
      name: WindowTextSchema.optional(),
      bundleId: WindowTextSchema.optional(),
      processId: z.number().int().nonnegative().optional()
    })
    .optional(),
  activeWindow: z
    .object({
      title: WindowTextSchema.optional(),
      bounds: BoundsSchema.optional()
    })
    .optional(),
  selectedText: UserTextSchema.optional(),
  cursorCrop: ScreenshotPayloadSchema.optional(),
  screenshot: ScreenshotPayloadSchema.optional()
});

export const MauzDesktopContextSchema = z.object({
  timestamp: z.string().datetime(),
  platform: PlatformSchema,
  activeApp: z
    .object({
      name: WindowTextSchema.optional(),
      bundleId: WindowTextSchema.optional(),
      processId: z.number().int().nonnegative().optional()
    })
    .optional(),
  activeWindow: z
    .object({
      title: WindowTextSchema.optional(),
      bounds: z
        .object({
          x: z.number().finite(),
          y: z.number().finite(),
          width: z.number().finite().nonnegative(),
          height: z.number().finite().nonnegative()
        })
        .optional()
    })
    .optional(),
  cursor: CursorPositionSchema,
  selectedText: UserTextSchema.optional(),
  pointer: PointerContextSchema.optional(),
  screenshot: ScreenshotPayloadSchema.optional(),
  screenshotError: PermissionErrorSchema.optional()
});

export const ChatRoleSchema = z.enum(["user", "assistant"]);

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: ChatRoleSchema,
  content: z.string().max(MAX_ANSWER_CHARS),
  createdAt: z.string().datetime()
});

export const AskMauzRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  context: MauzDesktopContextSchema,
  conversationMessages: z.array(ChatMessageSchema).max(MAX_CONVERSATION_MESSAGES).optional(),
  sessionId: z.string().trim().min(1).max(128).optional()
});

export const AskMauzResponseSchema = z.object({
  answer: z.string(),
  model: ModelNameSchema,
  conversationId: z.string().optional(),
  conversationTitle: z.string().optional(),
  usage: z.unknown().optional()
});

export const ChatConversationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(ChatMessageSchema)
});

export const ChatHistorySummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  preview: z.string()
});

export const ChatHistoryGroupSchema = z.object({
  dateLabel: z.string().min(1),
  conversations: z.array(ChatHistorySummarySchema)
});

export const ChatHistoryListResponseSchema = z.object({
  groups: z.array(ChatHistoryGroupSchema)
});

export const ChatHistoryGetRequestSchema = z.object({
  id: z.string().min(1)
});

export const ChatHistoryDeleteRequestSchema = z.object({
  id: z.string().min(1)
});

export const ChatHistoryContinueRequestSchema = z.object({
  id: z.string().min(1),
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS)
});

export const MauzLensResizeRequestSchema = z.object({
  expanded: z.boolean()
});

export const ChatHistoryContinueResponseSchema = z.object({
  conversation: ChatConversationSchema,
  answer: z.string(),
  model: z.string()
});

export const ChatTitleRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS)
});

export const ChatTitleResponseSchema = z.object({
  title: z.string().min(1),
  model: ModelNameSchema
});

export const RealtimeSessionResponseSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number().optional(),
  session: z.unknown().optional()
});

export const RealtimeModeSchema = z.literal("talk");

export const RealtimeConnectRequestSchema = z.object({
  offerSdp: z.string().min(1).max(MAX_SDP_CHARS),
  mode: RealtimeModeSchema,
  context: MauzDesktopContextSchema
});

export const RealtimeConnectResponseSchema = z.object({
  answerSdp: z.string().min(1),
  model: ModelNameSchema
});

export const AgentApprovalResponseSchema = z.object({
  approvalId: z.string().min(1),
  choice: z.enum(["once", "session", "always", "deny"])
});

export const AgentApprovalPayloadSchema = z.object({
  approvalId: z.string(),
  runId: z.string(),
  description: z.string()
});

export const AgentRunStatePayloadSchema = z.object({
  runId: z.string().nullable()
});

export const AgentRunActivityPayloadSchema = z.object({
  runId: z.string(),
  kind: z.enum(["tool.started", "tool.completed", "reasoning"]),
  tool: z.string().optional(),
  label: z.string()
});

export const GatewayReadinessStatusSchema = z.enum(["simple", "ready", "unavailable", "unsupported"]);

export const GatewayReadinessResultSchema = z.object({
  status: GatewayReadinessStatusSchema,
  message: z.string().min(1).max(200)
});
