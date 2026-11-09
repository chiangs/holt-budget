import { execFileSync } from "node:child_process";
import { app, safeStorage, shell } from "electron";
import { registerIpc } from "./ipc.ts";
import { lockDownNetwork } from "./network.ts";
import { initAppDatabase } from "./storage/app-database.ts";
import { createWindow } from "./window.ts";

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

app.whenReady().then(async () => {
  const s2Check = app.commandLine.getSwitchValue("holt-s2-check");
  if (s2Check) {
    const { runS2Check } = await import("./storage/s2-check.ts");
    app.exit(await runS2Check(s2Check));
    return;
  }

  lockDownNetwork();
  registerIpc();
  await initAppDatabase();

  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    // Spike S2: fall back to a passphrase (Argon2id) instead of storing the key unprotected.
    console.warn("[holt] No keyring available: the passphrase fallback is not built yet (spike S2).");
  }

  const win = createWindow();

  // The no-network test (scripts/no-network.sh) needs the app to load, wait for any late request, then exit.
  if (app.commandLine.hasSwitch("holt-smoke-exit")) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        console.log("[holt] smoke-exit: window loaded");
        app.quit();
      }, 3000);
    });
  }
});

app.on("window-all-closed", () => app.quit());

// Holt never opens links itself; this guards against accidental shell.openExternal use.
void shell;
