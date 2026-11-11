import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import type { HoltBridge } from "../src/shared/bridge.ts";
import { type HoltApp, launchHolt } from "./launch.ts";
import { say } from "./messages.ts";

/**
 * Milestone 3, the import screens, on the synthetic household. The file picker returns the overlapping Bulder file the
 * seed leaves un-imported. Small synthetic files for the failures are written next to it, and the picked file is changed
 * from the main process between steps.
 */

const importedFile = "bulder-later.csv";

let holt: HoltApp;
let page: Page;
let samples: string;

const bridge = () => page.evaluate(() => (window as unknown as { holt: HoltBridge }).holt.factsSnapshot());

interface Counts {
  transactions: number;
  needsYou: number;
  liveBatches: number;
  batches: number;
  enteredBalances: number;
}

async function counts(): Promise<Counts> {
  const reply = await bridge();
  if (!reply.ok || reply.value.kind !== "ready") throw new Error("Expected a ready snapshot");
  const { tables } = reply.value.snapshot;
  return {
    transactions: tables.transactions.length,
    needsYou: tables.transactions.filter((t) => t.treatment.kind === "needsYou").length,
    liveBatches: tables.importBatches.filter((b) => !b.undone).length,
    batches: tables.importBatches.length,
    enteredBalances: tables.enteredValues.filter((v) => v.kind === "accountBalance").length,
  };
}

async function pick(file: string): Promise<void> {
  await holt.app.evaluate((_electron, path) => {
    process.env["HOLT_E2E_PICK_FILE"] = path;
  }, join(samples, file));
}

const heading = () => page.getByRole("heading", { level: 1 });
const dialog = () => page.getByRole("dialog").last();
const importButton = () => page.getByRole("button", { name: say("tx.import"), exact: true });
const tab = (id: "needsYou" | "all" | "imports") => page.getByRole("tab", { name: new RegExp(`^${say(`tx.tab.${id}`)}`) });
const chips = () => page.getByRole("list", { name: say("import.chips.label") }).getByRole("listitem");
const addButton = () => dialog().getByRole("button", { name: /^Add (the file|\d+ transactions?)$/ });

async function chipNumber(pattern: RegExp): Promise<number> {
  const text = await chips().filter({ hasText: pattern }).first().innerText();
  return Number(/\d+/.exec(text)?.[0]);
}

async function show(path: string): Promise<void> {
  await page.evaluate((to) => {
    location.hash = `#${to}`;
  }, path);
  await expect(heading()).toHaveText(say("screen.transactions.title"));
  await expect(importButton()).toBeVisible();
}

async function openImport(): Promise<void> {
  await page.keyboard.press("n");
  await expect(dialog()).toBeVisible();
}

async function openPreview(): Promise<void> {
  await pick(importedFile);
  await openImport();
  await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
}

/** The amount field, not the date field beside it, whose name also contains the amount field's. */
const balanceField = (account: string) => dialog().getByRole("textbox", { name: `Balance your bank shows for ${account}`, exact: true });
/** The block for one account in the balances section. The inner locator is queried from each list item, so it starts at the page. */
const accountBlock = (account: string) => dialog().getByRole("listitem").filter({ has: page.getByRole("textbox", { name: `Balance your bank shows for ${account}`, exact: true }) });

/** Remembers what has focus now, so a test can say that focus came back to it. */
async function rememberFocus() {
  const element = await page.evaluateHandle(() => document.activeElement);
  return {
    isBack: () => expect.poll(() => page.evaluate((remembered) => document.activeElement === remembered, element)).toBe(true),
  };
}

const accountStates = () =>
  page.locator("li[data-state]").evaluateAll((items) => Object.fromEntries(items.map((li) => [li.querySelector("h3")?.textContent ?? "", li.getAttribute("data-state")])));

/**
 * How many days before today Everyday's newest transaction was booked, and its import rhythm. Everyday is imported weekly
 * and the synthetic files write its rows on fixed days of the month, so whether it is up to date after an import depends
 * on the date. The screen has to agree with the facts either way.
 */
