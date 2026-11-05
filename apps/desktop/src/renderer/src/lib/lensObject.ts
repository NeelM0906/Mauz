import { describeElement, type MauzDesktopContext, type ScreenshotPayload } from "@mauzai/shared";
import type { LensAction, LensMemory } from "@renderer/state/useMauzStore";

export type LensObjectType =
  | "selected-text"
  | "element"
  | "cursor-area"
  | "screen"
  | "window"
  | "cursor"
  | "blocked"
  | "page"
  | "region";

/** One line of "What Mauz saw": exactly what is sent with a question. */
export type CaptureDetail = {
  label: string;
  text?: string | undefined;
  image?: ScreenshotPayload | undefined;
};

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

  if (context.captureBlocked !== undefined) {
    return {
      id: createLensId(context, "blocked"),
      type: "blocked",
      label: `Capture blocked in ${context.captureBlocked.appName}`,
      summary:
        "This app is on your never-capture list. Mauz sends no screenshot, text, or window title from it.",
      confidence: 0,
      privacyMode: "Nothing captured",
      suggestedActions: ["ask"]
    };
  }

  const selectedText = context.selectedText ?? context.pointer?.selectedText;
  const activeApp = context.activeApp ?? context.pointer?.activeApp;
  const activeWindow = context.activeWindow ?? context.pointer?.activeWindow;
  const target = context.pointer?.target;
  const appName = target?.window?.appName?.trim() || activeApp?.name?.trim() || "current app";
  const windowTitle = activeWindow?.title?.trim() || undefined;
  const imageMode = describeImageMode(context);

  if (selectedText?.trim()) {
    return {
      id: createLensId(context, "selected-text"),
      type: "selected-text",
      label: `Selected text in ${appName}`,
      summary: truncateText(selectedText.trim(), 160),
      confidence: 96,
      privacyMode: imageMode === undefined ? "Selected text" : `Selected text + ${imageMode}`,
      suggestedActions: ["explain", "transform", "remember", "compare"]
    };
  }

  const ocrText = context.pointer?.ocrText;

  if (context.pointer?.cursorCropFocus?.kind === "region") {
    return {
      id: createLensId(context, "region"),
      type: "region",
      label: `Selected area in ${appName}`,
      summary:
        ocrText === undefined ? "Mauz will answer about the area you selected." : truncateText(ocrText, 160),
      confidence: 94,
      privacyMode: ocrText === undefined ? "Selected area" : "Selected area + recognized text",
      suggestedActions: ["ask", "explain", "transform", "remember", "compare"]
    };
  }

  const page = context.pointer?.page;

  if (page !== undefined) {
    const product = page.product;
    const price = product?.price ?? product?.lowPrice;
    const name = product?.name ?? page.title ?? getHost(page.url);

    return {
      id: createLensId(context, "page"),
      type: "page",
      label: `${truncateText(name, 60)} in ${page.browser}`,
      summary: truncateText(
        product !== undefined && price !== undefined
          ? [
              product.brand,
              product.name,
              `${price}${product.priceCurrency ? ` ${product.priceCurrency}` : ""}`
            ]
              .filter(Boolean)
              .join(" · ")
          : (page.element?.text ?? page.around ?? page.url),
        160
      ),
      confidence: 95,
      privacyMode: imageMode === undefined ? "Page data" : `Page data + ${imageMode}`,
      suggestedActions: ["ask", "explain", "remember", "compare"]
    };
  }

  if (target !== undefined) {
    const element = target.element;
    const text = element.text ?? element.value ?? target.container?.text ?? element.name;

    return {
      id: createLensId(context, "element"),
      type: "element",
      label: `${describeElement(element)} in ${appName}`,
      summary:
        text === undefined
          ? `Mauz read the ${element.role.toLowerCase()} under the pointer from ${appName}.`
          : truncateText(text, 160),
      confidence: 92,
      privacyMode: imageMode === undefined ? "Element text" : `Element text + ${imageMode}`,
      suggestedActions: ["ask", "explain", "remember", "compare"]
    };
  }

  if (context.pointer?.cursorCrop !== undefined) {
    return {
      id: createLensId(context, "cursor-area"),
      type: "cursor-area",
      label: windowTitle === undefined ? `Cursor area in ${appName}` : `Cursor area in ${windowTitle}`,
      summary:
        ocrText === undefined
          ? `A crop around the pointer at ${formatCursor(context)} is ready for object-aware help.`
          : truncateText(ocrText, 160),
      confidence: 84,
      privacyMode: `${imageMode ?? "Cursor crop"}${ocrText === undefined ? "" : " + recognized text"}`,
      suggestedActions: ["ask", "explain", "remember", "compare"]
    };
  }

  if (context.pointer?.screenshot !== undefined || context.screenshot !== undefined) {
    return {
      id: createLensId(context, "screen"),
      type: "screen",
      label: `Window near ${appName}`,
      summary: `Mauz has an image of the window under the pointer at ${formatCursor(context)}.`,
      confidence: 72,
      privacyMode: imageMode ?? "Window image",
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

/** What a question about this context sends, item by item, for the "What Mauz saw" list. */
export function describeCapture(context: MauzDesktopContext | null): CaptureDetail[] {
  if (context === null) {
    return [];
  }

  if (context.captureBlocked !== undefined) {
    return [
      {
        label: `Blocked: ${context.captureBlocked.appName}`,
        text: "Nothing was captured from this app."
      }
    ];
  }

  const details: CaptureDetail[] = [];
  const selectedText = context.selectedText ?? context.pointer?.selectedText;
  const target = context.pointer?.target;

  if (selectedText?.trim()) {
    details.push({ label: "Selected text", text: truncateText(selectedText, 300) });
  }

  const page = context.pointer?.page;

  if (page !== undefined) {
    details.push({ label: `Page: ${truncateText(page.title ?? getHost(page.url), 80)}`, text: page.url });

    if (page.product !== undefined) {
      details.push({
        label: "Product data",
        text: truncateText(
          Object.entries(page.product)
            .map(([key, value]) => `${key}: ${value}`)
            .join("; "),
          300
        )
      });
    }

    if (page.element !== undefined) {
      details.push({
        label: `Pointed on the page: <${page.element.tag}>`,
        ...(page.element.text === undefined ? {} : { text: truncateText(page.element.text, 300) })
      });
    }

    if (page.text !== undefined) {
      details.push({
        label: `Page text, ${page.text.length} characters`,
        text: truncateText(page.text, 300)
      });
    }
  }

  if (target !== undefined) {
    const element = target.element;
    const text = element.text ?? element.value;

    details.push({
      label: `Element: ${describeElement(element)}`,
      ...(text === undefined ? {} : { text: truncateText(text, 300) })
    });

    if (target.container !== undefined) {
      details.push({
        label: `Around it: ${describeElement(target.container)}`,
        ...(target.container.text === undefined ? {} : { text: truncateText(target.container.text, 300) })
      });
    }
  }

  const image = context.pointer?.cursorCrop ?? context.pointer?.screenshot ?? context.screenshot;

  if (image !== undefined) {
    details.push({
      label: `Image: ${describeImageMode(context) ?? "screenshot"}, ${image.width}x${image.height}`,
      image
    });
  }

  if (context.pointer?.ocrText !== undefined) {
    details.push({ label: "Recognized text (OCR)", text: truncateText(context.pointer.ocrText, 300) });
  }

  const window = target?.window;
  const activeWindow = context.activeWindow ?? context.pointer?.activeWindow;
  const windowTitle = window?.title ?? activeWindow?.title;

  if (windowTitle?.trim()) {
    details.push({ label: `Window: ${truncateText(windowTitle, 80)}` });
  }

  if (details.length === 0) {
    details.push({ label: "Cursor position only" });
  }

  return details;
}

function describeImageMode(context: MauzDesktopContext): string | undefined {
  const pointer = context.pointer;

  if (pointer?.cursorCrop !== undefined) {
    switch (pointer.cursorCropFocus?.kind) {
      case "element":
        return "element crop";
      case "pointer-area":
        return "area around pointer";
      case "region":
        return "selected area";
      default:
        return "cursor crop";
    }
  }

  return pointer?.screenshot !== undefined || context.screenshot !== undefined ? "window image" : undefined;
}

function getHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
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
