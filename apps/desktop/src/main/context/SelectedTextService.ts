import { runJavaScriptForAutomation, type AppleScriptRunner } from "./AppleScriptRunner";

type SelectedTextServiceOptions = {
  platform?: NodeJS.Platform;
  runner?: AppleScriptRunner;
  maxLength?: number;
};

type SelectedTextTarget = {
  processId?: number | undefined;
};

const DEFAULT_MAX_SELECTED_TEXT_LENGTH = 8_000;

const SELECTED_TEXT_SCRIPT = String.raw`
function readValue(read) {
  try {
    const value = read();
    return value === undefined || value === null ? undefined : value;
  } catch (_error) {
    return undefined;
  }
}

function selectedTextFromElement(element) {
  const selectedText = readValue(() => element.attributes.byName("AXSelectedText").value());

  return typeof selectedText === "string" ? selectedText : "";
}

function run(argv) {
  const targetProcessId = Number(argv[0] || 0);
  const systemEvents = Application("System Events");
  const processes = targetProcessId > 0
    ? systemEvents.applicationProcesses.whose({ unixId: targetProcessId })()
    : systemEvents.applicationProcesses.whose({ frontmost: true })();

  if (processes.length === 0) {
    return "";
  }

  const process = processes[0];
  const focusedElement = readValue(() => process.attributes.byName("AXFocusedUIElement").value());

  if (focusedElement !== undefined) {
    const selectedText = selectedTextFromElement(focusedElement);

    if (selectedText.trim().length > 0) {
      return selectedText;
    }
  }

  const windows = readValue(() => process.windows());

  if (Array.isArray(windows) && windows.length > 0) {
    return selectedTextFromElement(windows[0]);
  }

  return "";
}
`;

export class SelectedTextService {
  private readonly platform: NodeJS.Platform;
  private readonly runner: AppleScriptRunner;
  private readonly maxLength: number;

  constructor(options: SelectedTextServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.runner = options.runner ?? runJavaScriptForAutomation;
    this.maxLength = options.maxLength ?? DEFAULT_MAX_SELECTED_TEXT_LENGTH;
  }

  async capture(target: SelectedTextTarget = {}): Promise<string | undefined> {
    if (this.platform !== "darwin") {
      return undefined;
    }

    try {
      const selectedText = await this.runner(SELECTED_TEXT_SCRIPT, [
        target.processId === undefined ? "" : String(target.processId)
      ]);
      const trimmedText = selectedText.trim();

      if (trimmedText.length === 0) {
        return undefined;
      }

      return trimmedText.slice(0, this.maxLength);
    } catch {
      return undefined;
    }
  }
}