async function everydayCover(): Promise<{ days: number; rhythm: string | undefined }> {
  const reply = await bridge();
  if (!reply.ok || reply.value.kind !== "ready") throw new Error("Expected a ready snapshot");
  const { tables, today } = reply.value.snapshot;
  const everyday = tables.accounts.find((a) => a.name === "Everyday");
  const newest = tables.transactions.filter((t) => t.accountId === everyday?.id).map((t) => t.bookingDate).sort().at(-1) ?? "";
  return { days: Math.round((Date.parse(today) - Date.parse(newest)) / 86_400_000), rhythm: everyday?.importRhythm };
}

test.describe.serial("importing a bank file on the synthetic household", () => {
  test.beforeAll(async () => {
    holt = await launchHolt({ seed: true, pickFile: (folder) => join(folder, "sample-imports", importedFile) });
    page = holt.page;
    samples = join(holt.dataFolder, "sample-imports");
    mkdirSync(samples, { recursive: true });
    const eur = readFileSync(join(import.meta.dirname, "../../../packages/importers/fixtures/synthetic/statement-1x.ofx"), "utf8").replace("<CURDEF>NOK", "<CURDEF>EUR");
    writeFileSync(join(samples, "euro.ofx"), eur);
    // The same synthetic OFX file, for the household's Everyday account (the fixture's own account is not in the household).
    writeFileSync(join(samples, "known.ofx"), eur.replace("<CURDEF>EUR", "<CURDEF>NOK").replace("97600060001", "97101110001"));
    writeFileSync(join(samples, "notes.txt"), "These are my notes, not a bank file.\n");
    const header = readFileSync(join(samples, importedFile), "utf8").split("\n")[0];
    const known = "2026-11-05;-70,00;-70,00;NOK;;Kiosk;Mat;9710.11.10003;Betaling;Kiosk;;Mat;Dagligvarer";
    const stranger = "2026-11-05;-50,00;-50,00;NOK;;Kiosk;Ferie;9999.99.99999;Betaling;Kiosk;;Mat;Dagligvarer";
    writeFileSync(join(samples, "some-strangers.csv"), `${header}\n${known}\n${stranger}\n`);
    writeFileSync(join(samples, "only-strangers.csv"), `${header}\n${stranger}\n`);
    writeFileSync(join(samples, "broken.csv"), `${header}\n2026-10-01;-774,14;-774,14;NOK;;Torgkafeen;Mat;9710.11.10003;Betaling;Torgkafeen;;Mat;Dagligvarer\n2026-10-0x;-12,00;-12,00;NOK;;Kiosk;Mat;9710.11.10003;Betaling;Kiosk;;Mat;Dagligvarer\n`);
    await holt.setWidth(1440, 1100);
    await show("/transactions");
  });
  test.afterAll(async () => {
    await holt.close();
  });
  test.beforeEach(async () => {
    await holt.emulate({});
    await holt.setWidth(1440, 1100);
  });

  const before: { counts: Counts; added: Counts; states: Record<string, string | null>; everydayDays: number; needsYouChip: number; created: number; skipped: number; line: number; balance: string } = {
    counts: undefined as never,
    added: undefined as never,
    states: {},
    everydayDays: 0,
    needsYouChip: 0,
    created: 0,
    skipped: 0,
    line: 0,
    balance: "",
  };

  test("N opens the dialog, which reads the file and shows what it found, with the duplicates it skipped", async () => {
    before.counts = await counts();
    before.states = await accountStates();
    before.everydayDays = (await everydayCover()).days;
    expect(before.states["Everyday"]).toBe("due");

    await pick(importedFile);
    await page.keyboard.press("n");
    await expect(dialog()).toBeVisible();
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
    await expect(dialog().getByText(new RegExp(`^${importedFile} · the app read it as a Bulder export$`))).toBeVisible();

    const rows = await chipNumber(/rows?$/);
    before.created = await chipNumber(/new$/);
    before.skipped = await chipNumber(/^The app skipped/);
    before.needsYouChip = await chipNumber(/need[s]? you$/);
    expect(before.skipped).toBeGreaterThan(0);
    expect(before.created).toBeGreaterThan(0);
    expect(rows).toBe(before.created + before.skipped);
    await expect(dialog().getByRole("row")).toHaveCount(before.created + 1);
    await expect(dialog().getByText(`Showing all ${before.created} new rows. The app suggested the jobs. Change any of them now or later.`)).toBeVisible();
    await expect(dialog().getByText(new RegExp(`^The app read ${importedFile}: ${before.created} new, ${before.skipped} skipped as duplicates`))).toBeAttached();
    expect(await counts()).toEqual(before.counts);
  });

  test("shows each new row with its job and the reason, and rows that need a job ask for one", async () => {
    const waiting = dialog().getByRole("button", { name: /^Choose a job for / });
    await expect(waiting).toHaveCount(before.needsYouChip);
    await expect(dialog().getByRole("cell", { name: "A rule you made" }).first()).toBeVisible();
    await expect(dialog().getByRole("cell", { name: /^(Matches the (outgoing|incoming) transfer|First payment to this payee|The app has nothing to suggest for this one)$/ }).first()).toBeVisible();
    await expect(dialog().getByRole("cell", { name: /^−[\d,.]+ kr$/ }).first()).toBeVisible();
  });

  test("a balance that is off is flagged and stops nothing, and the one the app agrees with matches", async () => {
    const field = balanceField("Everyday");
    await field.fill("1");
    const everyday = accountBlock("Everyday");
    await expect(everyday.getByText(/^The balance differs by /)).toBeVisible();
    await expect(everyday.getByText("The app flags this account for you to look at. It adjusts nothing, and you can still add the file.")).toBeVisible();
    await expect(everyday.getByRole("list").getByRole("listitem").first()).toBeVisible();
    await expect(addButton()).not.toHaveAttribute("aria-disabled", "true");

    const said = await everyday.getByText(/^The balance differs by /).innerText();
    const worked = /the app works out ([-\d,.]+) kr/.exec(said)?.[1];
    expect(worked).toBeTruthy();
    before.balance = worked as string;
    await field.fill(before.balance);
    await expect(everyday.getByText(new RegExp(`^Balance matches the bank: ${before.balance.replace(/[.]/g, "\\.")} kr$`))).toBeVisible();
    await expect(dialog().getByText(say("import.balance.notChecked"), { exact: true })).toHaveCount(3);
  });

  test("a job chosen with the keyboard moves a row out of needs you, and focus stays on that row", async () => {
    const first = dialog().getByRole("button", { name: /^Choose a job for / }).first();
    before.line = Number(await first.getAttribute("data-job-line"));
    const row = dialog().locator(`[data-job-line="${before.line}"]`);
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(2);
    await expect(dialog().getByRole("heading", { name: say("import.pick.title") })).toBeVisible();
    await expect(dialog().getByRole("combobox")).toBeFocused();
    await page.keyboard.type("Food and");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(row).toBeFocused();
    await expect(row).toHaveAccessibleName(/^Change the job for .*\. Now: Food and household$/);
    await expect(row.locator("xpath=ancestor::tr").getByRole("cell", { name: "Chosen by you" })).toBeVisible();
    await expect(chips().filter({ hasText: /need[s]? you$/ })).toHaveText(before.needsYouChip === 1 ? "Nothing needs you" : `${before.needsYouChip - 1} ${before.needsYouChip - 1 === 1 ? "needs" : "need"} you`);
    expect(await counts()).toEqual(before.counts);
  });

  test("Esc in the job picker closes only the picker, and focus goes back to the row", async () => {
    const row = dialog().locator(`[data-job-line="${before.line}"]`);
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
    await expect(row).toBeFocused();
    await expect(row).toHaveAccessibleName(/Now: Food and household$/);
  });

  test("the shell's single keys do nothing from inside the dialog", async () => {
    await dialog().getByRole("checkbox", { name: new RegExp(say("import.suggest.label")) }).focus();
    for (const key of ["p", "t", "r", "a", "n", "Control+k"]) await page.keyboard.press(key);
    expect(await page.evaluate(() => location.hash)).toMatch(/^#\/transactions/);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
  });

  test("Tab keeps focus inside the dialog", async () => {
    await dialog().getByRole("button", { name: say("import.chooseAnother") }).focus();
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab");
      expect(await page.evaluate(() => [...document.querySelectorAll("dialog[open]")].at(-1)?.contains(document.activeElement) ?? false), `after press ${i}`).toBe(true);
    }
  });

  test("Add stores the file with the chosen job and the balance, and the result panel says what happened", async () => {
    await dialog().getByRole("button", { name: /^Choose a job for / }).first().scrollIntoViewIfNeeded();
    await addButton().click();
    const title = dialog().getByRole("heading", { level: 2 });
    await expect(title).toContainText(`Added ${before.created} transactions to `);
    await expect(title).toBeFocused();
    await expect(dialog().getByText(`The app skipped ${before.skipped} duplicates.`)).toBeVisible();
    await expect(dialog().getByText(/up to date/i).first()).toBeVisible();
    await expect(dialog().getByText(new RegExp(`^Balance matches the bank: ${before.balance.replace(/[.]/g, "\\.")} kr$`))).toBeVisible();
    await expect(dialog().getByRole("button", { name: say("import.result.undo") })).toBeVisible();

    const after = await counts();
    before.added = after;
    expect(after.transactions).toBe(before.counts.transactions + before.created);
    expect(after.liveBatches).toBe(before.counts.liveBatches + 1);
    expect(after.enteredBalances).toBe(before.counts.enteredBalances + 1);
    // Pairing a new transfer with a transaction already waiting takes that one out of needs you as well.
    expect(after.needsYou).toBeLessThanOrEqual(before.counts.needsYou + before.needsYouChip - 1);

    const reply = await bridge();
    if (!reply.ok || reply.value.kind !== "ready") throw new Error("Expected a ready snapshot");
    const { tables } = reply.value.snapshot;
    const batch = tables.importBatches.find((b) => b.fileName === importedFile && !b.undone);
    const row = tables.importRows.find((r) => r.batchId === batch?.id && r.line === before.line);
    const transaction = tables.transactions.find((t) => t.id === row?.backs);
    const food = tables.jobs.find((j) => j.name === "Food and household");
    expect(transaction?.treatment).toMatchObject({ kind: "split", allocations: [{ jobId: food?.id, amount: transaction?.amount }] });
  });

  test("closing the result returns focus to Import, and the accounts the file reached show the state the facts give", async () => {
    await dialog().getByRole("button", { name: say("import.result.done") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(importButton()).toBeFocused();
    const states = await accountStates();
    const cover = await everydayCover();
    expect(cover.rhythm).toBe("weekly");
    expect(states["Everyday"]).toBe(cover.days > 7 ? "due" : "upToDate");
    // The file brings Everyday's newest row forward, so the account is no more overdue than before.
    expect(cover.days).toBeLessThan(before.everydayDays);
    expect(before.states["Everyday"]).toBe("due");
    const card = (name: string) => page.locator("li[data-state]").filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card("Everyday")).toContainText(/Checked against your bank on \d/);
    await expect(card("Holiday")).toContainText(say("tx.chip.notChecked"));
  });

  test("the Imports tab lists the import, newest first, with what it did", async () => {
    await tab("imports").click();
    const first = page.getByRole("tabpanel").getByRole("listitem").first();
    await expect(first.getByRole("heading", { name: importedFile })).toBeVisible();
    await expect(first).toContainText("Bulder");
    await expect(first).toContainText("Added today");
    await expect(first).toContainText(`${before.created} new · ${before.skipped} skipped as duplicates`);
    await expect(first).toContainText(`${before.needsYouChip - 1} need you`.replace(/^1 need/, "1 needs"));
    await expect(first.getByRole("button", { name: `Undo import: ${importedFile}` })).toBeVisible();
    expect(await page.getByRole("tabpanel").getByRole("listitem").count()).toBe(before.counts.batches + 1);
  });

  test("the app won't add the same file twice, and says when it was imported", async () => {
    await pick(importedFile);
    const opener = await rememberFocus();
    await openImport();
    await expect(dialog().getByRole("heading", { name: say("import.refused.title.blocked") })).toBeVisible();
    await expect(dialog().getByText(/^You imported this file on \d+ \w+ \d{4}\. Adding it again would repeat every row/)).toBeVisible();
    await expect(dialog().getByRole("button", { name: say("import.chooseAnother") })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await opener.isBack();
    expect((await counts()).liveBatches).toBe(before.counts.liveBatches + 1);
  });

  test("Undo import shows what it would remove, with what you changed first, then takes the whole import back", async () => {
    await page.getByRole("button", { name: `Undo import: ${importedFile}` }).click();
    const preview = dialog();
    await expect(preview.getByRole("heading", { name: `Undo the import of ${importedFile}?` })).toBeVisible();
    await expect(preview.getByText(`This undo removes ${before.created} transactions.`)).toBeVisible();
    await expect(preview.getByRole("heading", { name: /^You changed 1 of them since the import\./ })).toBeVisible();
    await expect(preview.getByText("You chose its job")).toBeVisible();
    expect(await counts()).toMatchObject({ transactions: before.counts.transactions + before.created });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Undo import: ${importedFile}` })).toBeFocused();
    expect((await counts()).liveBatches).toBe(before.counts.liveBatches + 1);

    await page.getByRole("button", { name: `Undo import: ${importedFile}` }).click();
    await dialog().getByRole("button", { name: say("import.undo.confirm") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("tabpanel").getByRole("listitem").first()).toContainText("Undone");
    await expect(page.getByRole("tabpanel").getByRole("listitem").first().getByRole("button", { name: /^Undo import/ })).toHaveCount(0);

    const after = await counts();
    expect(after.transactions).toBe(before.counts.transactions);
    // The new rows that waited for a job go with the import. A transaction that was already waiting and that the import paired as a transfer stays a transfer, whose other side is gone, so it is not back in needs you.
    expect(after.needsYou).toBe(before.added.needsYou - (before.needsYouChip - 1));
    expect(after.liveBatches).toBe(before.counts.liveBatches);
    expect(after.batches).toBe(before.counts.batches + 1);
    expect((await accountStates())["Everyday"]).toBe("due");
  });

  test("Esc and Cancel each leave the Imports tab and the facts as they were, and return focus", async () => {
    const list = page.getByRole("tabpanel");
    const listed = await list.innerText();
    const state = await counts();
    for (const how of ["Escape", "Cancel"] as const) {
      const opener = await rememberFocus();
      await openPreview();
      await balanceField("Everyday").fill("1");
      await expect(accountBlock("Everyday").getByText(/^The balance differs by /)).toBeVisible();
      await expect(addButton()).not.toHaveAttribute("aria-disabled", "true");
      if (how === "Escape") await page.keyboard.press("Escape");
      else await dialog().getByRole("button", { name: say("import.cancel") }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await opener.isBack();
      expect(await list.innerText(), how).toBe(listed);
      expect(await counts(), how).toEqual(state);
    }
  });

  test("an OFX file is read, and the screen says the app has never read a real bank file in that format", async () => {
    await pick("known.ofx");
    await openImport();
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
    await expect(dialog().getByText(say("import.notice.unproven"), { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await pick(importedFile);
    await openImport();
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
    await expect(dialog().getByText(say("import.notice.unproven"), { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("a file in another currency, one the app doesn't know, one it can't read and one that isn't there each say why", async () => {
    await pick("euro.ofx");
    await openImport();
    await expect(dialog().getByText("This file is in EUR. Your household uses NOK.")).toBeVisible();
    await expect(dialog().getByRole("button", { name: say("import.chooseAnother") })).toBeVisible();

    await pick("notes.txt");
    await dialog().getByRole("button", { name: say("import.chooseAnother") }).click();
    await expect(dialog().getByRole("heading", { name: say("import.refused.title.unrecognised") })).toBeVisible();
    await expect(dialog().getByText(/^The app doesn't recognise notes\.txt\./)).toBeVisible();

    await pick("broken.csv");
    await dialog().getByRole("button", { name: say("import.chooseAnother") }).click();
    await expect(dialog().getByText("The app couldn't read line 3 of broken.csv.")).toBeVisible();

    await pick("gone.csv");
    await dialog().getByRole("button", { name: say("import.chooseAnother") }).click();
    await expect(dialog().getByText(/^The app can't find gone\.csv\./)).toBeVisible();

    await pick(importedFile);
    await dialog().getByRole("button", { name: say("import.chooseAnother") }).click();
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await counts()).liveBatches).toBe(before.counts.liveBatches);
  });

  test("rows for an account the household doesn't have are left out and listed, and a file of only such rows is refused", async () => {
    await pick("some-strangers.csv");
    await openImport();
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
    await expect(dialog().getByText("The app left out 1 row for an account that Holt doesn't have. Add it, then import the file again.")).toBeVisible();
    await expect(dialog().getByRole("list", { name: say("import.leftOut.title") }).getByText("9999.99.99999")).toBeVisible();
    await expect(dialog().getByRole("row")).toHaveCount(2);

    await pick("only-strangers.csv");
    await dialog().getByRole("button", { name: say("import.chooseAnother") }).click();
    await expect(dialog().getByRole("heading", { name: say("import.refused.title.blocked") })).toBeVisible();
    await expect(dialog().getByText(/^only-strangers\.csv has no rows for accounts Holt knows\./)).toBeVisible();
    await expect(dialog().getByText("9999.99.99999")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await counts()).liveBatches).toBe(before.counts.liveBatches);
  });

  test("Esc in the Undo preview over the result closes only the preview", async () => {
    await openPreview();
    await addButton().click();
    await expect(dialog().getByRole("heading", { level: 2 })).toContainText(`Added ${before.created} transactions to `);
    await dialog().getByRole("button", { name: say("import.result.undo") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(dialog().getByRole("button", { name: say("import.result.undo") })).toBeFocused();
    await dialog().getByRole("button", { name: say("import.result.done") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await tab("imports").click();
    await page.getByRole("button", { name: `Undo import: ${importedFile}` }).first().click();
    await dialog().getByRole("button", { name: say("import.undo.confirm") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a file whose import was undone can be added again, and the result takes the family to the jobs that wait", async () => {
    const start = await counts();
    await openPreview();
    await addButton().click();
    await expect(dialog().getByRole("heading", { level: 2 })).toContainText(`Added ${before.created} transactions to `);
    await dialog().getByRole("button", { name: say("import.result.showNeedsYou") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tab("needsYou")).toHaveAttribute("aria-selected", "true");
    expect((await counts()).liveBatches).toBe(start.liveBatches + 1);

    await tab("imports").click();
    await page.getByRole("button", { name: `Undo import: ${importedFile}` }).first().click();
    await dialog().getByRole("button", { name: say("import.undo.confirm") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await counts()).toEqual({ ...start, batches: start.batches + 1 });
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
  { name: "Hearth light with glass", theme: "hearth-light", glass: true },
  { name: "Hearth dark with glass", theme: "hearth-dark", glass: true },
] as const;

test.describe.serial("the import screens in every theme and at every width", () => {
  test.beforeAll(async () => {
    holt = await launchHolt({ seed: true, pickFile: (folder) => join(folder, "sample-imports", importedFile) });
    page = holt.page;
    samples = join(holt.dataFolder, "sample-imports");
    const eur = readFileSync(join(import.meta.dirname, "../../../packages/importers/fixtures/synthetic/statement-1x.ofx"), "utf8").replace("<CURDEF>NOK", "<CURDEF>EUR");
    writeFileSync(join(samples, "euro.ofx"), eur);
  });
  test.afterAll(async () => {
    await holt.close();
  });
  test.beforeEach(async () => {
    await holt.emulate({});
    await holt.setWidth(1440, 1100);
    await pick(importedFile);
  });

  async function violations(): Promise<string[]> {
    await page.evaluate(axeSource);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    const { violations: found } = await page.evaluate<AxeResult>("axe.run(document)");
    return found.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.map(String).join(" ")).join(", ")}`);
  }

  async function chooseAppearance(theme: string, glass: boolean): Promise<void> {
    await page.evaluate(([t, g]) => localStorage.setItem("holt-appearance", JSON.stringify({ theme: t, glass: g })), [theme, glass] as const);
    await page.reload();
    await heading().waitFor();
    await show("/transactions");
  }

  for (const { name, theme, glass } of themes) {
    test(`axe finds no serious or critical violation on the Imports tab, the Undo preview, the file check, a refused file and the result in ${name}`, async () => {
      await chooseAppearance(theme, glass);
      expect(await page.evaluate(() => document.documentElement.dataset["glass"])).toBe(glass ? "on" : "off");

      await tab("imports").click();
      await expect(page.getByRole("tabpanel").getByRole("listitem").first()).toBeVisible();
      expect(await violations(), `Imports tab in ${name}`).toEqual([]);

      await page.getByRole("button", { name: /^Undo import: / }).first().click();
      await expect(dialog().getByRole("heading", { name: /^Undo the import of / })).toBeVisible();
      expect(await violations(), `Undo preview in ${name}`).toEqual([]);
      await page.keyboard.press("Escape");

      await openImport();
      await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
      await balanceField("Everyday").fill("1");
      await expect(dialog().getByText(/^The balance differs by /)).toBeVisible();
      expect(await violations(), `File check in ${name}`).toEqual([]);
      await page.keyboard.press("Escape");

      await pick("euro.ofx");
      await openImport();
      await expect(dialog().getByText("This file is in EUR. Your household uses NOK.")).toBeVisible();
      expect(await violations(), `Refused file in ${name}`).toEqual([]);
      await page.keyboard.press("Escape");

      await pick(importedFile);
      await openImport();
      await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
      await addButton().click();
      await expect(dialog().getByRole("heading", { level: 2 })).toContainText("Added ");
      expect(await violations(), `Result in ${name}`).toEqual([]);
      await dialog().getByRole("button", { name: say("import.result.undo") }).click();
      await expect(page.getByRole("dialog").last().getByRole("heading", { name: /^Undo the import of / })).toBeVisible();
      expect(await violations(), `Undo preview over the result in ${name}`).toEqual([]);
      await page.getByRole("dialog").last().getByRole("button", { name: say("import.undo.confirm") }).click();
      await expect(dialog().getByText(/^You undid this import\./)).toBeVisible();
      await dialog().getByRole("button", { name: say("import.result.done") }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }

  for (const width of [1440, 1100, 900]) {
    test(`nothing scrolls sideways at ${width} px, with the file check, the Undo preview or the Imports tab on show`, async () => {
      await chooseAppearance("hearth-light", false);
      await holt.setWidth(width, 1000);
      const overflow = () =>
        page.evaluate(() => {
          const open = [...document.querySelectorAll("dialog[open]")].at(-1);
          const table = open?.querySelector("table")?.parentElement;
          return {
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            body: document.body.scrollWidth - document.body.clientWidth,
            dialog: open === null || open === undefined ? 0 : open.scrollWidth - open.clientWidth,
            table: table === null || table === undefined ? 0 : table.scrollWidth - table.clientWidth,
          };
        });

      await tab("imports").click();
      await expect(page.getByRole("heading", { name: say("import.list.title") })).toBeVisible();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      expect(await overflow(), "Imports tab").toEqual({ page: 0, body: 0, dialog: 0, table: 0 });
      await page.getByRole("button", { name: /^Undo import: / }).first().click();
      await expect(dialog().getByRole("heading", { name: /^Undo the import of / })).toBeVisible();
      expect(await overflow(), "Undo preview").toEqual({ page: 0, body: 0, dialog: 0, table: 0 });
      await page.keyboard.press("Escape");

      await openImport();
      await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
      await balanceField("Everyday").fill("1");
      await expect(dialog().getByText(/^The balance differs by /)).toBeVisible();
      expect(await overflow(), "File check").toEqual({ page: 0, body: 0, dialog: 0, table: 0 });
      await page.keyboard.press("Escape");
    });
  }

  test("reduced motion turns the dialog's entrance off", async () => {
    await holt.emulate({ reducedMotion: true });
    await openImport();
    await expect(dialog().getByRole("heading", { name: say("import.dialog.checkTitle") })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("dialog[open]") as Element).animationName)).toBe("none");
    await page.keyboard.press("Escape");
  });
});
