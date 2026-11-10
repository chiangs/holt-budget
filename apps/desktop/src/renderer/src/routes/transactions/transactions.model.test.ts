import { describe, expect, it } from "vitest";
import { type Facts, type ImportBatch, type ImportRow, type LocalDate, computeFigures, importBatchId, importRowId, localDate, transactionId } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import { canStep } from "./decisions.model.ts";
import { accountChips, activeTab, bankOfFormat, paramOf, sidebarBadge, tabCounts, tabFromParam, tabIds } from "./transactions.model.ts";
import { buildWorld, figuresOf, today } from "./test-support.ts";
import type { ChangeId } from "@holt/core";

const world = buildWorld();

function batch(n: number, format: string, importedAt: string, more: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: importBatchId(testId(7_000 + n)),
    fileName: `file-${n}.csv`,
    fingerprint: `fingerprint-${n}`,
    format,
    importedAt,
    from: localDate("2026-10-01"),
    to: localDate("2026-11-03"),
    rows: 1,
    created: 1,
    matched: 0,
    pending: 0,
    undone: false,
    ...more,
  };
}

function row(n: number, of: ImportBatch, accountId: ImportRow["accountId"], bookingDate: string, more: Partial<ImportRow> = {}): ImportRow {
  return {
    id: importRowId(testId(7_500 + n)),
    batchId: of.id,
    line: n + 1,
    accountId,
    bookingDate: localDate(bookingDate),
    description: "test",
    amount: kr(-1),
    fingerprint: `row-${n}`,
    pending: false,
    backs: transactionId(testId(7_900 + n)),
    ...more,
  };
}

function imported(savingsRhythm: "weekly" | "monthly" = "weekly"): Facts {
  const bulder = batch(1, "bulder-csv", "2026-11-07T12:00:00.000Z");
  const sparebank = batch(2, "sparebank1-csv", "2026-10-20T12:00:00.000Z");
  const rows = [row(1, bulder, world.accounts.everyday, "2026-11-03"), row(2, sparebank, world.accounts.savings, "2026-10-17")];
  const accounts = new Map([...world.facts.accounts].map(([id, a]) => [id, id === world.accounts.savings ? { ...a, importRhythm: savingsRhythm } : a]));
  return {
    ...world.facts,
    accounts,
    importBatches: new Map([bulder, sparebank].map((b) => [b.id, b])),
    importRows: new Map(rows.map((r) => [r.id, r])),
  };
}

describe("tabs", () => {
  it("opens Needs you when anything waits, and All when nothing does", () => {
    expect(activeTab(null, 3)).toBe("needsYou");
    expect(activeTab(null, 0)).toBe("all");
  });

  it("keeps the tab in the address, so it survives back and reload, and an unknown value falls back", () => {
    for (const tab of tabIds) expect(activeTab(paramOf(tab), tab === "needsYou" ? 0 : 5)).toBe(tab);
    expect(activeTab("nonsense", 2)).toBe("needsYou");
    expect(tabFromParam("nonsense")).toBeNull();
    expect(tabFromParam(null)).toBeNull();
  });

  it("counts waiting transactions, all transactions and the imports still in force", () => {
    const facts = imported();
    const undone = batch(3, "bulder-csv", "2026-11-01T12:00:00.000Z", { undone: true });
    const withUndone = { ...facts, importBatches: new Map([...facts.importBatches, [undone.id, undone]]) };
    expect(tabCounts(withUndone, computeFigures(withUndone, today))).toEqual({ needsYou: 10, all: withUndone.transactions.size, imports: 2 });
  });
});

describe("the badge on the sidebar", () => {
  it("is Due when any account is due, however many transactions wait", () => {
    const facts = imported();
    const figures = computeFigures(facts, today);
    expect(figures.importStatus.due).toBeGreaterThan(0);
    expect(sidebarBadge(figures)).toEqual({ kind: "due" });
  });

  it("is the count of waiting transactions when no account is due", () => {
    const figures = computeFigures(imported("monthly"), localDate("2026-11-05"));
    expect(figures.importStatus.due).toBe(0);
    expect(sidebarBadge(figures)).toEqual({ kind: "needsYou", count: 10 });
  });

  it("matches the Needs you tab's count, not its own count of anything else", () => {
    const facts = imported("monthly");
    const figures = computeFigures(facts, localDate("2026-11-05"));
    const badge = sidebarBadge(figures);
    expect(badge).toEqual({ kind: "needsYou", count: tabCounts(facts, figures).needsYou });
  });

  it("is nothing when nothing is due and nothing waits", () => {
    const facts: Facts = { ...imported("monthly"), transactions: new Map([...world.facts.transactions].filter(([, t]) => t.treatment.kind !== "needsYou")) };
    expect(sidebarBadge(computeFigures(facts, localDate("2026-11-05")))).toBeNull();
  });
});

