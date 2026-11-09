import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { launchHolt, type HoltApp } from "./launch.ts";

const messages: Record<string, string> = JSON.parse(
  readFileSync(join(import.meta.dirname, "../src/renderer/src/messages/en-GB.json"), "utf8"),
);
const say = (id: string): string => {
  const text = messages[id];
  if (text === undefined) throw new Error(`No message ${id}`);
  return text;
};

// The screen map (information-architecture-and-glossary.md). Ask or find is not a route.
const routes = [
  { path: "/", title: "screen.overview.title", nav: "nav.overview", key: "O" },
  { path: "/transactions", title: "screen.transactions.title", nav: "nav.transactions", key: "T" },
  { path: "/plan", title: "screen.plan.title", nav: "nav.plan", key: "P" },
  { path: "/recurring", title: "screen.recurring.title", nav: "nav.recurring", key: "R" },
  { path: "/review", title: "screen.review.title", nav: "nav.review", key: "M" },
  { path: "/insurance", title: "screen.insurance.title", nav: "nav.insurance", key: "I" },
  { path: "/settings", title: "screen.settings.title", nav: "nav.settings", key: "S" },
  { path: "/setup", title: "screen.setup.title" },
] as const;

const themes = [
  { name: "Hearth light", theme: "hearth-light", glass: false },
  { name: "Hearth dark", theme: "hearth-dark", glass: false },
  { name: "Hearth light with glass", theme: "hearth-light", glass: true },
  { name: "Hearth dark with glass", theme: "hearth-dark", glass: true },
] as const;

let holt: HoltApp;
let page: Page;

test.beforeAll(async () => {
  holt = await launchHolt();
  page = holt.page;
});
test.afterAll(async () => {
  await holt.close();
});

const hash = () => page.evaluate(() => location.hash);
const heading = () => page.getByRole("heading", { level: 1 });
const dialog = () => page.getByRole("dialog");

async function show(path: string): Promise<void> {
  await page.evaluate((to) => {
    location.hash = `#${to}`;
  }, path);
  await expect(page).toHaveURL(new RegExp(`#${path === "/" ? "/?" : path}$`));
}

/** Starts each test from the same place: Overview, 1440 wide, light, glass off, no desktop preferences. */
test.beforeEach(async () => {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await heading().waitFor();
  await holt.emulate({});
  await holt.setWidth(1440);
  await show("/");
  await page.mouse.click(700, 500);
});

async function chooseAppearance(theme: "hearth-light" | "hearth-dark", glass: boolean): Promise<void> {
  await page.evaluate(([t, g]) => localStorage.setItem("holt-appearance", JSON.stringify({ theme: t, glass: g })), [theme, glass] as const);
  await page.reload();
  await heading().waitFor();
}

test.describe("routes (W1)", () => {
  for (const { path, title } of routes) {
    test(`W1: ${path} opens and shows its heading`, async () => {
      await show(path);
      await expect(heading()).toHaveText(say(title));
    });
  }

  test("W1: an unknown route says so, and there is no /ask route", async () => {
    await show("/ask");
    await expect(heading()).toHaveText(say("screen.notFound.title"));
  });
});

test.describe("keys (W2)", () => {
  test("W2: each of A O T P R M I S moves to its screen", async () => {
    await show("/transactions");
    for (const { path, key, title } of routes.filter((r) => "key" in r)) {
      await page.keyboard.press(key);
      await expect(page).toHaveURL(new RegExp(`#${path === "/" ? "/?" : path}$`));
      await expect(heading()).toHaveText(say(title));
    }
    await page.keyboard.press("a");
    await expect(dialog()).toBeVisible();
  });

  test("W2: letters are typed, not obeyed, while a text field has focus", async () => {
    await show("/plan");
    await page.keyboard.press("Control+k");
    const field = page.getByRole("textbox", { name: say("ask.inputLabel") });
    await expect(field).toBeFocused();
    await page.keyboard.type("otprmisa");
    await expect(field).toHaveValue("otprmisa");
    expect(await hash()).toBe("#/plan");
    await expect(heading()).toHaveText(say("screen.plan.title"));
  });

  test("W2: letters do nothing while Ask or find is open and focus is on its button", async () => {
    await show("/plan");
    await page.keyboard.press("a");
    await page.getByRole("button", { name: say("ask.close") }).focus();
    await page.keyboard.press("t");
    expect(await hash()).toBe("#/plan");
  });

  test("W2: Ctrl, Alt and Shift with a letter do not navigate", async () => {
    await show("/plan");
    for (const chord of ["Control+t", "Alt+t", "Shift+t"]) await page.keyboard.press(chord);
    expect(await hash()).toBe("#/plan");
  });
});

