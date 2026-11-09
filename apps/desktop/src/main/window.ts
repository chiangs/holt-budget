import { join } from "node:path";
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import tokens from "../../../../design/design-system/tokens.json";
import { allowed, devServerUrl } from "./network.ts";

// ── 3. Window ───────────────────────────────────────────────────────────────
// Native window colour shown before the renderer paints. Read from the design
// tokens so no colour literal lives in code.
function windowBackground(): string {
  const value = tokens.color.tokens.find((t) => t.name === "bg")?.value;
  const colour = typeof value === "object" ? value["hearth-light"] : value;
  if (colour === undefined) throw new Error("tokens.json has no bg token");
  return colour;
}

/**
 * No minWidth or minHeight: Hyprland ignores a client's minimum for tiled windows (0040). No frame
 * and no window buttons: the compositor manages the window, and the renderer draws a drag strip.
 */
export function windowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    frame: false,
    title: "Holt",
    backgroundColor: windowBackground(),
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  };
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow(windowOptions());

  win.once("ready-to-show", () => win.show());

  // Never open new windows or navigate away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
  return win;
}

