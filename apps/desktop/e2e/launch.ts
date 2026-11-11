import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

/** `HOLT_E2E_OUT` points a run at its own build folder, so two runs never share `out/`. */
const mainEntry = join(process.env["HOLT_E2E_OUT"] ?? join(import.meta.dirname, "../out"), "main/index.js");

export interface Preferences {
  colorScheme?: "light" | "dark";
  reducedMotion?: boolean;
  reducedTransparency?: boolean;
}

export interface LaunchOptions {
  /** Starts on the synthetic household (the `--holt-seed` switch), with keys that don't touch the desktop's keyring. */
  seed?: boolean;
  /** The file the end-to-end build's file picker returns, given the app's data folder. Without it the picker is the native dialog. */
  pickFile?: (dataFolder: string) => string;
}

export interface HoltApp {
  app: ElectronApplication;
  page: Page;
  /** Where this launch keeps its data: a folder named holt-dev inside the throwaway home. */
  dataFolder: string;
  /** Sets the page's layout width by emulating the viewport, so a tiling compositor cannot interfere. */
  setWidth: (width: number, height?: number) => Promise<void>;
  /** Sets the desktop preferences the page sees. Anything left out goes back to "no preference". */
  emulate: (preferences: Preferences) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Launches the built app with a throwaway profile and data folder, so a run never touches the
 * family's data. Playwright drives the page directly, so no key goes to the desktop.
 */
export async function launchHolt(options: LaunchOptions = {}): Promise<HoltApp> {
  const home = mkdtempSync(join(tmpdir(), "holt-e2e-"));
  const dataFolder = join(home, "data", "holt-dev");
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  Object.assign(env, {
    XDG_DATA_HOME: join(home, "data"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
  });
  if (options.pickFile !== undefined) env["HOLT_E2E_PICK_FILE"] = options.pickFile(dataFolder);

  // The basic password store makes Electron report no keyring, so the seed takes its passphrase path and a run never writes to the desktop's keyring.
  const seedArgs = options.seed === true ? ["--holt-seed", "--password-store=basic"] : [];
  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${join(home, "profile")}`, ...seedArgs],
    env,
  });
  const page = await app.firstWindow();
  await page.waitForSelector("h1");
  const cdp = await page.context().newCDPSession(page);

  return {
    app,
    page,
    dataFolder,
    setWidth: async (width, height = 900) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    },
    emulate: async ({ colorScheme = "light", reducedMotion = false, reducedTransparency = false }) => {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: colorScheme },
          { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" },
          { name: "prefers-reduced-transparency", value: reducedTransparency ? "reduce" : "no-preference" },
        ],
      });
    },
    close: async () => {
      await app.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