test.describe("Ask or find (W3, S1)", () => {
  test("W3: Ctrl K opens it over the current screen, and Esc closes it", async () => {
    await show("/plan");
    await expect(dialog()).toBeHidden();
    await page.keyboard.press("Control+k");
    await expect(dialog()).toBeVisible();
    await expect(heading()).toHaveText(say("screen.plan.title"));
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });

  test("W3: A and the sidebar item open it too", async () => {
    await show("/review");
    await page.keyboard.press("a");
    await expect(dialog()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: say("nav.ask") }).click();
    await expect(dialog()).toBeVisible();
    await page.getByRole("button", { name: say("ask.close") }).click();
    await expect(dialog()).toBeHidden();
  });

  test("S1: leaves the URL hash alone", async () => {
    await show("/transactions");
    await page.keyboard.press("Control+k");
    await expect(dialog()).toBeVisible();
    expect(await hash()).toBe("#/transactions");
    await page.keyboard.press("Escape");
    expect(await hash()).toBe("#/transactions");
  });

  test("S1: returns focus to the element that had it", async () => {
    const link = page.getByRole("link", { name: say("nav.transactions") });
    await link.focus();
    await page.keyboard.press("Control+k");
    await expect(dialog()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
    await expect(link).toBeFocused();
  });

  test("S1: traps focus while open", async () => {
    await page.keyboard.press("Control+k");
    await expect(dialog()).toBeVisible();
    for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(() => document.querySelector("dialog")?.contains(document.activeElement) ?? false);
      expect(inside, `after ${key}`).toBe(true);
    }
  });
});

test.describe("narrow windows (W4)", () => {
  for (const width of [1440, 1100, 900]) {
    test(`W4: no horizontal scroll at ${width} px on any route`, async () => {
      await holt.setWidth(width);
      for (const { path } of routes) {
        await show(path);
        const overflow = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
          width: innerWidth,
        }));
        expect(overflow, path).toEqual({ page: 0, body: 0, width });
      }
    });
  }

  test("W4: below the collapse width the sidebar shows icons and key letters, and every item stays reachable", async () => {
    await holt.setWidth(900);
    const sidebar = page.getByRole("complementary", { name: say("nav.sidebar") });
    const width = (await sidebar.boundingBox())?.width ?? Infinity;
    expect(width).toBeLessThan(100);

    for (const { nav, key, path, title } of routes.filter((r) => "nav" in r)) {
      const item = page.getByRole("link", { name: say(nav) });
      await expect(item.locator(".key")).toHaveText(key);
      expect((await item.locator(".nav-label").boundingBox())?.width ?? 0, `${nav} label is hidden`).toBeLessThanOrEqual(1);
      await item.click();
      await expect(page).toHaveURL(new RegExp(`#${path === "/" ? "/?" : path}$`));
      await expect(heading()).toHaveText(say(title));
    }
    const ask = page.getByRole("button", { name: say("nav.ask") });
    await expect(ask.locator(".key")).toHaveText("A");
    await ask.click();
    await expect(dialog()).toBeVisible();
  });

  test("W4: at 1100 px the sidebar shows its labels", async () => {
    await holt.setWidth(1100);
    const label = page.getByRole("link", { name: say("nav.transactions") }).locator(".nav-label");
    await expect(label).toBeVisible();
    expect((await label.boundingBox())?.width ?? 0).toBeGreaterThan(40);
  });
});

