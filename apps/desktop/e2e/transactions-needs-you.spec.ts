import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchHolt, type HoltApp } from "./launch.ts";
import { say } from "./messages.ts";

/**
 * The Needs you tab on the synthetic household: what waits for the family, and deciding it quickly with the
 * keyboard. The seeded launch starts with a few dozen transactions waiting and none with a suggestion, so a
 * test that needs a suggestion first sorts the oldest transaction from a payee that has several.
 */

let holt: HoltApp;
let page: Page;

test.describe.serial("Needs you on the synthetic household", () => {
  test.beforeAll(async () => {
    holt = await launchHolt({ seed: true, pickFile: (folder) => join(folder, "sample-imports", "bulder-later.csv") });
    page = holt.page;
    await holt.setWidth(1440, 1100);
    await showTransactions();
  });
  test.afterAll(async () => {
    await holt.close();
  });

  const list = () => page.getByRole("list", { name: say("needsYou.list.label") });
  const rows = () => list().getByRole("listitem");
  const selectedRow = () => list().locator('li[data-selected="true"]');
  const needsYouTab = () => page.getByRole("tab", { name: new RegExp(`^${say("tx.tab.needsYou")}`) });
  const status = () => page.locator('div[role="status"][aria-live="polite"]');
  const alert = () => page.getByRole("alert");
  const dialog = () => page.getByRole("dialog");

  async function showTransactions(): Promise<void> {
    await page.evaluate(() => {
      location.hash = "#/transactions";
    });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(say("screen.transactions.title"));
    await expect(rows().first()).toBeVisible();
  }

  async function waiting(): Promise<number> {
    const text = (await needsYouTab().innerText()).trim();
    const count = /(\d+)\s*$/.exec(text)?.[1];
    if (count === undefined) throw new Error(`No count in the tab: ${text}`);
    return Number(count);
  }

  /** The count the tab, the rows and the list say, once the change that moved it has been saved. */
  const expectWaiting = async (count: number) => {
    await expect.poll(waiting).toBe(count);
    await expect(rows()).toHaveCount(Math.min(count, 50));
    await expect(page.locator('ul[aria-busy="true"]')).toHaveCount(0);
  };

  interface Row {
    readonly index: number;
    readonly label: string;
    readonly who: string;
    readonly amount: string;
    readonly text: string;
    readonly suggested: boolean;
    readonly moneyIn: boolean;
    readonly noPayee: boolean;
  }

  async function readRows(): Promise<Row[]> {
    const noPayee = say("needsYou.why.noPayee");
    return rows().evaluateAll(
      (items, words) =>
        items.map((item, index) => {
          const label = item.getAttribute("aria-label") ?? "";
          const [who = "", amount = ""] = label.split(", ");
          const text = (item as HTMLElement).innerText;
          return { index, label, who, amount, text, suggested: label.includes(". Suggested: "), moneyIn: amount.startsWith("+"), noPayee: text.includes(words) };
        }),
      noPayee,
    );
  }

  async function selectedIndex(): Promise<number> {
    return rows().evaluateAll((items) => items.findIndex((item) => item.getAttribute("data-selected") === "true"));
  }

  /** Moves the selection with the J and K keys, as the family does. */
  async function keyTo(index: number): Promise<void> {
    for (let at = await selectedIndex(); at !== index; at += at < index ? 1 : -1) await page.keyboard.press(at < index ? "j" : "k");
    await expect(selectedRow()).toHaveAttribute("aria-label", (await readRows())[index]?.label ?? "");
    await expect(selectedRow()).toBeFocused();
  }

  async function head(): Promise<{ undo: { kind: string } | null; redo: { kind: string } | null }> {
    return page.evaluate(async () => {
      const reply = await (window as unknown as { holt: { factsSnapshot(): Promise<{ ok: boolean; value: { snapshot: { head: never } } }> } }).holt.factsSnapshot();
      return reply.value.snapshot.head;
    });
  }

  async function facts<T>(pick: (tables: Record<string, any[]>) => T): Promise<T> {
    const tables = await page.evaluate(async () => {
      const reply = await (window as unknown as { holt: { factsSnapshot(): Promise<{ value: { snapshot: { tables: unknown } } }> } }).holt.factsSnapshot();
      return reply.value.snapshot.tables;
    });
    return pick(tables as Record<string, any[]>);
  }

  const isRefund = (x: { amount: number; treatment: { kind: string; allocations?: { amount: number }[] } }) =>
    x.treatment.kind === "split" && x.amount > 0 && (x.treatment.allocations ?? []).every((a) => a.amount > 0);

  /**
   * The payee with the most waiting rows that match, and the rows' positions in the list (newest first). A payee
   * whose rows look the same (same day, amount and account) is left out, because the oldest of them can't be told apart.
   */
  async function crowdedPayee(match: (row: Row) => boolean, atLeast: number): Promise<{ who: string; indexes: number[] }> {
    const all = await readRows();
    const byPayee = new Map<string, number[]>();
    for (const row of all.filter(match)) byPayee.set(row.who, [...(byPayee.get(row.who) ?? []), row.index]);
    const distinct = ([, indexes]: [string, number[]]) => new Set(indexes.map((i) => all[i]?.label)).size === indexes.length;
    const [found] = [...byPayee].filter(distinct).filter(([, indexes]) => indexes.length >= atLeast).sort((a, b) => b[1].length - a[1].length);
    if (found === undefined) throw new Error(`No payee has ${atLeast} matching rows`);
    return { who: found[0], indexes: found[1] };
  }

  async function openActions(who: string, action: string): Promise<void> {
    await page.keyboard.press("Enter");
    const menu = page.getByRole("group", { name: say("needsYou.menu.label").replace("{who}", who) });
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: action, exact: true }).click();
  }

  test("opens on Needs you, and its count is the rows, the tab and the sidebar badge", async () => {
    await expect(needsYouTab()).toHaveAttribute("aria-selected", "true");
    const count = await waiting();
    expect(count).toBeGreaterThan(10);
    await expect(rows()).toHaveCount(Math.min(count, 50));

    const dueChips = await page.getByText(say("tx.chip.state.due"), { exact: true }).count();
    const link = page.getByRole("link", { name: say("nav.transactions") });
    const badge = link.locator("span[data-kind]");
    if (dueChips > 0) {
      await expect(badge).toHaveAttribute("data-kind", "due");
      await expect(badge).toContainText(say("tx.badge.due"));
    } else {
      await expect(badge).toHaveAttribute("data-kind", "needsYou");
      await expect(badge).toContainText(new RegExp(`${count}`));
    }
    await expect(link).toHaveAccessibleName(new RegExp(dueChips > 0 ? say("tx.badge.dueSpoken") : `${count} transactions? needs? you`));
  });

  test("shows each account's state, bank, rhythm and how far its data reaches", async () => {
    const cards = page.getByRole("heading", { level: 3 });
    expect(await cards.count()).toBe(6);
    const everyday = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Everyday" }) });
    await expect(everyday).toContainText(say("tx.bank.bulder"));
    await expect(everyday).toContainText(/Covers to \d+ \w+ · last import (today|\d+ days? ago)/);
    const loan = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Loan payments" }) });
    await expect(loan).toContainText(say("tx.bank.sparebank1"));
  });

  test("keeps the open tab in the address, so reload and back keep it", async () => {
    await page.getByRole("tab", { name: new RegExp(`^${say("tx.tab.all")}`) }).click();
    await expect(page).toHaveURL(/#\/transactions\?tab=all$/);
    await page.reload();
    await expect(page.getByRole("tab", { name: new RegExp(`^${say("tx.tab.all")}`) })).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(needsYouTab()).toHaveAttribute("aria-selected", "true");
    await expect(rows().first()).toBeVisible();
  });

  test("J and K and the arrow keys move a selection with a visible focus ring", async () => {
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    expect(await selectedIndex()).toBe(2);
    await expect(selectedRow()).toBeFocused();
    await page.keyboard.press("k");
    expect(await selectedIndex()).toBe(1);
    await page.keyboard.press("ArrowDown");
    expect(await selectedIndex()).toBe(2);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await selectedIndex()).toBe(0);
    const ring = await selectedRow().evaluate((element) => ({ visible: element.matches(":focus-visible"), width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle }));
    expect(ring).toEqual({ visible: true, width: "2px", style: "solid" });
  });

  test("chooses a job through the picker with the keyboard alone, and the job is the one picked", async () => {
    const { who, indexes } = await crowdedPayee((row) => !row.moneyIn && !row.noPayee && !row.suggested, 3);
    const oldest = indexes.at(-1) as number;
    const before = await waiting();
    await keyTo(oldest);
    await page.keyboard.press("e");
    const picker = page.getByRole("dialog", { name: say("needsYou.job.title") });
    await expect(picker).toBeVisible();
    const search = picker.getByRole("combobox", { name: say("needsYou.job.search") });
    await expect(search).toBeFocused();
    await page.keyboard.type("o");
    expect(await picker.getByRole("option").count()).toBeGreaterThan(3);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const highlighted = (await picker.getByRole("option", { selected: true }).innerText()).trim();
    expect(highlighted.length).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();

    await expectWaiting(before - 1);
    await expect(status()).toContainText("Sorted 1 transaction.");
    const later = (await readRows()).filter((row) => row.who === who && !row.moneyIn);
    expect(later.length).toBe(indexes.length - 1);
    for (const row of later) expect(row.label, row.label).toContain(`Suggested: ${highlighted}`);
    await expect(page.locator("li:focus")).toHaveCount(1);
  });

  test("Space on a row with no suggestion says so and changes nothing", async () => {
    const target = (await readRows()).find((row) => !row.suggested);
    if (target === undefined) throw new Error("Every row has a suggestion");
    const before = await waiting();
    await keyTo(target.index);
    await page.keyboard.press("Space");
    await expect(status()).toContainText(say("needsYou.noSuggestion"));
    await expectWaiting(before);
  });

  test("Space accepts the selected suggestion, and U and Shift U undo and redo it", async () => {
    const suggested = (await readRows()).filter((row) => row.suggested);
    expect(suggested.length).toBeGreaterThan(2);
    const target = suggested.at(-1) as Row;
    const before = await waiting();
    const copies = (await readRows()).filter((row) => row.label === target.label).length;
    await keyTo(target.index);

    await page.keyboard.press("Space");
    await expectWaiting(before - 1);
    expect((await readRows()).filter((row) => row.label === target.label)).toHaveLength(copies - 1);
    await expect(status()).toContainText("Sorted 1 transaction.");
    const undo = status().getByRole("button", { name: new RegExp(`^${say("needsYou.undo")}`) });
    await expect(undo).toBeVisible();
    await expect(page.locator("li:focus")).toHaveCount(1);

    await page.keyboard.press("u");
    await expectWaiting(before);
    expect((await readRows()).filter((row) => row.label === target.label)).toHaveLength(copies);
    await expect(status()).toContainText(say("needsYou.done.undone"));

    await page.keyboard.press("Shift+U");
    await expectWaiting(before - 1);
    await page.keyboard.press("u");
    await expectWaiting(before);
  });

  test("the Undo button undoes too, and a held Space accepts only one row", async () => {
    const suggested = (await readRows()).filter((row) => row.suggested);
    const target = suggested[1] as Row;
    const before = await waiting();
    await keyTo(target.index);
    await page.keyboard.down("Space");
    for (let i = 0; i < 4; i += 1) await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    await expectWaiting(before - 1);
    await page.waitForTimeout(300);
    await expectWaiting(before - 1);
    await status().getByRole("button", { name: new RegExp(`^${say("needsYou.undo")}`) }).click();
    await expectWaiting(before);
  });

  test("Accept all is one change with one undo", async () => {
    const suggested = (await readRows()).filter((row) => row.suggested).length;
    expect(suggested).toBeGreaterThan(1);
    const before = await waiting();
    const changesBefore = (await head()).undo;
    await page.getByRole("button", { name: `Accept all ${suggested} suggestions` }).click();
    await expectWaiting(before - suggested);
    await expect(status()).toContainText(`Accepted ${suggested} suggestions.`);
    expect((await head()).undo?.kind).toBe("batch");

    await page.keyboard.press("u");
    await expectWaiting(before);
    expect((await head()).undo).toEqual(changesBefore);
  });

  test("splits a payment across two jobs in the editor", async () => {
    const target = (await readRows()).find((row) => !row.moneyIn && !row.noPayee);
    if (target === undefined) throw new Error("No payment to split");
    const before = await waiting();
    await keyTo(target.index);
    await openActions(target.who, say("needsYou.action.split"));
    const editor = dialog();
    await expect(editor).toBeVisible();
    await editor.getByLabel(say("browse.split.jobLabel").replace("{n}", "1")).selectOption({ label: "Food and household" });
    await editor.getByLabel(say("browse.split.jobLabel").replace("{n}", "2")).selectOption({ label: "Eating out" });
    await editor.getByRole("button", { name: say("browse.split.evenly") }).click();
    await editor.getByRole("button", { name: say("browse.split.save") }).click();
    await expect(editor).toBeHidden();
    await expectWaiting(before - 1);
    await expect(status()).toContainText(say("needsYou.done.split"));
    await page.keyboard.press("u");
    await expectWaiting(before);
  });

  test("adds a note, and a key typed in the note field is typed, not obeyed", async () => {
    const target = (await readRows())[1] as Row;
    const before = await waiting();
    await keyTo(target.index);
    await openActions(target.who, say("needsYou.action.addNote"));
    const field = page.getByRole("textbox", { name: say("needsYou.note.field").replace("{who}", target.who) });
    await expect(field).toBeFocused();
    const at = await selectedIndex();
    await page.keyboard.type("jk u e n space");
    await expect(field).toHaveValue("jk u e n space");
    expect(await selectedIndex()).toBe(at);
    await expect(dialog()).toBeHidden();
    await expectWaiting(before);

    await page.keyboard.press("Enter");
    await expect(selectedRow()).toContainText("Note: jk u e n space");
    await expect(status()).toContainText(say("needsYou.done.noteSaved"));
    await expectWaiting(before);

    await keyTo(at);
    await openActions(target.who, say("needsYou.action.editNote"));
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await expect(selectedRow()).not.toContainText("Note:");
    await expect(status()).toContainText(say("needsYou.done.noteRemoved"));
  });

  test("Always do this makes a rule and sorts the other waiting transactions it matches, in one change", async () => {
    const { who, indexes } = await crowdedPayee((row) => !row.moneyIn && !row.noPayee, 2);
    const first = indexes[0] as number;
    const others = indexes.length - 1;
    const before = await waiting();
    const rulesBefore = await facts((t) => (t["rules"] ?? []).length);

    // Choosing a job other than the suggestion is a correction the app learns from. Choosing the suggested job is a rule you set.
    for (const [job, origin] of [["Eating out", "learned"], [null, "set"]] as const) {
      await keyTo(first);
      await openActions(who, say("needsYou.action.always"));
      const form = page.getByRole("dialog", { name: say("needsYou.rule.title") });
      await expect(form).toBeVisible();
      await expect(form.getByText(say("needsYou.rule.directionOut"))).toBeVisible();
      const choice = form.getByRole("combobox", { name: say("needsYou.rule.job") });
      if (job === null) expect(await choice.inputValue()).not.toBe("");
      else await choice.selectOption({ label: job });
      const alsoSort = form.getByRole("checkbox", { name: new RegExp(`Also sort ${others} other waiting transactions? that match`) });
      await expect(alsoSort).toBeChecked();
      await form.getByRole("button", { name: say("needsYou.rule.submit") }).click();
      await expect(form).toBeHidden();

      await expectWaiting(before - 1 - others);
      await expect(status()).toContainText(`Made a rule for ${who}. Sorted ${1 + others} transactions.`);
      expect((await head()).undo?.kind).toBe("batch");
      const made = await facts((t) => ({ rules: t["rules"] ?? [], transactions: t["transactions"] ?? [] }));
      expect(made.rules).toHaveLength(rulesBefore + 1);
      const rule = made.rules.find((r) => r.match.counterparty === who);
      expect(rule).toMatchObject({ origin, result: { kind: "job" }, match: { counterparty: who, max: -1 } });
      expect(made.transactions.filter((t) => t.ruleId === rule.id)).toHaveLength(1 + others);

      await page.keyboard.press("u");
      await expectWaiting(before);
      expect(await facts((t) => (t["rules"] ?? []).length)).toBe(rulesBefore);
    }
  });

  test("marks money in as a refund against a job, which is not income", async () => {
    const target = (await readRows()).find((row) => row.moneyIn && !row.suggested);
    if (target === undefined) throw new Error("No money in waiting");
    const before = await waiting();
    const incomeBefore = await facts((t) => (t["transactions"] ?? []).filter((x) => x.treatment.kind === "income").length);
    const refundsBefore = await facts((t) => (t["transactions"] ?? []).filter(isRefund).length);
    await keyTo(target.index);
    await openActions(target.who, say("needsYou.action.refund"));
    const picker = page.getByRole("dialog", { name: say("needsYou.refund.title") });
    await expect(picker.getByText(say("needsYou.refund.hint"))).toBeVisible();
    await page.keyboard.type("eating");
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();
    await expectWaiting(before - 1);
    await expect(status()).toContainText(say("needsYou.done.refund"));
    expect(await facts((t) => (t["transactions"] ?? []).filter(isRefund).length)).toBe(refundsBefore + 1);
    const eatingOut = await facts((t) => (t["jobs"] ?? []).find((job) => job.name === "Eating out").id);
    expect(await facts((t) => (t["transactions"] ?? []).filter(isRefund).map((x) => x.treatment.allocations?.[0]?.jobId))).toContain(eatingOut);
    expect(await facts((t) => (t["transactions"] ?? []).filter((x) => x.treatment.kind === "income").length)).toBe(incomeBefore);
    await page.keyboard.press("u");
    await expectWaiting(before);
  });

  test("marks money in as income for the month after, from a source", async () => {
    const target = (await readRows()).find((row) => row.moneyIn && !row.suggested);
    if (target === undefined) throw new Error("No money in waiting");
    const before = await waiting();
    await keyTo(target.index);
    await openActions(target.who, say("needsYou.action.income"));
    const form = page.getByRole("dialog", { name: say("needsYou.income.title") });
    const month = form.getByRole("combobox", { name: say("needsYou.income.month") });
    const chosen = await month.inputValue();
    expect(chosen).toMatch(/^\d{4}-\d{2}$/);
    await form.getByRole("radio", { name: say("needsYou.income.source.recurring") }).check();
    await form.getByRole("button", { name: say("needsYou.income.submit") }).click();
    await expectWaiting(before - 1);
    const monthAfter = (date: string) => {
      const [year, month] = date.split("-").map(Number) as [number, number];
      return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
    };
    const incomes = await facts((t) => (t["transactions"] ?? []).filter((x) => x.treatment.kind === "income" && x.treatment.source === "recurring" && x.treatment.fundsMonth === chosen));
    expect(incomes.length).toBeGreaterThan(0);
    expect(incomes.every((x) => monthAfter(x.bookingDate) === chosen)).toBe(true);
    await page.keyboard.press("u");
    await expectWaiting(before);
  });

  test("pairs a transfer with the other side the family chooses", async () => {
    const target = (await readRows()).find((row) => row.text.includes("Could be the other side of a transfer"));
    if (target === undefined) throw new Error("No transfer candidate waiting");
    const before = await waiting();
    await keyTo(target.index);
    await openActions(target.who, say("needsYou.action.transfer"));
    const form = page.getByRole("dialog", { name: say("browse.transfer.title") });
    await expect(form.getByRole("radio").first()).toBeChecked();
    await form.getByRole("button", { name: say("browse.transfer.savePair") }).click();
    await expectWaiting(before - 2);
    await expect(status()).toContainText(say("needsYou.done.paired"));
    await page.keyboard.press("u");
    await expectWaiting(before);
  });

  test("marks a transfer whose other side isn't imported yet", async () => {
    const target = (await readRows()).find((row) => !row.moneyIn && !row.noPayee);
    if (target === undefined) throw new Error("No payment waiting");
    const before = await waiting();
    await keyTo(target.index);
    await openActions(target.who, say("needsYou.action.transfer"));
    const form = page.getByRole("dialog", { name: say("browse.transfer.title") });
    await form.getByRole("radio", { name: new RegExp(say("browse.transfer.notImported")) }).check();
    await form.getByRole("button", { name: say("browse.transfer.saveWaiting") }).click();
    await expectWaiting(before - 1);
    await page.keyboard.press("u");
    await expectWaiting(before);
  });

  test("N opens the import, and does nothing in a text field", async () => {
    const target = (await readRows())[0] as Row;
    await keyTo(0);
    await openActions(target.who, say("needsYou.action.addNote"));
    await page.keyboard.type("n");
    await expect(dialog()).toBeHidden();
    await page.keyboard.press("Escape");

    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("n");
    await expect(dialog()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });

  test("says why when core refuses a change, and changes nothing", async () => {
    await showTransactions();
    const before = await waiting();
    const first = (await readRows())[0] as Row;
    const gone = await facts((t) => {
      const waitingNow = (t["transactions"] ?? []).filter((x) => x.treatment.kind === "needsYou");
      const newest = [...waitingNow].sort((a, b) => (a.bookingDate === b.bookingDate ? (a.id < b.id ? -1 : 1) : a.bookingDate < b.bookingDate ? 1 : -1))[0];
      const batch = (t["importRows"] ?? []).find((r) => r.backs === newest.id);
      return { id: newest.id as string, batchId: batch.batchId as string };
    });
    await page.evaluate(async (batchId) => {
      await (window as unknown as { holt: { run(c: unknown): Promise<unknown> } }).holt.run({ kind: "undoImport", batchId });
    }, gone.batchId);

    expect(await selectedIndex()).toBe(0);
    await page.keyboard.press("e");
    await page.keyboard.type("food");
    await page.keyboard.press("Enter");
    await expect(alert()).toContainText(say("refusal.transactionNotFound"));
    await expectWaiting(before);
    await expect(selectedRow()).toHaveAttribute("aria-label", first.label);

    await page.evaluate(async () => {
      await (window as unknown as { holt: { historyStep(d: string): Promise<unknown> } }).holt.historyStep("undo");
    });
    await page.reload();
    await expect(rows().first()).toBeVisible();
    await expect(rows()).toHaveCount(Math.min(before, 50));
  });
});