describe("account chips", () => {
  const facts = imported();
  const chips = accountChips(facts, figuresOf(facts).importStatus, today);

  it("has a chip for each shared account that is imported, with its state", () => {
    expect(chips.map((c) => [c.name, c.state])).toEqual([["Everyday", "upToDate"], ["Savings", "due"]]);
  });

  it("names the bank from the format of the last import, and the rhythm", () => {
    expect(chips.map((c) => [c.bank, c.rhythm])).toEqual([["bulder", "monthly"], ["sparebank1", "weekly"]]);
  });

  it("says whether each account was checked against the bank, from the figure", () => {
    expect(chips.map((c) => c.checkedOn)).toEqual([null, null]);
    const status = figuresOf(facts).importStatus;
    const typed = { ...status, accounts: new Map([...status.accounts].map(([id, figure]) => [id, { ...figure, checkedOn: localDate("2026-11-06") }])) };
    expect(accountChips(facts, typed, today).map((c) => c.checkedOn)).toEqual([localDate("2026-11-06"), localDate("2026-11-06")]);
  });

  it("says what each covers to and how many days ago it was imported", () => {
    expect(chips.map((c) => [c.coversTo, c.daysSinceImport])).toEqual([["2026-11-03", 3], ["2026-10-17", 21]]);
  });

  it("has no bank and no days for an account with no import, and calls it not imported", () => {
    const never = accountChips(world.facts, figuresOf(world.facts).importStatus, today);
    expect(never.map((c) => [c.state, c.bank, c.coversTo, c.daysSinceImport])).toEqual([["notImported", null, null, null], ["notImported", null, null, null]]);
  });

  it("shows 0 days for an import made today and never a negative number", () => {
    const later = localDate("2026-11-05") as LocalDate;
    const fresh = accountChips(facts, figuresOf(facts, later).importStatus, later);
    expect(fresh.map((c) => c.daysSinceImport)).toEqual([0, 16]);
    const earlier = accountChips(facts, figuresOf(facts, localDate("2026-11-01")).importStatus, localDate("2026-11-01"));
    expect(earlier.every((c) => (c.daysSinceImport ?? 0) >= 0)).toBe(true);
  });

  it("ignores an import that was undone", () => {
    const undone = [...facts.importBatches.values()].map((b) => ({ ...b, undone: true }));
    const none = { ...facts, importBatches: new Map(undone.map((b) => [b.id, b])) };
    const after = accountChips(none, figuresOf(none).importStatus, today);
    expect(after.every((c) => c.state === "notImported" && c.bank === null)).toBe(true);
  });
});

describe("bankOfFormat", () => {
  it("maps the formats the app reads, and gives anything else the generic name", () => {
    expect(bankOfFormat("bulder-csv")).toBe("bulder");
    expect(bankOfFormat("sparebank1-csv")).toBe("sparebank1");
    expect(bankOfFormat("ofx")).toBe("generic");
    expect(bankOfFormat("some-new-format")).toBe("generic");
  });
});

describe("canStep", () => {
  const mine = "change-mine" as ChangeId;
  const theirs = "change-theirs" as ChangeId;
  const summary = (id: ChangeId) => ({ id, at: "2026-11-10T09:00:00.000Z", kind: "setTreatment" as const, by: { kind: "family" } as never });
  const made = new Set([mine]);

  it("offers undo only while the change an undo would reverse is one the family made here", () => {
    expect(canStep("undo", { undo: summary(mine), redo: null }, made)).toBe(true);
    expect(canStep("undo", { undo: summary(theirs), redo: null }, made)).toBe(false);
    expect(canStep("undo", { undo: null, redo: null }, made)).toBe(false);
    expect(canStep("undo", null, made)).toBe(false);
  });

  it("offers redo only for the change an undo just reversed", () => {
    expect(canStep("redo", { undo: null, redo: summary(mine) }, made)).toBe(true);
    expect(canStep("redo", { undo: null, redo: summary(theirs) }, made)).toBe(false);
  });
});
