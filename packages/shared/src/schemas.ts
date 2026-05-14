import { z } from "zod";

export const PlatformSchema = z.enum(["darwin", "win32", "linux"]);

export const ScreenshotPayloadSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png"]),
  base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export const CursorPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
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
  screenshot: ScreenshotPayloadSchema.optional()
});

export const AskMauzRequestSchema = z.object({
  question: z.string().min(1),
  context: MauzDesktopContextSchema
});

export const AskMauzResponseSchema = z.object({
  answer: z.string(),
  model: z.string(),
  usage: z.unknown().optional()
});

export const RealtimeSessionResponseSchema = z.object({
  value: z.string().min(1),
  expires_at: z.number().optional(),
  session: z.unknown().optional()
});

export const PermissionErrorSchema = z.object({
  permission: z.enum(["accessibility", "screen-recording", "microphone", "unknown"]),
  message: z.string()
});