// @axe-core/playwright opens a second page to finish a run, which Electron cannot do. Run axe-core itself in the page.
const axeSource = readFileSync(createRequire(createRequire(import.meta.url).resolve("@axe-core/playwright")).resolve("axe-core/axe.min.js"), "utf8");

interface AxeResult {
  violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[];
}

const themes = [
  { name: "Hearth light", theme: "hearth-light", glass: false },
  { name: "Hearth dark", theme: "hearth-dark", glass: false },
  { name: "Hearth dark with glass", theme: "hearth-dark", glass: true },
  { name: "Hearth light with glass", theme: "hearth-light", glass: true },
] as const;

test.describe("layout and accessibility of Needs you", () => {
  let app: HoltApp;
  let screen: Page;

  test.beforeAll(async () => {
    app = await launchHolt({ seed: true });
    screen = app.page;
    await screen.evaluate(() => {
      location.hash = "#/transactions";
    });
    await expect(screen.getByRole("list", { name: say("needsYou.list.label") }).getByRole("listitem").first()).toBeVisible();
  });
  test.afterAll(async () => {
    await app.close();
  });

  async function appearance(theme: string, glass: boolean): Promise<void> {
    await screen.evaluate(([t, g]) => localStorage.setItem("holt-appearance", JSON.stringify({ theme: t, glass: g })), [theme, glass] as const);
    await screen.reload();
    await expect(screen.getByRole("list", { name: say("needsYou.list.label") }).getByRole("listitem").first()).toBeVisible();
  }

  async function violations(): Promise<string[]> {
    await screen.evaluate(axeSource);
    const { violations: found } = await screen.evaluate<AxeResult>("axe.run(document)");
    return found.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.map(String).join(" ")).join(", ")}`);
  }

  for (const { name, theme, glass } of themes) {
    test(`axe finds no serious or critical violation in ${name}, with the actions open and with each dialog open`, async () => {
      await appearance(theme, glass);
      expect(await violations(), "the list").toEqual([]);

      await screen.keyboard.press("Enter");
      await expect(screen.getByRole("group", { name: /Actions for/ })).toBeVisible();
      expect(await violations(), "the actions").toEqual([]);
      await screen.keyboard.press("Escape");

      await screen.keyboard.press("e");
      await expect(screen.getByRole("dialog", { name: say("needsYou.job.title") })).toBeVisible();
      await screen.waitForFunction(() => document.querySelector("dialog")?.getAnimations().length === 0);
      expect(await violations(), "the job picker").toEqual([]);
      await screen.keyboard.press("Escape");
      await expect(screen.getByRole("dialog")).toBeHidden();

      const withPayee = await screen.getByRole("list", { name: say("needsYou.list.label") }).getByRole("listitem").evaluateAll((items, words) => items.findIndex((item) => !(item as HTMLElement).innerText.includes(words)), say("needsYou.why.noPayee"));
      for (let i = 0; i < withPayee; i += 1) await screen.keyboard.press("j");
      await screen.keyboard.press("Enter");
      await screen.getByRole("group", { name: /Actions for/ }).getByRole("button", { name: say("needsYou.action.always"), exact: true }).click();
      await expect(screen.getByRole("dialog", { name: say("needsYou.rule.title") })).toBeVisible();
      await screen.waitForFunction(() => document.querySelector("dialog")?.getAnimations().length === 0);
      expect(await violations(), "the rule dialog").toEqual([]);
      await screen.keyboard.press("Escape");
      await expect(screen.getByRole("dialog")).toBeHidden();
    });
  }

  for (const width of [1440, 1100, 900]) {
    test(`has no horizontal scroll at ${width} px, with the sidebar's badge in view`, async () => {
      await appearance("hearth-light", false);
      await app.setWidth(width);
      const overflow = await screen.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth, width: innerWidth }));
      expect(overflow).toEqual({ page: 0, body: 0, width });
      await expect(screen.getByRole("link", { name: say("nav.transactions") }).locator("span[data-kind]")).toBeVisible();
      await screen.keyboard.press("Enter");
      await expect(screen.getByRole("group", { name: /Actions for/ })).toBeVisible();
      const open = await screen.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, list: (() => { const list = document.querySelector("ul[aria-label]") as HTMLElement; return list.scrollWidth - list.clientWidth; })() }));
      expect(open).toEqual({ page: 0, list: 0 });
    });
  }

  test("with nothing waiting it opens on All, and the Needs you tab says nothing waits", async () => {
    await app.setWidth(1440);
    await appearance("hearth-light", false);
    await screen.evaluate(async () => {
      const holt = (window as unknown as { holt: { factsSnapshot(): Promise<{ value: { snapshot: { tables: { transactions: { id: string; amount: number; treatment: { kind: string } }[]; jobs: { id: string }[] } } } }>; run(c: unknown): Promise<unknown> } }).holt;
      const { tables } = (await holt.factsSnapshot()).value.snapshot;
      const job = tables.jobs[0]?.id;
      const commands = tables.transactions
        .filter((t) => t.treatment.kind === "needsYou")
        .map((t) => ({ kind: "setTreatment", transactionId: t.id, treatment: { kind: "split", allocations: [{ jobId: job, amount: t.amount }] } }));
      await holt.run({ kind: "batch", commands });
    });
    await screen.evaluate(() => {
      location.hash = "#/transactions";
    });
    await screen.reload();
    await expect(screen.getByRole("tab", { name: new RegExp(`^${say("tx.tab.all")}`) })).toHaveAttribute("aria-selected", "true");
    await screen.getByRole("tab", { name: new RegExp(`^${say("tx.tab.needsYou")}`) }).click();
    await expect(screen.getByText(say("needsYou.empty.title"), { exact: true })).toBeVisible();
    await expect(screen.getByText(say("needsYou.empty.body"), { exact: true })).toBeVisible();
    expect(await violations()).toEqual([]);
  });

  test("a screen with no household says Setup comes in a later version", async () => {
    const bare = await launchHolt();
    try {
      await bare.page.evaluate(() => {
        location.hash = "#/transactions";
      });
      await expect(bare.page.getByRole("heading", { level: 2, name: say("tx.empty.title") })).toBeVisible();
      await expect(bare.page.getByText(say("tx.empty.body"))).toBeVisible();
      await expect(bare.page.getByRole("button", { name: new RegExp(say("tx.import")) })).toHaveCount(0);
    } finally {
      await bare.close();
    }
  });
});
