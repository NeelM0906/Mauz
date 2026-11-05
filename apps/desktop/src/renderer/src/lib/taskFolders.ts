import type { MauzDesktopContext, TaskFolder } from "@mauzai/shared";

const EDITOR_PATTERN = /visual studio code|\bcode(\.exe)?$|code - insiders|cursor|windsurf|vscodium/i;

/**
 * When the user is pointing at an editor (VS Code, Cursor, Windsurf), the window title names
 * the open folder ("file.ts - Mauz - Visual Studio Code"). Returns the agent folder with that
 * name, so Send to agent targets the project on screen.
 */
export function findFolderForEditorWindow(
  folders: readonly TaskFolder[],
  context: MauzDesktopContext | null
): TaskFolder | undefined {
  if (context === null || context.captureBlocked !== undefined) {
    return undefined;
  }

  const window = context.pointer?.target?.window;
  const app = [
    window?.appName,
    window?.executable,
    context.activeApp?.name,
    context.pointer?.activeApp?.name
  ].filter((value): value is string => value !== undefined);
  const title = window?.title ?? context.activeWindow?.title ?? context.pointer?.activeWindow?.title;

  if (title === undefined || !app.some((name) => EDITOR_PATTERN.test(name))) {
    return undefined;
  }

  const segments = new Set(
    title
      .split(/\s+[-—–]\s+/)
      .map((segment) =>
        segment
          .replace(/\s*\[[^\]]*\]\s*$/, "")
          .trim()
          .toLowerCase()
      )
      .filter((segment) => segment.length > 0)
  );

  return folders.find((folder) => segments.has(folder.name.toLowerCase()));
}
