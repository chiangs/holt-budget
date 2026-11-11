import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { launchHolt, type HoltApp } from "./launch.ts";
import { say } from "./messages.ts";

/**
 * The Plan screen on the synthetic household: how this month's money is divided, whether every unit has a job,
 * how each job is doing, and where the money sits, with amounts assigned and moved in place. The seed's current
 * month is open and leaves 228 kr unassigned (the adults' contributions are linked as its income), so a test that
 * needs another state makes it itself through the same commands the screen uses. The seed has no month that is still only
 * planned, so the "Open November" path is proved in the unit tests of the banner, not here.
 */

type Holt = {
  factsSnapshot(): Promise<{ value: { snapshot: { today: string; head: { undo: unknown; redo: unknown }; tables: Record<string, any[]> } } }>;
  run(command: unknown): Promise<{ ok: boolean; value: { status: string } }>;
};

const fill = (id: string, values: Record<string, string>): string => say(id).replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

/** "14,500 kr", "12,060.50 kr" or "−3 kr" as minor units. A test may use a float to read a screen, as the app never does. */
function minorOf(text: string): number {
  const match = /(−|-)?\s*([\d,]+(?:\.\d+)?)\s*kr/.exec(text);
  if (match === null) throw new Error(`No amount in "${text}"`);
  const value = Math.round(Number((match[2] ?? "").replace(/,/g, "")) * 100);
  return match[1] === undefined ? value : -value;
}

const kroner = (n: number): number => n * 100;

let holt: HoltApp;
let page: Page;

const jobsCard = () => page.getByRole("region", { name: say("plan.jobs.title") });
const table = () => jobsCard().getByRole("table");
const rowOf = (name: string): Locator => table().locator("tr", { has: page.getByRole("button", { name, exact: true }) });
const assignedOf = async (name: string): Promise<number> => minorOf(await rowOf(name).locator("td").nth(0).innerText());
const spentOf = async (name: string): Promise<string> => (await rowOf(name).locator("td").nth(1).innerText()).trim();
const statusOf = async (name: string): Promise<string> => (await rowOf(name).locator("td").nth(2).innerText()).trim();
const selectedName = async (): Promise<string> => (await table().locator('tr[data-selected="true"] th button').first().innerText()).trim();
const banner = () => page.locator("header div[data-kind]");
// Money in and Moves at the bank keep their own, usually empty, status regions, so only the one with words counts.
const feedback = () => page.locator('div[role="status"][aria-live="polite"]').filter({ hasText: /\S/ });
const undoButton = () => page.getByRole("button", { name: new RegExp(`^${say("plan.undo")}`) });
const dialog = () => page.getByRole("dialog");
const panel = () => page.getByRole("complementary", { name: say("plan.panel.label") });

async function showPlan(target: Page = page): Promise<void> {
  await target.evaluate(() => {
    location.hash = "#/plan";
  });
  await expect(target.getByRole("heading", { level: 1 })).toHaveText(say("screen.plan.title"));
  await expect(target.getByRole("table")).toBeVisible();
}

async function run(command: unknown): Promise<void> {
  const reply = await page.evaluate((c) => (window as unknown as { holt: Holt }).holt.run(c), command);
  expect(reply.value.status, JSON.stringify(reply)).toBe("applied");
}

async function snapshot() {
  return page.evaluate(async () => (await (window as unknown as { holt: Holt }).holt.factsSnapshot()).value.snapshot);
}

async function assignments(): Promise<Map<string, number>> {
  const { today, tables } = await snapshot();
  const month = today.slice(0, 7);
  const names = new Map<string, string>(tables["jobs"]!.map((j) => [j.id as string, j.name as string]));
  const found = new Map<string, number>([...names.values()].map((name) => [name, 0]));
  for (const a of tables["assignments"]!.filter((row) => row.month === month)) found.set(names.get(a.jobId as string) ?? (a.jobId as string), a.amount as number);
  return found;
}

/** What the helper below gives the other jobs, in whole kroner. Every other job is cleared. */
const kept: Record<string, number> = { "Food and household": 14_200, Buffer: 2_000, Pharmacy: 500, Holidays: 3_000 };

/**
 * Puts the current month into a known state with the commands the screen uses: every assignment is cleared, the
 * money available is read from the banner, a few jobs get round amounts, and the Mortgage takes the rest but
 * `wanted` (a negative `wanted` gives more than there is). The screen reloads to read it.
 */
