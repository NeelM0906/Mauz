import { MauzDesktopContextSchema, type MauzDesktopContext } from "@mauzai/shared";
import { runJavaScriptForAutomation, type AppleScriptRunner } from "./AppleScriptRunner";

export type ActiveWindowMetadata = Pick<MauzDesktopContext, "activeApp" | "activeWindow">;

type ActiveWindowServiceOptions = {
  platform?: NodeJS.Platform;
  runner?: AppleScriptRunner;
};

const ACTIVE_WINDOW_SCRIPT = String.raw`
function readValue(read) {
  try {
    const value = read();
    return value === undefined || value === null ? undefined : value;
  } catch (_error) {
    return undefined;
  }
}

function run() {
  const systemEvents = Application("System Events");
  const processes = systemEvents.applicationProcesses.whose({ frontmost: true })();

  if (processes.length === 0) {
    return "{}";
  }

  const process = processes[0];
  const result = {
    activeApp: {
      name: readValue(() => process.name()),
      bundleId: readValue(() => process.bundleIdentifier()),
      processId: readValue(() => process.unixId())
    }
  };
  const windows = readValue(() => process.windows());

  if (Array.isArray(windows) && windows.length > 0) {
    const window = windows[0];
    const position = readValue(() => window.position());
    const size = readValue(() => window.size());
    const activeWindow = {
      title: readValue(() => window.name())
    };

    if (Array.isArray(position) && Array.isArray(size)) {
      activeWindow.bounds = {
        x: Number(position[0]),
        y: Number(position[1]),
        width: Number(size[0]),
        height: Number(size[1])
      };
    }

    result.activeWindow = activeWindow;
  }

  return JSON.stringify(result);
}
`;

export class ActiveWindowService {
  private readonly platform: NodeJS.Platform;
  private readonly runner: AppleScriptRunner;

  constructor(options: ActiveWindowServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.runner = options.runner ?? runJavaScriptForAutomation;
  }

  async capture(): Promise<ActiveWindowMetadata> {
    if (this.platform !== "darwin") {
      return {};
    }

    try {
      const output = await this.runner(ACTIVE_WINDOW_SCRIPT);
      const parsed = MauzDesktopContextSchema.pick({
        activeApp: true,
        activeWindow: true
      }).safeParse(JSON.parse(output || "{}"));

      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }
}
