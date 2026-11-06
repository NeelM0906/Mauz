import { z } from "zod";

const MAX_TEXT_FIELD_CHARS = 8_000;
const MAX_QUESTION_CHARS = 4_000;
const MAX_ANSWER_CHARS = 40_000;
const MAX_IMAGE_BASE64_CHARS = 3_500_000;
const MAX_WINDOW_TEXT_CHARS = 500;
const MAX_MODEL_NAME_CHARS = 128;
const ModelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_MODEL_NAME_CHARS)
  .regex(/^[A-Za-z0-9._:/-]+$/);
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
export const OpenAiCredentialSourceSchema = z.enum(["none", "environment", "saved"]);

export const TaskAgentIdSchema = z.enum(["hermes", "claude-code", "codex"]);
export const TaskAgentPreferenceSchema = z.union([z.literal("auto"), TaskAgentIdSchema]);
const FolderPathSchema = z.string().trim().max(1_000);

export const AiProviderIdSchema = z.enum(["claude-code", "codex", "anthropic", "openai"]);
export const AiProviderPreferenceSchema = z.union([z.literal("auto"), AiProviderIdSchema]);
export const AiProviderKindSchema = z.enum(["subscription", "api-key"]);

export const AiProviderStatusSchema = z.object({
  id: AiProviderIdSchema,
  label: z.string().min(1).max(80),
  kind: AiProviderKindSchema,
  available: z.boolean(),
  detail: z.string().max(200),
  model: z.string().max(MAX_MODEL_NAME_CHARS)
});

export const AiProvidersStatusResponseSchema = z.object({
  preference: AiProviderPreferenceSchema,
  activeProviderId: AiProviderIdSchema.nullable(),
  providers: z.array(AiProviderStatusSchema)
});

export const SubscriptionProviderIdSchema = z.enum(["claude-code", "codex"]);

export const SubscriptionConnectStateSchema = z.object({
  connectId: z.string().min(1).max(128),
  providerId: SubscriptionProviderIdSchema,
  phase: z.enum(["installing", "starting", "waiting", "connected", "failed", "cancelled"]),
  url: z.string().url().max(2000).nullable(),
  userCode: z.string().max(64).nullable(),
  acceptsPastedCode: z.boolean(),
  message: z.string().max(500).nullable()
});

export const SubscriptionConnectRequestSchema = z.object({ providerId: SubscriptionProviderIdSchema });
export const SubscriptionCodeRequestSchema = z.object({
  connectId: z.string().min(1).max(128),
  code: z.string().trim().min(1).max(2000)
});
export const SubscriptionCancelRequestSchema = z.object({ connectId: z.string().min(1).max(128) });
export const SubscriptionDisconnectRequestSchema = z.object({ providerId: SubscriptionProviderIdSchema });

export const AiProvidersStatusRequestSchema = z
  .object({
    refresh: z.boolean().optional()
  })
  .optional();

const MAX_AUDIO_BASE64_CHARS = 12_000_000;

export const TalkTranscribeRequestSchema = z.object({
  audioBase64: z.string().min(1).max(MAX_AUDIO_BASE64_CHARS),
  mimeType: z.literal("audio/wav")
});

export const TalkTranscribeResponseSchema = z.object({
  text: z.string().max(MAX_QUESTION_CHARS),
  engine: z.enum(["openai", "windows"])
});

export const AskAnswerDeltaSchema = z.object({
  requestId: z.string().min(1).max(128),
  text: z.string().max(MAX_ANSWER_CHARS)
});

export const MAX_CAPTURE_BLOCKED_APPS = 50;
export const MAX_CAPTURE_BLOCKED_ENTRY_CHARS = 120;

export const CaptureBlockedAppsSchema = z
  .array(z.string().trim().min(1).max(MAX_CAPTURE_BLOCKED_ENTRY_CHARS))
  .max(MAX_CAPTURE_BLOCKED_APPS);

export const MauzSettingsSchema = z.object({
  nativeShakeEnabled: z.boolean(),
  devHotkeyEnabled: z.boolean(),
  shakeSensitivity: ShakeSensitivitySchema,
  openAiAuthDisconnected: z.boolean(),
  openAiCredentialSource: OpenAiCredentialSourceSchema,
  askModel: ModelNameSchema,
  captureBlockedApps: CaptureBlockedAppsSchema,
  captureBlockedSites: CaptureBlockedAppsSchema,
  apiKeyConfigured: z.boolean(),
  taskAgent: TaskAgentPreferenceSchema,
  taskFolder: FolderPathSchema,
  taskAgentFolders: z.partialRecord(TaskAgentIdSchema, FolderPathSchema),
  aiProvider: AiProviderPreferenceSchema,
  anthropicKeyConfigured: z.boolean()
});