async function leaveUnassigned(wanted: number): Promise<void> {
  const { today, tables } = await snapshot();
  const month = today.slice(0, 7);
  const job = (name: string): string => {
    const found = tables["jobs"]!.find((j) => j.name === name);
    if (found === undefined) throw new Error(`The seed has no job ${name}`);
    return found.id as string;
  };
  await run({ kind: "batch", commands: tables["jobs"]!.map((j) => ({ kind: "assign", month, jobId: j.id, amount: 0 })) });
  await page.reload();
  await expect(banner()).toHaveAttribute("data-kind", "unassigned");
  const available = minorOf(await banner().innerText());
  const others = Object.entries(kept).map(([name, amount]) => ({ kind: "assign", month, jobId: job(name), amount: kroner(amount) }));
  const mortgage = available - wanted - Object.values(kept).reduce((sum, amount) => sum + kroner(amount), 0);
  expect(mortgage, "the seed has money enough for the Mortgage").toBeGreaterThan(0);
  await run({ kind: "batch", commands: [...others, { kind: "assign", month, jobId: job("Mortgage"), amount: mortgage }] });
  await page.reload();
  await expect(table()).toBeVisible();
}

async function startFresh(width = 1440): Promise<void> {
  await holt.setWidth(width, 1100);
  await page.reload();
  await expect(table()).toBeVisible();
}

