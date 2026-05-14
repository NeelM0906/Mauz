import { z } from "zod";

export const PlatformSchema = z.enum(["darwin", "win32", "linux"]);

export const ScreenshotPayloadSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png"]),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive()
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

export const MauzSettingsSchema = z.object({
  nativeShakeEnabled: z.boolean(),
  devHotkeyEnabled: z.boolean(),
  shakeSensitivity: ShakeSensitivitySchema
});

export const MauzSettingsUpdateSchema = MauzSettingsSchema.partial();

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
      name: z.string().optional(),
      bundleId: z.string().optional(),
      processId: z.number().int().nonnegative().optional()
    })
    .optional(),
  activeWindow: z
    .object({
      title: z.string().optional(),
      bounds: BoundsSchema.optional()
    })
    .optional(),
  selectedText: z.string().optional(),
  cursorCrop: ScreenshotPayloadSchema.optional(),
  screenshot: ScreenshotPayloadSchema.optional()
});

export const MauzDesktopContextSchema = z.object({
  timestamp: z.string().datetime(),
  platform: PlatformSchema,
  activeApp: z
    .object({
      name: z.string().optional(),
      bundleId: z.string().optional(),
      processId: z.number().int().nonnegative().optional()
    })
    .optional(),
  activeWindow: z
    .object({
      title: z.string().optional(),
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
  selectedText: z.string().optional(),
  pointer: PointerContextSchema.optional(),
  screenshot: ScreenshotPayloadSchema.optional(),
  screenshotError: PermissionErrorSchema.optional()
});

export const AskMauzRequestSchema = z.object({
  question: z.string().min(1),
  context: MauzDesktopContextSchema
});

export const AskMauzResponseSchema = z.object({
  answer: z.string(),
  model: z.string(),
  conversationId: z.string().optional(),
  conversationTitle: z.string().optional(),
  usage: z.unknown().optional()
});

export const ChatRoleSchema = z.enum(["user", "assistant"]);

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: ChatRoleSchema,
  content: z.string(),
  createdAt: z.string().datetime()
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

export const ChatTitleRequestSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1)
});

export const ChatTitleResponseSchema = z.object({
  title: z.string().min(1),
  model: z.string().min(1)
});

export const RealtimeSessionResponseSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number().optional(),
  session: z.unknown().optional()
});

export const RealtimeModeSchema = z.enum(["talk", "screen"]);

export const RealtimeConnectRequestSchema = z.object({
  offerSdp: z.string().min(1),
  mode: RealtimeModeSchema,
  context: MauzDesktopContextSchema
});

export const RealtimeConnectResponseSchema = z.object({
  answerSdp: z.string().min(1),
  model: z.string().min(1)
});