export const MauzSettingsUpdateSchema = MauzSettingsSchema.omit({
  apiKeyConfigured: true,
  openAiCredentialSource: true,
  anthropicKeyConfigured: true
})
  .partial()
  .extend({
    openAiApiKey: z.string().nullable().optional(),
    clearOpenAiApiKey: z.boolean().optional(),
    anthropicApiKey: z.string().nullable().optional(),
    clearAnthropicApiKey: z.boolean().optional()
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

const MAX_TARGET_TEXT_CHARS = 4_000;
const MAX_TARGET_VALUE_CHARS = 2_000;

export const PointerTargetElementSchema = z.object({
  role: z.string().min(1).max(80),
  name: WindowTextSchema.optional(),
  value: z.string().max(MAX_TARGET_VALUE_CHARS).optional(),
  text: z.string().max(MAX_TARGET_TEXT_CHARS).optional(),
  bounds: BoundsSchema.optional()
});

export const PointerTargetSchema = z.object({
  source: z.enum(["windows-uia", "macos-ax", "browser"]),
  element: PointerTargetElementSchema,
  container: PointerTargetElementSchema.optional(),
  window: z
    .object({
      title: WindowTextSchema.optional(),
      appName: WindowTextSchema.optional(),
      executable: WindowTextSchema.optional(),
      processId: z.number().int().nonnegative().optional(),
      bounds: BoundsSchema.optional()
    })
    .optional()
});

export const CursorCropFocusSchema = z.object({
  kind: z.enum(["element", "pointer-area"]),
  pointer: CursorPositionSchema
});

export const CaptureBlockedSchema = z.object({
  appName: WindowTextSchema
});

const MAX_PAGE_TEXT_CHARS = 8_000;
const MAX_URL_CHARS = 2_000;
const ProductFieldSchema = z.string().max(300).optional();

export const BrowserProductSchema = z.object({
  name: ProductFieldSchema,
  brand: ProductFieldSchema,
  sku: ProductFieldSchema,
  gtin: ProductFieldSchema,
  color: ProductFieldSchema,
  size: ProductFieldSchema,
  material: ProductFieldSchema,
  price: ProductFieldSchema,
  priceCurrency: ProductFieldSchema,
  lowPrice: ProductFieldSchema,
  highPrice: ProductFieldSchema,
  availability: ProductFieldSchema,
  rating: ProductFieldSchema,
  reviewCount: ProductFieldSchema,
  seller: ProductFieldSchema
});

export const BrowserPageSchema = z.object({
  browser: z.string().min(1).max(80),
  url: z.string().min(1).max(MAX_URL_CHARS),
  title: WindowTextSchema.optional(),
  selection: UserTextSchema.optional(),
  element: z
    .object({
      tag: z.string().min(1).max(40),
      role: z.string().max(80).optional(),
      text: z.string().max(MAX_TARGET_VALUE_CHARS).optional(),
      href: z.string().max(MAX_URL_CHARS).optional(),
      alt: WindowTextSchema.optional()
    })
    .optional(),
  around: z.string().max(MAX_TARGET_TEXT_CHARS).optional(),
  text: z.string().max(MAX_PAGE_TEXT_CHARS).optional(),
  product: BrowserProductSchema.optional()
});

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
  target: PointerTargetSchema.optional(),
  cursorCrop: ScreenshotPayloadSchema.optional(),
  cursorCropFocus: CursorCropFocusSchema.optional(),
  ocrText: z.string().max(MAX_TARGET_TEXT_CHARS).optional(),
  page: BrowserPageSchema.optional(),
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
  screenshotError: PermissionErrorSchema.optional(),
  captureBlocked: CaptureBlockedSchema.optional()
});

export const AskMauzRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  context: MauzDesktopContextSchema,
  requestId: z.string().trim().min(1).max(128).optional()
});

export const AskMauzResponseSchema = z.object({
  answer: z.string(),
  model: ModelNameSchema,
  usage: z.unknown().optional()
});

export const MauzLensResizeRequestSchema = z.object({
  expanded: z.boolean()
});

export const TaskAgentsResponseSchema = z.object({
  agents: z.array(
    z.object({
      id: TaskAgentIdSchema,
      label: z.string().min(1).max(80),
      installed: z.boolean()
    })
  ),
  selectedAgentId: TaskAgentIdSchema.nullable()
});

export const TaskFoldersRequestSchema = z.object({ agentId: TaskAgentIdSchema });

export const TaskFoldersResponseSchema = z.object({
  folders: z.array(z.object({ path: FolderPathSchema.min(1), name: z.string().max(260) })).max(100),
  selectedPath: FolderPathSchema
});

export const TaskSendRequestSchema = z.object({
  agentId: TaskAgentIdSchema,
  folder: FolderPathSchema.min(1),
  task: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  context: MauzDesktopContextSchema
});

export const TaskSendResponseSchema = z.object({ agentLabel: z.string().min(1).max(80) });
