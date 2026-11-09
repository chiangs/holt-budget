import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

const mainEntry = join(import.meta.dirname, "../out/main/index.js");

export interface Preferences {
  colorScheme?: "light" | "dark";
  reducedMotion?: boolean;
  reducedTransparency?: boolean;
}

export interface HoltApp {
  app: ElectronApplication;
  page: Page;
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
export async function launchHolt(): Promise<HoltApp> {
  const home = mkdtempSync(join(tmpdir(), "holt-e2e-"));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
  Object.assign(env, {
    XDG_DATA_HOME: join(home, "data"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
  });

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${join(home, "profile")}`],
    env,
  });
  const page = await app.firstWindow();
  await page.waitForSelector("h1");
  const cdp = await page.context().newCDPSession(page);

  return {
    app,
    page,
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
