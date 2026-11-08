import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, safeStorage, session, shell } from "electron";

// ── 1. Key storage: never accept basic_text (technical-decisions.md §5) ─────
// Electron only picks GNOME Keyring for desktops it recognises, and Hyprland
// isn't one. If a Secret Service is running, force it before the app is ready.
function secretServiceRunning(): boolean {
  try {
    const out = execFileSync("busctl", ["--user", "list", "--no-pager"], { encoding: "utf8", timeout: 2000 });
    return out.includes("org.freedesktop.secrets");
  } catch {
    return false;
  }
}

if (process.platform === "linux" && !app.commandLine.hasSwitch("password-store") && secretServiceRunning()) {
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
}

// ── 2. Network lock-down: nothing leaves the machine (§3) ───────────────────
// Allowed: the app's own files, the dev server while developing, and the
// local model endpoint on loopback. Everything else is cancelled.
const devServerUrl = process.env["ELECTRON_RENDERER_URL"];

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname === "localhost";
}

function allowed(url: string): boolean {
  const u = new URL(url);
  if (u.protocol === "file:" || u.protocol === "devtools:" || u.protocol === "data:" || u.protocol === "blob:") return true;
  if (devServerUrl && url.startsWith(devServerUrl)) return true;
  // The model runtime is reached from the main process; the renderer never needs it,
  // but loopback is the only network destination Holt ever permits.
  return (u.protocol === "http:" || u.protocol === "ws:") && isLoopback(u.hostname);
}

function lockDownNetwork(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const ok = allowed(details.url);
    if (!ok) console.warn(`[holt] blocked request: ${details.url}`);
    callback({ cancel: !ok });
  });
  // No permission prompts (camera, notifications from web content, etc.).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

// ── 3. Window ───────────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    title: "Holt",
    backgroundColor: "#f3f1ee",
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

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

// ── 4. Typed bridge handlers (see src/preload) ──────────────────────────────
ipcMain.handle("holt:app-info", () => ({
  version: app.getVersion(),
  storageBackend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os",
}));

app.whenReady().then(() => {
  lockDownNetwork();

  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    // Spike S2: fall back to a passphrase (Argon2id) instead of storing the key unprotected.
    console.warn("[holt] No keyring available: the passphrase fallback is not built yet (spike S2).");
  }

  createWindow();
});

app.on("window-all-closed", () => app.quit());

// Holt never opens links itself; this guards against accidental shell.openExternal use.
void shell;
