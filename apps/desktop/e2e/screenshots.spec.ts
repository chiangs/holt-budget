import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { launchHolt } from "./launch.ts";

// Looks at the real thing. Runs only when HOLT_SHOTS names a folder: HOLT_SHOTS=/some/dir pnpm test:e2e
const folder = process.env["HOLT_SHOTS"];

test("screenshots of the shell in each theme and width", async () => {
  test.skip(folder === undefined, "set HOLT_SHOTS to take screenshots");
  if (folder === undefined) return;
  mkdirSync(folder, { recursive: true });
  const holt = await launchHolt();
  const { page } = holt;
  const looks = [
    { name: "light", theme: "hearth-light", glass: false },
    { name: "dark", theme: "hearth-dark", glass: false },
    { name: "dark-glass", theme: "hearth-dark", glass: true },
    { name: "light-glass", theme: "hearth-light", glass: true },
  ];
  for (const look of looks) {
    await page.evaluate(([t, g]) => localStorage.setItem("holt-appearance", JSON.stringify({ theme: t, glass: g })), [look.theme, look.glass] as const);
    await page.reload();
    await page.waitForSelector("h1");
    for (const width of [1440, 900]) {
      await holt.setWidth(width, 900);
      for (const [route, hash] of [["overview", "/"], ["settings", "/settings"]] as const) {
        await page.evaluate((h) => { location.hash = `#${h}`; }, hash);
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(folder, `${route}-${look.name}-${width}.png`) });
      }
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(folder, `ask-${look.name}-${width}.png`) });
      await page.keyboard.press("Escape");
    }
  }
  await holt.close();
});