test.describe.serial("Plan on the synthetic household", () => {
  test.beforeAll(async () => {
    holt = await launchHolt({ seed: true });
    page = holt.page;
    await holt.setWidth(1440, 1100);
    await showPlan();
  });
  test.afterAll(async () => {
    await holt.close();
  });

  test("lists the seeded jobs by group, each group with its total and each job with what it has assigned", async () => {
    const groups = await table().locator("tbody tr th[scope='rowgroup']").allInnerTexts();
    expect(groups).toEqual(["Fixed costs", "Living", "Saving"]);
    expect(await assignedOf("Mortgage")).toBe(kroner(14_500));
    expect(await assignedOf("Food and household")).toBe(kroner(14_200));
    expect(await assignedOf("Buffer")).toBe(kroner(2_000));
    expect(await assignedOf("Union fees")).toBe(0);

    const kroneTotals = await table().locator("tbody").evaluateAll((bodies) =>
      bodies.map((body) => {
        const [head, ...rest] = Array.from(body.querySelectorAll("tr"));
        const headCells = Array.from(head?.querySelectorAll("td") ?? []).map((cell) => (cell as HTMLElement).innerText);
        const rowCells = rest.filter((r) => r.querySelector("th[scope='row']")).map((r) => (r.querySelectorAll("td")[0] as HTMLElement).innerText);
        return { total: headCells[0] ?? "", rows: rowCells };
      }),
    );
    expect(kroneTotals).toHaveLength(3);
    for (const { total, rows } of kroneTotals) {
      expect(minorOf(total)).toBe(rows.reduce((sum, text) => sum + minorOf(text), 0));
    }
    expect(minorOf(kroneTotals[0]!.total)).toBe(kroner(29_870));
  });

  test("says what each kind of job is doing, in plain words from the figures", async () => {
    expect(await statusOf("Mortgage")).toBe(fill("plan.status.left", { amount: "14,500 kr" }));
    expect(await spentOf("Mortgage")).toMatch(/^0 kr$/);
    expect(await statusOf("Union fees")).toBe("Paused");
    expect(await statusOf("Books and games")).toBe("Archived");
    expect(await statusOf("Buffer")).toMatch(/^[\d,.]+ kr of [\d,.]+ kr \(3 months\)$/);
    expect(await statusOf("Confirmation")).toMatch(/^Bucket [\d,.]+ kr of 38,000 kr by [A-Z][a-z]{2} \d{4}$/);
    expect(await statusOf("Christmas")).toMatch(/^Bucket [\d,.]+ kr$/);
    expect(await spentOf("Buffer")).toBe(say("plan.row.noSpending"));
    expect(await table().innerText()).not.toMatch(/Due \d/);
  });

  test("the banner says how much has no job, as the seed's month leaves 228 kr unassigned", async () => {
    await expect(banner()).toHaveAttribute("data-kind", "unassigned");
    await expect(banner()).toContainText("228 kr has no job yet");
    await expect(page.getByText(/^[A-Z][a-z]+ \d{4} · every krone gets a job$/)).toBeVisible();
  });

  test("lists each shared account with its buckets, and the accounts the household pays into apart", async () => {
    const card = page.getByRole("region", { name: say("plan.where.title") });
    for (const name of ["Everyday", "Bills", "Food", "Holiday", "Loan payments", "Deposit"]) await expect(card.getByText(name, { exact: true })).toBeVisible();
    for (const name of ["Buffer", "Confirmation", "Holidays", "New car", "Konfirmasjon", "Car running costs"]) await expect(card.getByText(name, { exact: true }).first()).toBeVisible();

    // The Buffer's bucket in the account list and the Buffer's line in the table come from the same figure.
    const bucketLine = card.locator("div", { has: page.getByText("Buffer", { exact: true }) }).filter({ hasText: /\d/ }).last();
    const bucket = minorOf(await bucketLine.innerText());
    expect(await statusOf("Buffer")).toContain(
      new Intl.NumberFormat("en-GB", { minimumFractionDigits: bucket % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(bucket / 100),
    );

    await expect(card.getByRole("button", { name: say("plan.where.addAccount") })).toBeDisabled();
    await expect(card.getByRole("button", { name: say("plan.where.addBucket") })).toBeDisabled();
    await expect(card.getByText(say("plan.where.soon"))).toBeVisible();
    await expect(card.getByText(/The buckets hold .* more than this account does\. The likely cause is/).first()).toBeVisible();
  });

  test("shows money with no job, and the quick adds give all of it to the buffer and the largest save-up job", async () => {
    await leaveUnassigned(kroner(228));
    await expect(banner()).toHaveAttribute("data-kind", "unassigned");
    await expect(banner()).toContainText("228 kr has no job yet");
    await expect(banner().getByRole("button", { name: fill("plan.banner.quickAdd", { job: "Buffer" }) })).toBeVisible();
    await expect(banner().getByRole("button", { name: fill("plan.banner.quickAdd", { job: "New car" }) })).toBeVisible();
    await expect(banner().getByRole("button", { name: /^Add to / })).toHaveCount(2);

    const before = await assignedOf("Buffer");
    await banner().getByRole("button", { name: fill("plan.banner.quickAdd", { job: "Buffer" }) }).click();
    await expect(banner()).toHaveAttribute("data-kind", "none");
    await expect(banner()).toContainText("Every krone has a job");
    expect(await assignedOf("Buffer")).toBe(before + kroner(228));
    await expect(feedback()).toContainText(fill("plan.done.quickAdd", { amount: "228 kr", job: "Buffer" }));
    expect((await assignments()).get("Buffer")).toBe(before + kroner(228));

    await undoButton().click();
    await expect(banner()).toHaveAttribute("data-kind", "unassigned");
    await expect(banner()).toContainText("228 kr has no job yet");
    expect(await assignedOf("Buffer")).toBe(before);
    expect((await assignments()).get("Buffer")).toBe(before);
  });

  test("an amount typed in place saves to that job only, the banner follows, and Undo puts it back", async () => {
    await expect(banner()).toContainText("228 kr has no job yet");
    const others = await assignments();
    const food = await assignedOf("Food and household");

    await rowOf("Food and household").getByRole("button", { name: /^Change what Food and household has assigned/ }).click();
    const field = rowOf("Food and household").getByRole("textbox", { name: fill("plan.row.editLabel", { job: "Food and household" }) });
    await expect(field).toBeFocused();
    await field.fill(String((food - kroner(100)) / 100));
    await field.press("Enter");

    await expect(field).toHaveCount(0);
    await expect(banner()).toContainText("328 kr has no job yet");
    expect(await assignedOf("Food and household")).toBe(food - kroner(100));
    await expect(feedback()).toContainText(fill("plan.done.assign", { job: "Food and household", amount: "14,100 kr" }));
    const after = await assignments();
    expect(after.get("Food and household")).toBe(food - kroner(100));
    for (const [name, amount] of others) if (name !== "Food and household") expect(after.get(name), name).toBe(amount);
    await expect(rowOf("Food and household")).toBeFocused();

    await undoButton().click();
    await expect(banner()).toContainText("228 kr has no job yet");
    expect(await assignedOf("Food and household")).toBe(food);
  });

  test("Esc cancels an edit and changes nothing, and a text that isn't an amount stays in the field with its reason", async () => {
    const food = await assignedOf("Food and household");
    await rowOf("Food and household").getByRole("button", { name: /^Change what/ }).click();
    const field = rowOf("Food and household").getByRole("textbox");
    await field.click();
    await expect(field).toBeFocused();
    await expect(panel()).toHaveCount(0);
    await field.fill("99999");
    await field.press("Escape");
    await expect(field).toHaveCount(0);
    expect(await assignedOf("Food and household")).toBe(food);
    await expect(rowOf("Food and household")).toBeFocused();

    await rowOf("Food and household").getByRole("button", { name: /^Change what/ }).click();
    await rowOf("Food and household").getByRole("textbox").fill("lots");
    await rowOf("Food and household").getByRole("textbox").press("Enter");
    await expect(rowOf("Food and household").getByRole("alert")).toHaveText(say("plan.problem.notAnAmount"));
    await rowOf("Food and household").getByRole("textbox").fill("-5");
    await rowOf("Food and household").getByRole("textbox").press("Enter");
    await expect(rowOf("Food and household").getByRole("alert")).toHaveText(say("plan.problem.negative"));
    expect(await assignedOf("Food and household").catch(() => null)).toBeNull();
    await rowOf("Food and household").getByRole("textbox").press("Escape");
    expect(await assignedOf("Food and household")).toBe(food);
    expect((await assignments()).get("Food and household")).toBe(food);
  });

  test("moving money between two jobs changes both rows by the amount and leaves the banner alone, and Undo restores both", async () => {
    const food = await assignedOf("Food and household");
    const buffer = await assignedOf("Buffer");
    await rowOf("Food and household").getByRole("button", { name: fill("plan.row.move", { job: "Food and household" }) }).click();
    await expect(dialog().getByRole("heading", { name: say("plan.moveDialog.title") })).toBeVisible();
    await expect(dialog().getByRole("combobox").first()).toHaveValue(/.+/);

    await dialog().getByRole("button", { name: say("plan.moveDialog.chooseJob") }).click();
    await page.getByRole("combobox", { name: say("needsYou.job.search") }).fill("buffer");
    await page.getByRole("listbox", { name: say("needsYou.job.list") }).getByRole("option", { name: "Buffer" }).click();
    await dialog().getByRole("textbox", { name: say("plan.moveDialog.amount") }).fill("500");
    await dialog().getByRole("button", { name: say("plan.moveDialog.submit") }).click();
    await expect(dialog()).toHaveCount(0);

    expect(await assignedOf("Food and household")).toBe(food - kroner(500));
    expect(await assignedOf("Buffer")).toBe(buffer + kroner(500));
    await expect(banner()).toContainText("228 kr has no job yet");
    await expect(feedback()).toContainText(fill("plan.done.move", { amount: "500 kr", from: "Food and household", to: "Buffer" }));
    const moved = await assignments();
    expect(moved.get("Food and household")).toBe(food - kroner(500));
    expect(moved.get("Buffer")).toBe(buffer + kroner(500));

    await undoButton().click();
    expect(await assignedOf("Food and household")).toBe(food);
    expect(await assignedOf("Buffer")).toBe(buffer);
  });

  test("the move dialog says why it can't move, before anything changes", async () => {
    const food = await assignedOf("Food and household");
    await rowOf("Food and household").getByRole("button", { name: fill("plan.row.move", { job: "Food and household" }) }).click();
    await dialog().getByRole("button", { name: say("plan.moveDialog.submit") }).click();
    await expect(dialog().getByRole("alert")).toHaveText(say("plan.move.problem.chooseTo"));
    await dialog().getByRole("button", { name: say("plan.moveDialog.unassigned") }).click();
    await dialog().getByRole("textbox", { name: say("plan.moveDialog.amount") }).fill("999999");
    await dialog().getByRole("button", { name: say("plan.moveDialog.submit") }).click();
    await expect(dialog().getByRole("alert")).toContainText("has only");
    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);
    expect(await assignedOf("Food and household")).toBe(food);
    await expect(rowOf("Food and household").getByRole("button", { name: fill("plan.row.move", { job: "Food and household" }) })).toBeFocused();
  });

  test("an over-assigned month says how much, and Move money takes it back to unassigned until every unit has a job", async () => {
    await leaveUnassigned(-kroner(500));
    await expect(banner()).toHaveAttribute("data-kind", "overAssigned");
    await expect(banner()).toContainText("500 kr is over");

    const mortgage = await assignedOf("Mortgage");
    await banner().getByRole("button", { name: say("plan.move") }).click();
    await expect(dialog().getByRole("button", { name: say("plan.moveDialog.unassigned") })).toHaveAttribute("aria-pressed", "true");
    await dialog().getByRole("combobox").selectOption({ label: "Mortgage" });
    await dialog().getByRole("textbox", { name: say("plan.moveDialog.amount") }).fill("500");
    await dialog().getByRole("button", { name: say("plan.moveDialog.submit") }).click();
    await expect(dialog()).toHaveCount(0);

    await expect(banner()).toHaveAttribute("data-kind", "none");
    expect(await assignedOf("Mortgage")).toBe(mortgage - kroner(500));
    await expect(feedback()).toContainText(fill("plan.done.unassign", { amount: "500 kr", from: "Mortgage" }));
    await undoButton().click();
    await expect(banner()).toContainText("500 kr is over");
  });

  test("U undoes a change made here, and does nothing for a change made elsewhere or on this screen before the family left it", async () => {
    await leaveUnassigned(kroner(228));
    const food = await assignedOf("Food and household");
    await rowOf("Food and household").getByRole("button", { name: /^Change what/ }).click();
    await rowOf("Food and household").getByRole("textbox").fill(String(food / 100 - 28));
    await rowOf("Food and household").getByRole("textbox").press("Enter");
    await expect(rowOf("Food and household").getByRole("textbox")).toHaveCount(0);
    await expect(banner()).toContainText("256 kr has no job yet");

    await page.keyboard.press("u");
    await expect(banner()).toContainText("228 kr has no job yet");
    expect(await assignedOf("Food and household")).toBe(food);
    await page.keyboard.press("Shift+U");
    await expect(banner()).toContainText("256 kr has no job yet");

    await page.keyboard.press("t");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(say("screen.transactions.title"));
    await page.keyboard.press("p");
    await expect(table()).toBeVisible();
    await expect(undoButton()).toHaveCount(0);
    const before = await assignments();
    await page.keyboard.press("u");
    await page.waitForTimeout(300);
    expect(await assignments()).toEqual(before);
    await expect(banner()).toContainText("256 kr has no job yet");

    const { today, tables } = await snapshot();
    const pharmacy = tables["jobs"]!.find((j) => j.name === "Pharmacy")!.id as string;
    await run({ kind: "assign", month: today.slice(0, 7), jobId: pharmacy, amount: kroner(10) });
    await page.reload();
    await expect(table()).toBeVisible();
    const elsewhere = await assignments();
    await page.keyboard.press("u");
    await page.waitForTimeout(300);
    expect(await assignments()).toEqual(elsewhere);
  });

  test("a closed month can't be changed, and Reopen makes it editable again", async () => {
    await startFresh();
    const { today } = await snapshot();
    await run({ kind: "closeMonth", month: today.slice(0, 7) });
    await page.reload();
    await expect(banner()).toHaveAttribute("data-kind", "closed");
    await expect(banner()).toContainText(/ is closed\. Reopen it to change the plan\./);
    await expect(table().getByRole("button", { name: /^Change what/ })).toHaveCount(0);
    await banner().getByRole("button", { name: /^Reopen / }).click();
    await expect(banner()).not.toHaveAttribute("data-kind", "closed");
    await expect(table().getByRole("button", { name: /^Change what/ }).first()).toBeVisible();
    await expect(feedback()).toContainText(/^You reopened /);
  });
});

test.describe.serial("Plan with the keyboard alone", () => {
  test.beforeAll(async () => {
    holt = await launchHolt({ seed: true });
    page = holt.page;
    await holt.setWidth(1440, 1100);
    await showPlan();
    await leaveUnassigned(kroner(228));
  });
  test.afterAll(async () => {
    await holt.close();
  });

  test("J and K move the selection, Enter opens the panel beside the table, and Esc closes it and returns to the row", async () => {
    expect(await selectedName()).toBe("Mortgage");
    await page.keyboard.press("j");
    expect(await selectedName()).toBe("Electricity");
    await expect(rowOf("Electricity")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    expect(await selectedName()).toBe("Municipal fees");
    await page.keyboard.press("k");
    await page.keyboard.press("ArrowUp");
    expect(await selectedName()).toBe("Mortgage");

    await expect(panel()).toHaveCount(0);
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await expect(panel()).toBeAttached();
    await expect(page.locator("[data-panel]")).toHaveAttribute("data-panel", "open");
    const panelBox = await panel().boundingBox();
    const tableBox = await table().boundingBox();
    expect(panelBox!.x).toBeGreaterThan(tableBox!.x + tableBox!.width - 2);

    await page.keyboard.press("j");
    expect(await selectedName()).toBe("Municipal fees");
    await expect(panel()).toBeAttached();

    await page.keyboard.press("Escape");
    await expect(panel()).toHaveCount(0);
    await expect(rowOf("Municipal fees")).toBeFocused();
  });

  test("clicking a row opens the panel for it, and the close and reopen cycle leaves the page where it was", async () => {
    await rowOf("Water").getByRole("button", { name: "Water", exact: true }).click();
    await expect(panel()).toBeAttached();
    expect(await selectedName()).toBe("Water");
    await page.keyboard.press("Escape");
    await expect(panel()).toHaveCount(0);
  });

  test("E edits the selected amount, Enter saves, and U takes it back", async () => {
    for (let step = 0; (await selectedName()) !== "Pharmacy" && step < 60; step += 1) await page.keyboard.press("j");
    expect(await selectedName()).toBe("Pharmacy");
    const pharmacy = await assignedOf("Pharmacy");
    await page.keyboard.press("e");
    const field = rowOf("Pharmacy").getByRole("textbox");
    await expect(field).toBeFocused();
    await page.keyboard.type(String(pharmacy / 100 + 228));
    await page.keyboard.press("Enter");
    await expect(field).toHaveCount(0);
    await expect(banner()).toHaveAttribute("data-kind", "none");
    expect(await assignedOf("Pharmacy")).toBe(pharmacy + kroner(228));
    await page.keyboard.press("u");
    await expect(banner()).toContainText("228 kr has no job yet");
    expect(await assignedOf("Pharmacy")).toBe(pharmacy);
  });

  test("no shortcut fires while an amount is typed: J, K, E, U, N and Enter stay in the field", async () => {
    await rowOf("Pharmacy").getByRole("button", { name: /^Change what/ }).click();
    const field = rowOf("Pharmacy").getByRole("textbox");
    await field.fill("");
    await page.keyboard.type("jkenu");
    await expect(field).toHaveValue("jkenu");
    expect(await selectedName()).toBe("Pharmacy");
    await expect(page.locator('[data-slot="new-job"]')).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await field.press("Escape");
    await expect(field).toHaveCount(0);
  });

  test("N does nothing while a dialog is open, and opens the New job flow once it is closed", async () => {
    await expect(page.getByRole("button", { name: new RegExp(`^${say("plan.newJob")}`) })).toHaveAttribute("aria-keyshortcuts", "N");
    await banner().getByRole("button", { name: say("plan.move") }).click();
    await expect(dialog()).toBeVisible();
    await dialog().getByRole("combobox").focus();
    await page.keyboard.press("n");
    await page.getByRole("button", { name: say("plan.moveDialog.cancel") }).focus();
    await page.keyboard.press("n");
    await expect(page.locator('[data-slot="new-job"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);

    await page.keyboard.press("n");
    await expect(page.locator('[data-slot="new-job"]')).toHaveCount(1);
  });

  test("the add-a-line button opens the New job flow for that group", async () => {
    await page.reload();
    await expect(table()).toBeVisible();
    await expect(page.locator('[data-slot="new-job"]')).toHaveCount(0);
    await page.getByRole("button", { name: fill("plan.row.addLine", { group: "Living" }) }).click();
    await expect(page.locator('[data-slot="new-job"]')).toHaveCount(1);
  });

  test("the navigation letters still navigate from Plan", async () => {
    // The test before leaves the cursor in the New job form, where a letter is typed, not a shortcut.
    await page.reload();
    await expect(table()).toBeVisible();
    await page.keyboard.press("t");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(say("screen.transactions.title"));
    await page.keyboard.press("p");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(say("screen.plan.title"));
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

test.describe("layout and accessibility of Plan", () => {
  test.beforeAll(async () => {
    holt = await launchHolt({ seed: true });
    page = holt.page;
    await holt.setWidth(1440, 1100);
    await showPlan();
  });
  test.afterAll(async () => {
    await holt.close();
  });

  async function appearance(theme: string, glass: boolean): Promise<void> {
    await page.evaluate(([t, g]) => localStorage.setItem("holt-appearance", JSON.stringify({ theme: t, glass: g })), [theme, glass] as const);
    await page.reload();
    await expect(table()).toBeVisible();
  }

  async function violations(): Promise<string[]> {
    await page.evaluate(axeSource);
    const { violations: found } = await page.evaluate<AxeResult>("axe.run(document)");
    return found.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.map(String).join(" ")).join(", ")}`);
  }

  for (const { name, theme, glass } of themes) {
    test(`axe finds no serious or critical violation in ${name}, with the table, the panel, an amount being edited and each dialog open`, async () => {
      await appearance(theme, glass);
      expect(await violations(), "the screen").toEqual([]);

      await page.keyboard.press("Enter");
      await expect(panel()).toBeAttached();
      expect(await violations(), "the panel open").toEqual([]);
      await page.keyboard.press("Escape");
      await expect(panel()).toHaveCount(0);

      await page.keyboard.press("e");
      await expect(table().getByRole("textbox")).toBeFocused();
      await table().getByRole("textbox").fill("lots");
      await table().getByRole("textbox").press("Enter");
      await expect(table().getByRole("alert").filter({ hasText: /./ })).toBeVisible();
      expect(await violations(), "an amount being edited, with its reason").toEqual([]);
      await table().getByRole("textbox").press("Escape");

      await banner().getByRole("button", { name: say("plan.move") }).click();
      await expect(dialog()).toBeVisible();
      await page.waitForFunction(() => document.querySelector("dialog")?.getAnimations().length === 0);
      expect(await violations(), "the move dialog").toEqual([]);
      await dialog().getByRole("button", { name: say("plan.moveDialog.chooseJob") }).click();
      await expect(page.getByRole("combobox", { name: say("needsYou.job.search") })).toBeVisible();
      await page.waitForFunction(() => Array.from(document.querySelectorAll("dialog")).every((d) => d.getAnimations().length === 0));
      expect(await violations(), "the job picker over the move dialog").toEqual([]);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(dialog()).toHaveCount(0);
    });
  }

  for (const width of [1440, 1100, 900]) {
    test(`has no horizontal scroll at ${width} px, with the panel open and a long job name in the table`, async () => {
      await appearance("hearth-light", false);
      await holt.setWidth(width);
      const measure = () => page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth, width: innerWidth }));
      expect(await measure()).toEqual({ page: 0, body: 0, width });
      await page.keyboard.press("Enter");
      await expect(panel()).toBeAttached();
      expect(await measure()).toEqual({ page: 0, body: 0, width });
      const box = await table().boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
    });
  }

  test("stacks the panels at 900 px: the accounts come after the jobs, not beside them", async () => {
    await holt.setWidth(900);
    const tableBox = await table().boundingBox();
    const whereBox = await page.getByRole("region", { name: say("plan.where.title") }).boundingBox();
    expect(whereBox!.y).toBeGreaterThan(tableBox!.y + tableBox!.height - 2);
    await holt.setWidth(1440);
    const wide = await page.getByRole("region", { name: say("plan.where.title") }).boundingBox();
    const wideTable = await table().boundingBox();
    expect(wide!.x).toBeGreaterThan(wideTable!.x + wideTable!.width - 2);
  });

  test("a screen with no household says Setup comes in a later version", async () => {
    const bare = await launchHolt();
    try {
      await bare.page.evaluate(() => {
        location.hash = "#/plan";
      });
      await expect(bare.page.getByRole("heading", { level: 2, name: say("plan.empty.title") })).toBeVisible();
      await expect(bare.page.getByText(say("plan.empty.body"))).toBeVisible();
      await expect(bare.page.getByRole("button", { name: new RegExp(say("plan.newJob")) })).toHaveCount(0);
    } finally {
      await bare.close();
    }
  });
});
