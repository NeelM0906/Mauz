import { describe, expect, it } from "vitest";
import type { MauzDesktopContext } from "@mauzai/shared";
import { findFolderForEditorWindow } from "../src/renderer/src/lib/taskFolders";

const FOLDERS = [
  { path: "C:\\Users\\me\\Mauz", name: "Mauz" },
  { path: "C:\\Users\\me\\J-Space", name: "J-Space" }
];

function contextFor(appName: string, title: string): MauzDesktopContext {
  return {
    timestamp: "2026-11-04T12:00:00.000Z",
    platform: "win32",
    cursor: { x: 0, y: 0 },
    pointer: {
      cursor: { x: 0, y: 0 },
      target: { source: "windows-uia", element: { role: "Text" }, window: { appName, title } }
    }
  };
}

describe("findFolderForEditorWindow", () => {
  it("picks the folder open in VS Code from its window title", () => {
    expect(
      findFolderForEditorWindow(
        FOLDERS,
        contextFor("Visual Studio Code", "app.ts - mauz - Visual Studio Code")
      )
    ).toEqual(FOLDERS[0]);
  });

  it("handles Cursor and workspace suffixes", () => {
    expect(
      findFolderForEditorWindow(FOLDERS, contextFor("Cursor", "notes.md — J-Space [WSL: Ubuntu] — Cursor"))
    ).toEqual(FOLDERS[1]);
  });

  it("ignores windows that are not editors", () => {
    expect(
      findFolderForEditorWindow(FOLDERS, contextFor("Microsoft Edge", "Mauz - GitHub - Edge"))
    ).toBeUndefined();
  });

  it("ignores blocked captures and missing context", () => {
    expect(findFolderForEditorWindow(FOLDERS, null)).toBeUndefined();
    expect(
      findFolderForEditorWindow(FOLDERS, {
        ...contextFor("Visual Studio Code", "Mauz - Visual Studio Code"),
        captureBlocked: { appName: "Code.exe" }
      })
    ).toBeUndefined();
  });
});
