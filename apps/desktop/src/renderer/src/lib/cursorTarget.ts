import { describeElement, type MauzDesktopContext, type ScreenshotPayload } from "@mauzai/shared";

type CursorTargetType =
  | "selected-text"
  | "element"
  | "cursor-area"
  | "screen"
  | "window"
  | "cursor"
  | "blocked"
  | "page";

/** One line of "What Mauz saw": exactly what is sent with a question. */
type CaptureDetail = {
  label: string;
  text?: string | undefined;
  image?: ScreenshotPayload | undefined;
};

type CursorTarget = {
  id: string;
  type: CursorTargetType;
  label: string;
  summary: string;
  confidence: number;
  privacyMode: string;
};

export function detectCursorTarget(context: MauzDesktopContext | null): CursorTarget {
  if (context === null) {
    return {
      id: "empty",
      type: "cursor",
      label: "No cursor context",
      summary: "Open Mauz from the cursor to capture what is under it.",
      confidence: 0,
      privacyMode: "No context captured"
    };
  }

  if (context.captureBlocked !== undefined) {
    return {
      id: createCursorTargetId(context, "blocked"),
      type: "blocked",
      label: `Capture blocked in ${context.captureBlocked.appName}`,
      summary:
        "This app is on your never-capture list. Mauz sends no screenshot, text, or window title from it.",
      confidence: 0,
      privacyMode: "Nothing captured"
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
      id: createCursorTargetId(context, "selected-text"),
      type: "selected-text",
      label: `Selected text in ${appName}`,
      summary: truncateText(selectedText.trim(), 160),
      confidence: 96,
      privacyMode: imageMode === undefined ? "Selected text" : `Selected text + ${imageMode}`
    };
  }

  const ocrText = context.pointer?.ocrText;

  const page = context.pointer?.page;

  if (page !== undefined) {
    const product = page.product;
    const price = product?.price ?? product?.lowPrice;
    const name = product?.name ?? page.title ?? getHost(page.url);

    return {
      id: createCursorTargetId(context, "page"),
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
      privacyMode: imageMode === undefined ? "Page data" : `Page data + ${imageMode}`
    };
  }

  if (target !== undefined) {
    const element = target.element;
    const text = element.text ?? element.value ?? target.container?.text ?? element.name;

    return {
      id: createCursorTargetId(context, "element"),
      type: "element",
      label: `${describeElement(element)} in ${appName}`,
      summary:
        text === undefined
          ? `Mauz read the ${element.role.toLowerCase()} under the pointer from ${appName}.`
          : truncateText(text, 160),
      confidence: 92,
      privacyMode: imageMode === undefined ? "Element text" : `Element text + ${imageMode}`
    };
  }

  if (context.pointer?.cursorCrop !== undefined) {
    return {
      id: createCursorTargetId(context, "cursor-area"),
      type: "cursor-area",
      label: windowTitle === undefined ? `Cursor area in ${appName}` : `Cursor area in ${windowTitle}`,
      summary:
        ocrText === undefined
          ? `A crop around the pointer at ${formatCursor(context)} is ready for object-aware help.`
          : truncateText(ocrText, 160),
      confidence: 84,
      privacyMode: `${imageMode ?? "Cursor crop"}${ocrText === undefined ? "" : " + recognized text"}`
    };
  }

  if (context.pointer?.screenshot !== undefined || context.screenshot !== undefined) {
    return {
      id: createCursorTargetId(context, "screen"),
      type: "screen",
      label: `Window near ${appName}`,
      summary: `Mauz has an image of the window under the pointer at ${formatCursor(context)}.`,
      confidence: 72,
      privacyMode: imageMode ?? "Window image"
    };
  }

  if (activeApp !== undefined || activeWindow !== undefined) {
    return {
      id: createCursorTargetId(context, "window"),
      type: "window",
      label: windowTitle === undefined ? appName : windowTitle,
      summary: `Window metadata from ${appName} is available, without a screenshot.`,
      confidence: 58,
      privacyMode: "Window metadata only"
    };
  }

  return {
    id: createCursorTargetId(context, "cursor"),
    type: "cursor",
    label: "Cursor point",
    summary: `Mauz knows the pointer location at ${formatCursor(context)}.`,
    confidence: 36,
    privacyMode: "Cursor coordinates only"
  };
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

function createCursorTargetId(context: MauzDesktopContext, type: CursorTargetType): string {
  return `${type}:${context.timestamp}:${Math.round(context.cursor.x)}:${Math.round(context.cursor.y)}`;
}

function formatCursor(context: MauzDesktopContext): string {
  return `${Math.round(context.cursor.x)}, ${Math.round(context.cursor.y)}`;
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
