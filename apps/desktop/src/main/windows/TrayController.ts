import { Menu, Tray, nativeImage } from "electron";

export type TrayControllerOptions = {
  iconPath: string;
  onOpenMauz: () => void;
  onOpenSettings: () => void;
  onToggleShake: (enabled: boolean) => void;
  isShakeEnabled: () => boolean;
  onQuit: () => void;
};

/**
 * Notification-area (Windows) / menu-bar (macOS) presence for the resident assistant:
 * the place to reopen Mauz, pause shake, and quit.
 */
export class TrayController {
  private tray: Tray | null = null;

  constructor(private readonly options: TrayControllerOptions) {}

  create(): void {
    if (this.tray !== null) {
      return;
    }

    const image = nativeImage.createFromPath(this.options.iconPath);
    // Windows picks the tray size per DPI and downsamples cleanly; macOS wants an 18pt image.
    const trayImage =
      process.platform === "darwin" && !image.isEmpty()
        ? image.resize({ width: 18, height: 18, quality: "best" })
        : image;
    const tray = new Tray(trayImage);

    tray.setToolTip("MauzAI");
    tray.on("click", () => {
      // macOS shows the context menu on click; Windows users expect left-click to open the app.
      if (process.platform !== "darwin") {
        this.options.onOpenMauz();
      }
    });
    this.tray = tray;
    this.refresh();
  }

  refresh(): void {
    if (this.tray === null) {
      return;
    }

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Mauz", click: () => this.options.onOpenMauz() },
        { label: "History and settings", click: () => this.options.onOpenSettings() },
        { type: "separator" },
        {
          label: "Mouse shake",
          type: "checkbox",
          checked: this.options.isShakeEnabled(),
          click: (item) => this.options.onToggleShake(item.checked)
        },
        { type: "separator" },
        { label: "Quit Mauz", click: () => this.options.onQuit() }
      ])
    );
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
