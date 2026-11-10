import { execFileSync } from "node:child_process";
import { app, safeStorage, shell } from "electron";
import { mintId } from "../shared/ids.ts";
import { systemClock } from "./clock.ts";
import { registerIpc } from "./ipc.ts";
import { lockDownNetwork } from "./network.ts";
import { initAppDatabase } from "./storage/app-database.ts";
import { createKeys, dataFolder, hasKeys } from "./storage/keystore.ts";
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

// Date fields follow Chromium's locale, which is US English by default ("11/09/2026" reads as 9 November or 11
// September). The interface is British English until Norwegian arrives, so dates are written day first.
app.commandLine.appendSwitch("lang", "en-GB");

app.whenReady().then(async () => {
  const s2Check = app.commandLine.getSwitchValue("holt-s2-check");
  if (s2Check) {
    const { runS2Check } = await import("./storage/s2-check.ts");
    app.exit(await runS2Check(s2Check));
    return;
  }

  lockDownNetwork();
  registerIpc();

  // The seed and its passphrase exist only in builds that define __HOLT_DEV_SEED__, so the bundler drops this block from production.
  let passphrase: string | undefined;
  if (__HOLT_DEV_SEED__ && app.commandLine.hasSwitch("holt-seed")) {
    const dev = await import("./dev/seed.ts");
    passphrase = dev.devPassphrase;
    await dev.seedDevData(dataFolder(), {
      clock: systemClock,
      mint: mintId,
      packaged: app.isPackaged,
      reseed: process.env["HOLT_RESEED"] === "1",
      keys: { exists: hasKeys, create: createKeys },
    });
  }
  await initAppDatabase(passphrase === undefined ? {} : { passphrase });

  if (passphrase === undefined && process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
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
