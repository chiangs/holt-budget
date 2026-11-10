import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { messageFor } from "@holt/core";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { HoltBridge } from "../src/shared/bridge.ts";
import { type HoltApp, launchHolt } from "./launch.ts";
import { messages, say } from "./messages.ts";

/** The All tab on the synthetic household, grown to the family's volume (8,500 transactions and more). */

const themes = [
  { name: "Hearth light", theme: "hearth-light", glass: false },
  { name: "Hearth dark", theme: "hearth-dark", glass: false },
  { name: "Hearth light with glass", theme: "hearth-light", glass: true },
  { name: "Hearth dark with glass", theme: "hearth-dark", glass: true },
] as const;

const bulkTransactions = 8_500;
const batchSize = 500;

interface Row {
  id: string;
  accountId: string;
  bookingDate: string;
  amount: number;
  description: string;
  counterparty?: string;
  note?: string;
  treatment: { kind: string; partner?: string | null; allocations?: { jobId: string; amount: number }[]; fundsMonth?: string; jobId?: string | null };
}

let holt: HoltApp;
let page: Page;

test.describe.serial("the All tab (S3)", () => {
  test.beforeAll(async () => {
    holt = await launchHolt({ seed: true, pickFile: (folder) => join(folder, "sample-imports", "bulder-later.csv") });
    page = holt.page;
    await holt.emulate({});
    await holt.setWidth(1440, 1000);
    await grow();
    await showAll();
  });
  test.afterAll(async () => {
    await holt.close();
  });

  /** Adds the fixtures the tests look for, then enough other transactions to reach the family's volume, all through the same bridge the page uses. */
  async function grow(): Promise<void> {
    const made = await page.evaluate(
      async ({ total, size }) => {
        const api = (window as unknown as { holt: HoltBridge }).holt;
        const first = await api.factsSnapshot();
        if (!first.ok || first.value.kind !== "ready") throw new Error("No snapshot");
        const { snapshot } = first.value;
        const { accounts, jobs, household } = snapshot.tables;
        const planStart = household[0]!.planStart;
        const today = snapshot.today;
        const accountNamed = (name: string) => accounts.find((a) => a.name === name)!.id;
        const jobNamed = (name: string) => jobs.find((j) => j.name === name)!.id;
        const everyday = accountNamed("Everyday");
        const bills = accountNamed("Bills");
        const shared = accounts.filter((a) => a.scope === "shared").map((a) => a.id);
        const spend = jobs.filter((j) => j.status === "active" && j.kind === "spend").map((j) => j.id);
        const daysAgo = (n: number): string => {
          const d = new Date(`${today}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - n);
          return d.toISOString().slice(0, 10);
        };
        const monthBefore = (month: string): string => {
          const [year, number] = month.split("-").map(Number) as [number, number];
          return new Date(Date.UTC(year, number - 2, 15)).toISOString().slice(0, 10);
        };
        const uuid = (): string => crypto.randomUUID();
        const row = (fields: Omit<Row, "id">): Row => ({ id: uuid(), ...fields });

        const fixtures: Row[] = [
          row({ accountId: everyday, bookingDate: daysAgo(2), amount: -100_000, description: "Zeta test purchase alpha", counterparty: "Zeta Alpha", treatment: { kind: "needsYou" } }),
          row({ accountId: bills, bookingDate: daysAgo(2), amount: -270_300, description: "Zeta insurance invoice", counterparty: "Zeta Insurance", treatment: { kind: "needsYou" } }),
          row({ accountId: everyday, bookingDate: daysAgo(3), amount: -765_432, description: "Zeta moved out", counterparty: "Zeta Transfer out", treatment: { kind: "needsYou" } }),
          row({ accountId: bills, bookingDate: daysAgo(3), amount: 765_432, description: "Zeta moved in", counterparty: "Zeta Transfer in", treatment: { kind: "needsYou" } }),
          row({ accountId: everyday, bookingDate: daysAgo(1), amount: 24_900, description: "Zeta refund from shop", counterparty: "Zeta Refund", treatment: { kind: "needsYou" } }),
          row({ accountId: bills, bookingDate: daysAgo(1), amount: 3_000_000, description: "Zeta pay in", counterparty: "Zeta Pay", treatment: { kind: "needsYou" } }),
          row({ accountId: everyday, bookingDate: monthBefore(planStart), amount: -5_500, description: "Zeta old history", counterparty: "Zeta Old", treatment: { kind: "history", jobId: null } }),
        ];
        const bulk: Row[] = [];
        for (let i = 0; i < total; i += 1) {
          const when = new Date(`${planStart}-01T00:00:00Z`);
          when.setUTCDate(when.getUTCDate() + (i % 100));
          const amount = -((i * 37) % 90_000) - 100;
          const date = when.toISOString().slice(0, 10) > today ? daysAgo(i % 60) : when.toISOString().slice(0, 10);
          const treatment = i % 50 === 0 ? { kind: "needsYou" } : { kind: "split", allocations: [{ jobId: spend[i % spend.length]!, amount }] };
          bulk.push(row({ accountId: shared[i % shared.length]!, bookingDate: date, amount, description: `Card purchase ${i} SHOP NAME OSLO NOR`, counterparty: `Shop ${i % 300}`, treatment }));
        }
        const all = [...fixtures, ...bulk];
        for (let at = 0; at < all.length; at += size) {
          const commands = all.slice(at, at + size).map((transaction) => ({ kind: "recordTransaction" as const, transaction }));
          const result = await api.run({ kind: "batch", commands } as never);
          if (!result.ok || result.value.status !== "applied") throw new Error(`Batch at ${at}: ${JSON.stringify(result).slice(0, 300)}`);
        }
        return { added: all.length, jobFor: { electricity: jobNamed("Electricity") } };
      },
      { total: bulkTransactions, size: batchSize },
    );
    expect(made.added).toBeGreaterThan(bulkTransactions);
    await page.reload();
    await page.getByRole("heading", { level: 1 }).waitFor();
  }

  async function snapshotRows(): Promise<{ transactions: Row[]; importRows: { batchId: string; line: number; backs: string | null; id: string }[]; importBatches: { id: string; fileName: string; undone: boolean }[]; jobs: { id: string; name: string }[]; accounts: { id: string; name: string }[] }> {
    return page.evaluate(async () => {
      const reply = await (window as unknown as { holt: HoltBridge }).holt.factsSnapshot();
      if (!reply.ok || reply.value.kind !== "ready") throw new Error("No snapshot");
      const { tables } = reply.value.snapshot;
      return { transactions: tables.transactions, importRows: tables.importRows, importBatches: tables.importBatches, jobs: tables.jobs, accounts: tables.accounts } as never;
    });
  }
  const transactionBy = async (description: string): Promise<Row> => {
    const found = (await snapshotRows()).transactions.find((t) => t.description === description);
    if (found === undefined) throw new Error(`No transaction "${description}"`);
    return found;
  };

  /**
   * A click that skips Playwright's wait for the element to stand still. That wait needs animation frames, and the
   * headless compositor on this machine sometimes delivers none for seconds at a time. Nothing here animates.
   */
  const tap = (locator: Locator) => locator.click({ force: true });

  const list = (): Locator => page.getByRole("listbox", { name: say("browse.list.label") });
  const options = (): Locator => list().getByRole("option");
  const search = (): Locator => page.getByRole("searchbox", { name: say("browse.filter.searchLabel") });
  const detail = (): Locator => page.getByTestId("transaction-detail");
  const notice = (): Locator => page.locator('[role="status"], [role="alert"]').filter({ hasText: /^(You |The |Nobody)/ });
  const countLine = (): Locator => page.locator('p[role="status"][aria-busy]');

  async function showAll(): Promise<void> {
    await page.evaluate(() => {
      location.hash = "#/transactions?tab=all";
    });
    await expect(options().first()).toBeVisible();
  }

  /**
   * A transaction that shares its counterparty with others and is not first among them, so opening it by its own
   * row shows a detail panel that could easily belong to a neighbour. Returns the text to search and the row.
   */
  function amongNeighbours(all: readonly Row[], wanted: (t: Row) => boolean): { text: string; target: Row; position: number } {
    for (const target of all) {
      const text = target.counterparty;
      if (text === undefined || !wanted(target)) continue;
      const matches = all
        .filter((t) => `${t.description} ${t.counterparty ?? ""}`.toLowerCase().includes(text.toLowerCase()))
        .sort((a, b) => (a.bookingDate === b.bookingDate ? (a.id < b.id ? -1 : 1) : a.bookingDate < b.bookingDate ? 1 : -1));
      const position = matches.findIndex((t) => t.id === target.id);
      if (position >= 1 && position <= 12) return { text, target, position };
    }
    throw new Error("No transaction fits");
  }

  async function openAmongNeighbours(text: string, target: Row, position: number): Promise<void> {
    await search().fill(text);
    const row = page.locator(`[role="option"][data-transaction="${target.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("aria-posinset", String(position + 1));
    await tap(row);
    await expect(detail()).toBeVisible();
    await expect(detail().getByRole("heading", { level: 2 })).toHaveText(target.counterparty ?? target.description);
  }

  async function openRow(description: string): Promise<void> {
    await search().fill(description);
    const row = options().filter({ hasText: description }).first();
    await expect(row).toBeVisible();
    await tap(row);
    await expect(detail()).toBeVisible();
    await expect(detail().getByRole("heading", { level: 2 })).toBeVisible();
  }

  const dialog = (): Locator => page.getByRole("dialog");
  const action = (id: string): Locator => detail().getByRole("button", { name: say(id), exact: true });

  async function chooseJobInPicker(name: string): Promise<void> {
    const picker = dialog();
    await expect(picker).toBeVisible();
    await picker.getByRole("combobox").fill(name);
    await tap(picker.getByRole("option", { name, exact: true }));
    await expect(picker).toBeHidden();
  }

  test("the All count equals the number of transactions", async () => {
    const { transactions } = await snapshotRows();
    expect(transactions.length).toBeGreaterThan(8_500);
    await expect(countLine()).toHaveText(`${transactions.length.toLocaleString("en-GB")} transactions`);
  });

  test("typing in search narrows the list and clearing it restores it", async () => {
    const { transactions } = await snapshotRows();
    const all = `${transactions.length.toLocaleString("en-GB")} transactions`;
    await search().fill("zeta");
    const zeta = transactions.filter((t) => `${t.description} ${t.counterparty ?? ""}`.toLowerCase().includes("zeta")).length;
    await expect(countLine()).toHaveText(`Showing ${zeta} of ${all}`);
    expect(await options().count()).toBe(zeta);
    await search().fill("");
    await expect(countLine()).toHaveText(all);
    await search().fill("1 000");
    await expect(countLine()).toContainText("Showing");
    await tap(page.getByRole("button", { name: say("browse.filter.clear") }));
    await expect(countLine()).toHaveText(all);
    await expect(search()).toHaveValue("");
  });

  test("filters narrow by account, kind, month and rule, and combine", async () => {
    const { transactions, accounts } = await snapshotRows();
    const everyday = accounts.find((a) => a.name === "Everyday")!;
    await page.getByLabel(say("browse.filter.account"), { exact: true }).selectOption({ label: "Everyday" });
    const expected = transactions.filter((t) => t.accountId === everyday.id).length;
    await expect(countLine()).toContainText(`Showing ${expected.toLocaleString("en-GB")} of`);
    await page.getByLabel(say("browse.filter.treatment"), { exact: true }).selectOption({ value: "needsYou" });
    const waiting = transactions.filter((t) => t.accountId === everyday.id && t.treatment.kind === "needsYou").length;
    await expect(countLine()).toContainText(`Showing ${waiting.toLocaleString("en-GB")} of`);
    await tap(page.getByRole("button", { name: say("browse.filter.clear") }));
    await expect(countLine()).not.toContainText("Showing");
  });

  test("the list scrolls through every row without rendering them", async () => {
    const { transactions } = await snapshotRows();
    expect(await options().count()).toBeLessThanOrEqual(40);
    const scrollTo = (fraction: number) =>
      list().evaluate((el, f) => {
        el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
        el.dispatchEvent(new Event("scroll"));
      }, fraction);
    for (const fraction of [0.25, 0.5, 0.9, 1]) {
      await scrollTo(fraction);
      await expect.poll(async () => options().count()).toBeGreaterThan(5);
      expect(await options().count()).toBeLessThanOrEqual(40);
      expect(await page.locator('[role="option"][data-transaction]').count()).toBeLessThanOrEqual(40);
    }
    await expect(options().last()).toHaveAttribute("aria-posinset", String(transactions.length));
    await scrollTo(0);
    await expect(options().first()).toHaveAttribute("aria-posinset", "1");
  });

  test("the first window of 8,500 transactions renders quickly (measured)", async () => {
    await page.evaluate(() => {
      location.hash = "#/transactions?tab=imports";
    });
    await expect(options()).toHaveCount(0);
    const tab = page.getByRole("tab", { name: /^All/ });
    const { dom, paint } = await tab.evaluate(
      (element) =>
        new Promise<{ dom: number; paint: number }>((resolve) => {
          const started = performance.now();
          const done = (): void => {
            if (document.querySelector('[role="option"][data-transaction]') === null) return;
            observer.disconnect();
            const dom = performance.now() - started;
            requestAnimationFrame(() => resolve({ dom, paint: performance.now() - started }));
          };
          const observer = new MutationObserver(done);
          observer.observe(document.body, { childList: true, subtree: true });
          (element as HTMLElement).click();
        }),
    );
    console.log(`first window of the All tab: rows in the page after ${dom.toFixed(1)} ms, first painted frame after ${paint.toFixed(1)} ms (from the click)`);
    expect(paint).toBeLessThan(2_000);
    await expect(options().first()).toBeVisible();
  });

  test("J and K move the highlight, Enter opens the detail beside the list, Esc closes it", async () => {
    await list().focus();
    await page.keyboard.press("j");
    const first = options().first();
    await expect(list()).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    const second = options().nth(1);
    await expect(list()).toHaveAttribute("aria-activedescendant", (await second.getAttribute("id"))!);
    await expect(detail()).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(detail()).toBeVisible();
    await expect(second).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("j");
    await expect(options().nth(2)).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(detail()).toBeHidden();
    await page.keyboard.press("End");
    await expect(options().last()).toHaveAttribute("aria-posinset", /\d+/);
    await page.keyboard.press("Home");
    await expect(options().first()).toHaveAttribute("aria-posinset", "1");
  });

  test("/ goes to the search box, and typing letters there does not leave the screen", async () => {
    await list().focus();
    await page.keyboard.press("/");
    await expect(search()).toBeFocused();
    await page.keyboard.type("tpra");
    await expect(search()).toHaveValue("tpra");
    expect(await page.evaluate(() => location.hash)).toContain("/transactions");
    await search().fill("");
  });

  test("opens a transaction's detail and shows where it came from, file and line", async () => {
    const { transactions, importRows, importBatches } = await snapshotRows();
    const live = (batchId: string) => importBatches.find((b) => b.id === batchId && !b.undone) !== undefined;
    const { text, target, position } = amongNeighbours(transactions, (t) => importRows.some((r) => r.backs === t.id && live(r.batchId)));
    const expected = importRows.filter((r) => r.backs === target.id && live(r.batchId)).map((r) => `${importBatches.find((b) => b.id === r.batchId)!.fileName}, line ${r.line}`);
    await openAmongNeighbours(text, target, position);
    const sources = detail().locator("li[data-source]");
    await expect(sources).toHaveCount(expected.length);
    const shown = await sources.allTextContents();
    for (const source of expected) expect(shown.join(" | ")).toContain(source);
    await expect(detail().getByText(target.description, { exact: true }).first()).toBeVisible();
    for (const label of ["browse.detail.bank", "browse.detail.booked", "browse.detail.account", "browse.detail.decided", "browse.detail.source"]) await expect(detail()).toContainText(say(label));
    await search().fill("");
  });

  test("shows several sources when files overlap", async () => {
    const overlap = await page.evaluate(async () => {
      const api = (window as unknown as { holt: HoltBridge }).holt;
      const opened = await api.importOpen();
      if (!opened.ok || opened.value.kind !== "opened") return null;
      const added = await api.importCommit(opened.value.session, { balances: [], choices: [], suggest: true });
      return added.ok && added.value.status === "applied";
    });
    expect(overlap).toBe(true);
    await page.reload();
    await showAll();
    const { transactions, importRows, importBatches } = await snapshotRows();
    const live = (batchId: string) => importBatches.find((b) => b.id === batchId && !b.undone) !== undefined;
    const counts = new Map<string, number>();
    for (const row of importRows) if (row.backs !== null && live(row.batchId)) counts.set(row.backs, (counts.get(row.backs) ?? 0) + 1);
    const { text, target, position } = amongNeighbours(transactions, (t) => (counts.get(t.id) ?? 0) >= 2);
    const backing = importRows.filter((r) => r.backs === target.id && live(r.batchId));
    expect(new Set(backing.map((r) => r.batchId)).size).toBeGreaterThanOrEqual(2);
    await openAmongNeighbours(text, target, position);
    const lines = detail().locator("li[data-source]");
    await expect(lines).toHaveCount(backing.length);
    const shown = (await lines.allTextContents()).join(" | ");
    for (const row of backing) expect(shown).toContain(`${importBatches.find((b) => b.id === row.batchId)!.fileName}, line ${row.line}`);
    await search().fill("");
  });

  test("changes the job of a transaction, and Undo puts it back", async () => {
    const before = await transactionBy("Zeta test purchase alpha");
    expect(before.treatment.kind).toBe("needsYou");
    await openRow("Zeta test purchase alpha");
    await expect(detail()).toContainText(say("browse.treatment.needsYou"));
    await tap(action("browse.action.chooseJob"));
    await chooseJobInPicker("Electricity");
    const { jobs } = await snapshotRows();
    const electricity = jobs.find((j) => j.name === "Electricity")!;
    const after = await transactionBy("Zeta test purchase alpha");
    expect(after.treatment).toMatchObject({ kind: "split", allocations: [{ jobId: electricity.id, amount: -100_000 }] });
    await expect(detail()).toContainText("Electricity");
    await expect(notice().filter({ hasText: "You gave Zeta Alpha the job Electricity." })).toBeVisible();
    await expect(action("browse.action.changeJob")).toBeFocused();

    await tap(page.getByRole("button", { name: say("browse.notice.undo"), exact: true }));
    await expect(notice().filter({ hasText: say("browse.notice.undone") })).toBeVisible();
    expect((await transactionBy("Zeta test purchase alpha")).treatment.kind).toBe("needsYou");
    await expect(detail()).toContainText(say("browse.treatment.needsYou"));
  });

  test("splits a transaction, and Save stays off until the rows add up to the whole amount", async () => {
    await openRow("Zeta insurance invoice");
    await tap(action("browse.action.split"));
    const split = dialog();
    await expect(split).toBeVisible();
    await expect(split).toContainText("Zeta Insurance");
    const save = split.getByRole("button", { name: say("browse.split.save") });
    await expect(save).toBeDisabled();

    await split.getByLabel("Job for row 1").selectOption({ label: "House insurance" });
    await split.getByLabel("Amount for row 1").fill("2000");
    await split.getByLabel("Job for row 2").selectOption({ label: "Car insurance" });
    await split.getByLabel("Amount for row 2").fill("702.99");
    await expect(split.getByRole("status")).toContainText("Left to assign: 0.01 kr");
    await expect(save).toBeDisabled();
    await split.getByLabel("Amount for row 2").fill("703.01");
    await expect(split.getByRole("status")).toContainText("Over by 0.01 kr");
    await expect(save).toBeDisabled();

    await split.getByLabel("Amount for row 2").fill("");
    await tap(split.getByRole("button", { name: say("browse.split.rest") + " to row 2", exact: false }));
    await expect(split.getByLabel("Amount for row 2")).toHaveValue("703");
    await expect(split.getByRole("status")).toContainText(say("browse.split.done"));
    await expect(save).toBeEnabled();
    await tap(save);
    await expect(split).toBeHidden();

    const { jobs } = await snapshotRows();
    const house = jobs.find((j) => j.name === "House insurance")!;
    const car = jobs.find((j) => j.name === "Car insurance")!;
    const after = await transactionBy("Zeta insurance invoice");
    expect(after.treatment).toMatchObject({ kind: "split", allocations: [{ jobId: house.id, amount: -200_000 }, { jobId: car.id, amount: -70_300 }] });
    await expect(detail()).toContainText("Split across 2 jobs");
    await expect(notice().filter({ hasText: "You split Zeta Insurance across 2 jobs." })).toBeVisible();
    await expect(page.locator(":focus")).toHaveAccessibleName(say("browse.action.changeSplit"));
  });

  test("Enter on an amount adds the next row, and Esc closes the editor and gives focus back", async () => {
    await openRow("Zeta insurance invoice");
    const opener = action("browse.action.changeSplit");
    await tap(opener);
    const split = dialog();
    await expect(split.getByLabel(/^Job for row/)).toHaveCount(2);
    await split.getByLabel("Amount for row 2").fill("600");
    await split.getByLabel("Amount for row 2").press("Enter");
    await expect(split.getByLabel(/^Job for row/)).toHaveCount(3);
    await expect(split.getByLabel("Job for row 3")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(split).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("a letter pressed inside a dialog does not leave the screen", async () => {
    await tap(opener());
    await expect(dialog()).toBeVisible();
    await dialog().getByRole("button", { name: say("browse.split.cancel") }).focus();
    await page.keyboard.press("p");
    await page.keyboard.press("t");
    expect(await page.evaluate(() => location.hash)).toContain("/transactions");
    await expect(dialog()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();

    function opener(): Locator {
      return action("browse.action.changeSplit");
    }
  });

  test("marks a transfer, pairs it with the other side, and says it will not move money", async () => {
    await openRow("Zeta moved out");
    await tap(action("browse.action.transfer"));
    const pair = dialog();
    await expect(pair).toBeVisible();
    await expect(pair).toContainText("Holt never moves money");
    const radios = pair.getByRole("radio");
    await expect(radios).toHaveCount(2);
    await expect(radios.first()).toBeChecked();
    await expect(pair.getByText("Bills", { exact: true })).toBeVisible();
    await expect(pair.getByText(say("browse.transfer.notImported"))).toBeVisible();
    await tap(pair.getByRole("button", { name: say("browse.transfer.savePair") }));
    await expect(pair).toBeHidden();

    const out = await transactionBy("Zeta moved out");
    const incoming = await transactionBy("Zeta moved in");
    expect(out.treatment).toEqual({ kind: "transfer", partner: incoming.id });
    expect(incoming.treatment).toEqual({ kind: "transfer", partner: out.id });
    await expect(detail()).toContainText("Transfer to Bills");
    await expect(notice().filter({ hasText: "You paired Zeta Transfer out with a transfer in Bills." })).toBeVisible();
    await expect(page.locator(":focus")).toHaveAccessibleName(say("browse.action.changePartner"));
  });

  test("a transfer with no candidate says so and offers only the other-side choice", async () => {
    await openRow("Zeta test purchase alpha");
    await tap(action("browse.action.transfer"));
    const pair = dialog();
    await expect(pair).toContainText(say("browse.transfer.none"));
    await expect(pair.getByRole("radio")).toHaveCount(1);
    await expect(pair.getByRole("radio")).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(pair).toBeHidden();
    expect((await transactionBy("Zeta test purchase alpha")).treatment.kind).toBe("needsYou");
  });

  test("marks money in as a refund against a job (a split, not income) and as income for a month", async () => {
    await openRow("Zeta refund from shop");
    await expect(action("browse.action.refund")).toBeVisible();
    await tap(action("browse.action.refund"));
    await chooseJobInPicker("Eating out");
    const { jobs } = await snapshotRows();
    const refund = await transactionBy("Zeta refund from shop");
    expect(refund.treatment).toMatchObject({ kind: "split", allocations: [{ jobId: jobs.find((j) => j.name === "Eating out")!.id, amount: 24_900 }] });
    await expect(detail()).toContainText("Refund against Eating out");

    await openRow("Zeta pay in");
    await tap(action("browse.action.income"));
    const income = dialog();
    await expect(income).toBeVisible();
    await tap(income.getByRole("button", { name: say("browse.income.save") }));
    await expect(income).toBeHidden();
    const pay = await transactionBy("Zeta pay in");
    expect(pay.treatment.kind).toBe("income");
    await expect(detail()).toContainText("Income for");
  });

  test("offers no refund or income for money out", async () => {
    await openRow("Zeta test purchase alpha");
    await expect(action("browse.action.refund")).toHaveCount(0);
    await expect(action("browse.action.income")).toHaveCount(0);
  });

  test("shows core's refusal in words for a history transaction, and changes nothing", async () => {
    const before = await transactionBy("Zeta old history");
    await openRow("Zeta old history");
    await expect(detail()).toContainText(say("browse.treatment.history"));
    await tap(action("browse.action.chooseJob"));
    await chooseJobInPicker("Electricity");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    const wanted = messages["refusal.notHistoryBeforePlanStart"] ?? messageFor("notHistoryBeforePlanStart");
    await expect(alert).toContainText(wanted);
    expect(await transactionBy("Zeta old history")).toEqual(before);
  });

  test("marks a decided transaction as needing you again, and marks an old one as history", async () => {
    await openRow("Zeta insurance invoice");
    await tap(action("browse.action.needsYou"));
    await expect(detail()).toContainText(say("browse.treatment.needsYou"));
    expect((await transactionBy("Zeta insurance invoice")).treatment.kind).toBe("needsYou");
    await tap(action("browse.action.history"));
    await expect(page.getByRole("alert")).toContainText(messages["refusal.historyFromPlanStart"] ?? messageFor("historyFromPlanStart"));
    expect((await transactionBy("Zeta insurance invoice")).treatment.kind).toBe("needsYou");
  });

  test("adds a note, edits it, removes it, and Undo takes the last change back", async () => {
    await openRow("Zeta test purchase alpha");
    const field = detail().getByRole("textbox", { name: say("browse.detail.note") });
    const save = detail().getByRole("button", { name: say("browse.detail.saveNote") });
    await expect(save).toBeDisabled();
    await tap(action("browse.action.addNote"));
    await expect(field).toBeFocused();
    await field.fill("  Paid for the neighbour  ");
    await tap(save);
    await expect(notice().filter({ hasText: "You saved a note on Zeta Alpha." })).toBeVisible();
    expect((await transactionBy("Zeta test purchase alpha")).note).toBe("Paid for the neighbour");
    await expect(field).toHaveValue("Paid for the neighbour");

    await search().fill("neighbour");
    await expect(options()).toHaveCount(1);
    await search().fill("Zeta test purchase alpha");

    await field.fill("");
    await tap(detail().getByRole("button", { name: say("browse.detail.removeNote") }));
    expect((await transactionBy("Zeta test purchase alpha")).note).toBeUndefined();
    await tap(page.getByRole("button", { name: say("browse.notice.undo"), exact: true }));
    expect((await transactionBy("Zeta test purchase alpha")).note).toBe("Paid for the neighbour");
    await expect(field).toHaveValue("Paid for the neighbour");
  });

  test("the bridge's own undo reverses what the tab did (window.holt.historyStep)", async () => {
    await openRow("Zeta test purchase alpha");
    await tap(action("browse.action.editNote"));
    await detail().getByRole("textbox", { name: say("browse.detail.note") }).fill("A second note");
    await tap(detail().getByRole("button", { name: say("browse.detail.saveNote") }));
    await expect(notice().filter({ hasText: "You saved a note" })).toBeVisible();
    expect((await transactionBy("Zeta test purchase alpha")).note).toBe("A second note");
    const undone = await page.evaluate(() => (window as unknown as { holt: HoltBridge }).holt.historyStep("undo"));
    expect(undone).toMatchObject({ ok: true, value: { status: "applied" } });
    expect((await transactionBy("Zeta test purchase alpha")).note).toBe("Paid for the neighbour");
    await page.evaluate(() => (window as unknown as { holt: HoltBridge }).holt.historyStep("redo"));
  });

  test("a rule that applied is marked on the row and named in the detail", async () => {
    const { transactions } = await snapshotRows();
    const ruled = transactions.find((t) => (t as unknown as { ruleId?: string }).ruleId !== undefined);
    expect(ruled, "the seed's imports apply its rules").toBeDefined();
    await openRow(ruled!.description);
    await expect(detail()).toContainText(/rule/i);
    await expect(options().first().getByText(say("browse.list.rule"))).toBeAttached();
    await search().fill("");
    await page.getByLabel(say("browse.filter.rule"), { exact: true }).selectOption({ value: "applied" });
    const applied = transactions.filter((t) => (t as unknown as { ruleId?: string }).ruleId !== undefined).length;
    await expect(countLine()).toContainText(`Showing ${applied.toLocaleString("en-GB")} of`);
    await tap(page.getByRole("button", { name: say("browse.filter.clear") }));
  });

  // @axe-core/playwright opens a second page to finish a run, which Electron cannot do. Run axe-core itself in the page.
  const axeSource = readFileSync(createRequire(createRequire(import.meta.url).resolve("@axe-core/playwright")).resolve("axe-core/axe.min.js"), "utf8");

  interface AxeResult {
    violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[];
  }

  test.describe("accessibility and layout", () => {
  async function appearance(theme: string, glass: boolean): Promise<void> {
    await page.evaluate(([t, g]) => localStorage.setItem("holt-appearance", JSON.stringify({ theme: t, glass: g })), [theme, glass] as const);
    await page.reload();
    await page.evaluate(() => {
      location.hash = "#/transactions?tab=all";
    });
    await expect(page.getByRole("listbox", { name: say("browse.list.label") }).getByRole("option").first()).toBeVisible();
  }

  async function violations(): Promise<string[]> {
    await page.evaluate(axeSource);
    const { violations: found } = await page.evaluate<AxeResult>("axe.run(document)");
    return found.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.map(String).join(" ")).join(", ")}`);
  }

  for (const { name, theme, glass } of themes) {
    test(`axe finds no serious or critical violation with the list and the detail open in ${name}`, async () => {
      await appearance(theme, glass);
      expect(await violations(), "the list").toEqual([]);
      await tap(page.getByRole("listbox", { name: say("browse.list.label") }).getByRole("option").nth(1));
      await expect(page.getByTestId("transaction-detail")).toBeVisible();
      expect(await violations(), "the list with the detail open").toEqual([]);
    });

    test(`axe finds no serious or critical violation with a dialog open in ${name}`, async () => {
      await appearance(theme, glass);
      await tap(page.getByRole("listbox", { name: say("browse.list.label") }).getByRole("option").nth(1));
      const detail = page.getByTestId("transaction-detail");
      await tap(detail.getByRole("button", { name: say("browse.action.split"), exact: true }));
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").locator('input[inputmode="decimal"]').first().fill("12x");
      expect(await violations(), "the split editor").toEqual([]);
      await page.keyboard.press("Escape");
      await tap(detail.getByRole("button", { name: say("browse.action.transfer"), exact: true }));
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await violations(), "the transfer dialog").toEqual([]);
      await page.keyboard.press("Escape");
    });
  }

  for (const width of [900, 1100, 1440]) {
    test(`has no horizontal scroll at ${width} px, with the detail open`, async () => {
      await appearance("hearth-light", false);
      await holt.setWidth(width, 900);
      const options = page.getByRole("listbox", { name: say("browse.list.label") }).getByRole("option");
      await tap(options.nth(1));
      await expect(page.getByTestId("transaction-detail")).toBeVisible();
      const overflow = () => page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
      expect(await overflow()).toEqual({ page: 0, body: 0 });
      const widest = await page.evaluate(() => {
        const box = document.querySelector('[role="listbox"]')!.getBoundingClientRect();
        const detail = document.querySelector('[data-testid="transaction-detail"]')!.getBoundingClientRect();
        return { list: box.width, detail: detail.width, right: Math.max(box.right, detail.right), viewport: window.innerWidth };
      });
      expect(widest.right).toBeLessThanOrEqual(widest.viewport);
      expect(widest.list).toBeGreaterThan(300);
      await tap(page.getByRole("button", { name: say("browse.detail.close") }));
      expect(await overflow()).toEqual({ page: 0, body: 0 });
      await holt.setWidth(1440, 1000);
    });
  }
});

  test("screenshots of the tab, for review (set HOLT_SHOTS to a folder to take them)", async () => {
    const folder = process.env["HOLT_SHOTS"];
    test.skip(folder === undefined, "Set HOLT_SHOTS to take screenshots");
    const shot = (name: string) => page.screenshot({ path: join(folder!, `${name}.png`) });
    const appearanceOf = async (theme: string, glass: boolean) => {
      await page.evaluate(([t, g]) => localStorage.setItem("holt-appearance", JSON.stringify({ theme: t, glass: g })), [theme, glass] as const);
      await page.reload();
      await showAll();
    };
    for (const [theme, glass, label] of [["hearth-light", false, "light"], ["hearth-dark", false, "dark"], ["hearth-light", true, "light-glass"], ["hearth-dark", true, "dark-glass"]] as const) {
      await appearanceOf(theme, glass);
      for (const width of [900, 1100, 1440]) {
        await holt.setWidth(width, 1000);
        await shot(`${label}-${width}-list`);
        await search().fill("Zeta insurance invoice");
        await tap(options().first());
        await expect(detail()).toBeVisible();
        await shot(`${label}-${width}-detail`);
        if (width === 1440 || width === 900) {
          await tap(action("browse.action.split"));
          await page.getByRole("dialog").locator('input[inputmode="decimal"]').first().fill("12x");
          await shot(`${label}-${width}-split`);
          await page.keyboard.press("Escape");
          await tap(action("browse.action.transfer"));
          await shot(`${label}-${width}-transfer`);
          await page.keyboard.press("Escape");
        }
        await search().fill("");
        await tap(page.getByRole("button", { name: say("browse.detail.close") }));
      }
    }
    await appearanceOf("hearth-light", false);
    await holt.setWidth(1440, 1000);
    await search().fill("Zeta moved out");
    await options().first().click();
    await action("browse.action.changePartner").click();
    await shot("light-1440-partner");
    await page.keyboard.press("Escape");
    await search().fill("Zeta pay in");
    await options().first().click();
    await action("browse.action.changeIncome").click();
    await shot("light-1440-income");
    await page.keyboard.press("Escape");
    await tap(detail().getByRole("button", { name: say("browse.action.history") }));
    await expect(page.getByRole("alert")).toBeVisible();
    await shot("light-1440-notice");
  });
});