test.describe("themes (W6)", () => {
  const colours = () =>
    page.evaluate(() => ({
      theme: document.documentElement.dataset["theme"],
      glass: document.documentElement.dataset["glass"],
      page: getComputedStyle(document.body).backgroundColor,
      pageImage: getComputedStyle(document.body).backgroundImage,
      sidebar: getComputedStyle(document.querySelector(".sidebar") as Element).backgroundColor,
      blur: getComputedStyle(document.querySelector(".sidebar") as Element).backdropFilter,
    }));
  const alpha = (colour: string) => (/^rgba\(.*,\s*([\d.]+)\)$/.exec(colour)?.[1] === undefined ? 1 : Number(/,\s*([\d.]+)\)$/.exec(colour)?.[1]));

  test("W6: follows the desktop's light or dark by default", async () => {
    await holt.emulate({ colorScheme: "light" });
    await expect.poll(async () => (await colours()).theme).toBe("hearth-light");
    const light = await colours();
    await holt.emulate({ colorScheme: "dark" });
    await expect.poll(async () => (await colours()).theme).toBe("hearth-dark");
    const dark = await colours();
    expect(dark.page).not.toBe(light.page);
  });

  test("W6: Settings switches between Hearth light and Hearth dark whatever the desktop says", async () => {
    await show("/settings");
    await holt.emulate({ colorScheme: "light" });
    await page.getByRole("radio", { name: say("appearance.dark") }).check();
    const dark = await colours();
    await page.getByRole("radio", { name: say("appearance.light") }).check();
    const light = await colours();
    expect([dark.theme, light.theme]).toEqual(["hearth-dark", "hearth-light"]);
    expect(dark.page).not.toBe(light.page);
    expect(dark.sidebar).not.toBe(light.sidebar);
  });

  test("W6: glass is off by default and leaves surfaces opaque", async () => {
    const off = await colours();
    expect(off.glass).toBe("off");
    expect(off.blur).toBe("none");
    expect(alpha(off.sidebar)).toBe(1);
    expect(off.pageImage).toBe("none");
  });

  test("W6: the glass switch makes panels translucent over a backdrop", async () => {
    const before = await colours();
    await show("/settings");
    await page.getByRole("checkbox", { name: say("appearance.glass") }).check();
    const on = await colours();
    expect(on.glass).toBe("on");
    expect(on.blur).toContain("blur");
    expect(alpha(on.sidebar)).toBeLessThan(1);
    expect(on.pageImage).toContain("gradient");
    expect(on.sidebar).not.toBe(before.sidebar);
    await page.getByRole("checkbox", { name: say("appearance.glass") }).uncheck();
    expect((await colours()).blur).toBe("none");
  });

  test("W6: glass works in both themes", async () => {
    for (const theme of ["hearth-light", "hearth-dark"] as const) {
      await chooseAppearance(theme, true);
      const state = await colours();
      expect([state.theme, state.glass, state.blur.includes("blur")]).toEqual([theme, "on", true]);
    }
  });

  test("W6: reduced transparency turns glass off, and Settings says why", async () => {
    await chooseAppearance("hearth-dark", true);
    expect((await colours()).glass).toBe("on");
    await holt.emulate({ reducedTransparency: true });
    await expect.poll(async () => (await colours()).glass).toBe("off");
    const state = await colours();
    expect(state.blur).toBe("none");
    expect(alpha(state.sidebar)).toBe(1);
    await show("/settings");
    await expect(page.getByRole("checkbox", { name: say("appearance.glass") })).toBeDisabled();
    await expect(page.getByText(say("appearance.glassBlocked"))).toBeVisible();
  });
});

test.describe("motion (W7)", () => {
  const timing = () =>
    page.evaluate(() => ({
      transition: getComputedStyle(document.querySelector(".nav-row") as Element).transitionDuration,
    }));

  test("W7: the shell animates by default", async () => {
    expect((await timing()).transition).not.toBe("0s");
  });

  test("W7: reduced motion removes transitions and the overlay's animation", async () => {
    await holt.emulate({ reducedMotion: true });
    expect((await timing()).transition).toBe("0s");
    await page.keyboard.press("Control+k");
    await expect(dialog()).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("dialog") as Element).animationName)).toBe("none");
  });
});

// @axe-core/playwright opens a second page to finish a run, which Electron cannot do. Run axe-core
// itself in the page instead. Evaluating the source over the debugger bypasses the page's CSP.
const axeSource = readFileSync(
  createRequire(createRequire(import.meta.url).resolve("@axe-core/playwright")).resolve("axe-core/axe.min.js"),
  "utf8",
);

interface AxeResult {
  violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[];
}

test.describe("accessibility (W8)", () => {
  async function violations(): Promise<string[]> {
    await page.evaluate(axeSource);
    const { violations: found } = await page.evaluate<AxeResult>("axe.run(document)");
    return found
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.map(String).join(" ")).join(", ")}`);
  }

  for (const { name, theme, glass } of themes) {
    test(`W8: axe finds no serious or critical violation on any route in ${name}`, async () => {
      await chooseAppearance(theme, glass);
      expect(await page.evaluate(() => document.documentElement.dataset["glass"])).toBe(glass ? "on" : "off");
      for (const { path } of routes) {
        await show(path);
        expect(await violations(), `${path} in ${name}`).toEqual([]);
      }
      await page.keyboard.press("Control+k");
      await expect(dialog()).toBeVisible();
      await page.waitForFunction(() => document.querySelector("dialog")?.getAnimations().length === 0);
      expect(await violations(), `Ask or find in ${name}`).toEqual([]);
    });
  }
});
