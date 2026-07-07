import type { MauzDesktopContext } from "@mauzai/shared";
import type { LensAction, LensMemory } from "@renderer/state/useMauzStore";

export type LensObjectType = "selected-text" | "cursor-area" | "screen" | "window" | "cursor";

export type LensObject = {
  id: string;
  type: LensObjectType;
  label: string;
  summary: string;
  confidence: number;
  privacyMode: string;
  suggestedActions: LensAction[];
};

export function detectLensObject(context: MauzDesktopContext | null): LensObject {
  if (context === null) {
    return {
      id: "empty",
      type: "cursor",
      label: "No cursor context",
      summary: "Open Mauz from the cursor to create a Lens snapshot.",
      confidence: 0,
      privacyMode: "No context captured",
      suggestedActions: ["ask"]
    };
  }

  const selectedText = context.selectedText ?? context.pointer?.selectedText;
  const activeApp = context.activeApp ?? context.pointer?.activeApp;
  const activeWindow = context.activeWindow ?? context.pointer?.activeWindow;
  const appName = activeApp?.name?.trim() || "current app";
  const windowTitle = activeWindow?.title?.trim() || undefined;

  if (selectedText?.trim()) {
    return {
      id: createLensId(context, "selected-text"),
      type: "selected-text",
      label: `Selected text in ${appName}`,
      summary: truncateText(selectedText.trim(), 160),
      confidence: 96,
      privacyMode: "Selected text + cursor crop",
      suggestedActions: ["explain", "transform", "remember", "compare"]
    };
  }

  if (context.pointer?.cursorCrop !== undefined) {
    return {
      id: createLensId(context, "cursor-area"),
      type: "cursor-area",
      label: windowTitle === undefined ? `Cursor area in ${appName}` : `Cursor area in ${windowTitle}`,
      summary: `A crop around the pointer at ${formatCursor(context)} is ready for object-aware help.`,
      confidence: 84,
      privacyMode:
        context.pointer.screenshot === undefined
          ? "Cursor crop only"
          : "Cursor crop + local screenshot metadata",
      suggestedActions: ["ask", "explain", "remember", "compare"]
    };
  }

  if (context.pointer?.screenshot !== undefined || context.screenshot !== undefined) {
    return {
      id: createLensId(context, "screen"),
      type: "screen",
      label: `Screen context near ${appName}`,
      summary: `Mauz has broad screen context at ${formatCursor(context)}.`,
      confidence: 72,
      privacyMode: "Screenshot attached",
      suggestedActions: ["ask", "remember"]
    };
  }

  if (activeApp !== undefined || activeWindow !== undefined) {
    return {
      id: createLensId(context, "window"),
      type: "window",
      label: windowTitle === undefined ? appName : windowTitle,
      summary: `Window metadata from ${appName} is available, without a screenshot.`,
      confidence: 58,
      privacyMode: "Window metadata only",
      suggestedActions: ["ask", "remember"]
    };
  }

  return {
    id: createLensId(context, "cursor"),
    type: "cursor",
    label: "Cursor point",
    summary: `Mauz knows the pointer location at ${formatCursor(context)}.`,
    confidence: 36,
    privacyMode: "Cursor coordinates only",
    suggestedActions: ["ask"]
  };
}

export function toLensMemory(lensObject: LensObject): LensMemory {
  return {
    id: `${lensObject.id}:${Date.now()}`,
    label: lensObject.label,
    type: lensObject.type,
    summary: lensObject.summary,
    createdAt: new Date().toISOString()
  };
}

export function getLensActionQuestion(
  action: LensAction,
  lensObject: LensObject,
  pinnedObject: LensMemory | null,
  customQuestion: string
): string {
  const trimmedQuestion = customQuestion.trim();

  if (trimmedQuestion.length > 0) {
    // Only inject the pinned object context for the compare action
    return action === "compare" ? appendPinnedObject(trimmedQuestion, pinnedObject) : trimmedQuestion;
  }

  if (action === "explain") {
    return "Explain this clearly and tell me what matters.";
  }

  if (action === "transform") {
    return "Transform this into the most useful next-step output.";
  }

  if (action === "compare") {
    return pinnedObject === null
      ? "Explain this and identify what I should compare it with next."
      : `Compare this current object with the pinned object: ${pinnedObject.label}. Pinned summary: ${pinnedObject.summary}`;
  }

  return `Help me with this ${lensObject.type.replace("-", " ")}.`;
}

function appendPinnedObject(question: string, pinnedObject: LensMemory | null): string {
  if (pinnedObject === null) {
    return question;
  }

  return `${question}\n\nPinned "this" for reference: ${pinnedObject.label}. ${pinnedObject.summary}`;
}

function createLensId(context: MauzDesktopContext, type: LensObjectType): string {
  return `${type}:${context.timestamp}:${Math.round(context.cursor.x)}:${Math.round(context.cursor.y)}`;
}

function formatCursor(context: MauzDesktopContext): string {
  return `${Math.round(context.cursor.x)}, ${Math.round(context.cursor.y)}`;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
