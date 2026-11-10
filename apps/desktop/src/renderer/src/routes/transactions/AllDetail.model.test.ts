import { type Facts, type FamilyCommand, type ImportBatch, type ImportBatchId, type ImportRow, type Transaction, apply, importBatchId, importRowId, localDate, money, ruleId } from "@holt/core";
import { testId } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbitraryFacts } from "../../../../../../../packages/core/src/testing/arbitrary-facts.ts";
import {
  type ActionId,
  actionLabel,
  availableActions,
  defaultFundsMonth,
  fundsMonthChoices,
  historyCommand,
  incomeCommand,
  jobCommand,
  needsYouCommand,
  noteCommand,
  pickableJobsFor,
  refundCommand,
  sourcesByTransaction,
  splitCommand,
} from "./AllDetail.model.ts";
import { splitTo, today, transaction, withTransactions, world } from "./AllTestWorld.ts";

const w = world();
const run = (facts: Facts, command: FamilyCommand | null) => {
  if (command === null) throw new Error("The command was not built");
  return apply(facts, command, { asOf: today });
};
const after = (facts: Facts, command: FamilyCommand | null, id: Transaction["id"]): Transaction => {
  const result = run(facts, command);
  if (!result.ok) throw new Error(`Refused: ${result.refusal.code}`);
  return result.facts.transactions.get(id)!;
};
const refusedWith = (facts: Facts, command: FamilyCommand | null): string | null => {
  const result = run(facts, command);
  return result.ok ? null : result.refusal.code;
};

describe("where a transaction came from", () => {
  const batch = (n: number, fileName: string, importedAt: string, undone = false): ImportBatch => ({
    id: importBatchId(testId(500 + n)),
    fileName,
    fingerprint: String(n).padStart(64, "0"),
    format: "bulder-csv",
    importedAt,
    from: localDate("2026-10-01"),
    to: localDate("2026-10-31"),
    rows: 1,
    created: 1,
    matched: 0,
    pending: 0,
    undone,
  });
  const row = (n: number, batchId: ImportBatchId, line: number, backs: Transaction["id"] | null): ImportRow => ({
    id: importRowId(testId(700 + n)),
    batchId,
    line,
    accountId: w.accounts.everyday,
    bookingDate: localDate("2026-10-05"),
    description: "Card",
    amount: money(-100),
    fingerprint: `f${n}`,
    pending: false,
    backs,
  });

  it("lists each import row that backs it, with file and line, the first import first", () => {
    const t = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: -100 });
    const other = transaction({ accountId: w.accounts.everyday, date: "2026-10-06", amount: -200 });
    const first = batch(1, "october-1.csv", "2026-10-31T10:00:00.000Z");
    const second = batch(2, "october-2.csv", "2026-11-03T09:00:00.000Z");
    const rows = [row(1, second.id, 7, t.id), row(2, first.id, 12, t.id), row(3, second.id, 8, other.id)];
    const found = sourcesByTransaction(rows, new Map([first, second].map((b) => [b.id, b])));
    expect(found.get(t.id)?.map((s) => `${s.fileName}:${s.line}`)).toEqual(["october-1.csv:12", "october-2.csv:7"]);
    expect(found.get(other.id)?.map((s) => `${s.fileName}:${s.line}`)).toEqual(["october-2.csv:8"]);
  });

  it("leaves out rows that back nothing and rows of an undone import", () => {
    const t = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: -100 });
    const live = batch(1, "live.csv", "2026-10-31T10:00:00.000Z");
    const gone = batch(2, "gone.csv", "2026-11-03T09:00:00.000Z", true);
    const found = sourcesByTransaction([row(1, live.id, 1, null), row(2, gone.id, 2, t.id)], new Map([live, gone].map((b) => [b.id, b])));
    expect(found.get(t.id)).toBeUndefined();
  });

  it("matches a slow search of the rows for every transaction (property)", () => {
    fc.assert(
      fc.property(arbitraryFacts(), (facts) => {
        const found = sourcesByTransaction(facts.importRows.values(), facts.importBatches);
        for (const t of facts.transactions.values()) {
          const expected = [...facts.importRows.values()]
            .filter((r) => r.backs === t.id && facts.importBatches.get(r.batchId)?.undone === false)
            .map((r) => `${facts.importBatches.get(r.batchId)!.fileName}:${r.line}`)
            .sort();
          const got = (found.get(t.id) ?? []).map((s) => `${s.fileName}:${s.line}`).sort();
          expect(got).toEqual(expected);
        }
      }),
    );
  });
});

describe("the jobs a transaction can be given", () => {
  it("offers the active jobs by group and name, and leaves out paused and archived ones", () => {
    const t = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: -100 });
    expect(pickableJobsFor(w.facts, t).map((j) => `${j.groupName}/${j.name}`)).toEqual(["Fixed costs/Electricity", "Fixed costs/Insurance", "Living/Buffer", "Living/Food"]);
  });

  it("keeps the job a transaction already has, even when it is paused", () => {
    const t = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: -100, treatment: splitTo(-100, w.jobs.paused) });
    expect(pickableJobsFor(w.facts, t).map((j) => j.name)).toContain("Union fees");
  });
});

describe("the actions on a transaction", () => {
  const out = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: -100 });
  const moneyIn = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: 5_000 });

  it("offers a refund and income only for money in", () => {
    expect(availableActions(out)).not.toContain("refund");
    expect(availableActions(out)).not.toContain("income");
    expect(availableActions(moneyIn)).toEqual(expect.arrayContaining<ActionId>(["refund", "income"]));
  });

  it("does not offer 'needs you again' for what already needs you, nor history for what is history", () => {
    expect(availableActions(out)).not.toContain("needsYou");
    expect(availableActions({ ...out, treatment: splitTo(-100, w.jobs.food) })).toContain("needsYou");
    expect(availableActions({ ...out, treatment: { kind: "history", jobId: null } })).not.toContain("history");
    expect(availableActions(out)).toContain("history");
  });

  it("always offers splitting, marking a transfer and a note, and changing the job for money out", () => {
    expect(availableActions(out)).toEqual(expect.arrayContaining<ActionId>(["changeJob", "split", "transfer", "note"]));
    expect(availableActions(moneyIn)).toEqual(expect.arrayContaining<ActionId>(["split", "transfer", "note"]));
  });

  it("gives money in a refund against a job in place of a plain job", () => {
    expect(availableActions(moneyIn)).not.toContain("changeJob");
    expect(actionLabel("refund", moneyIn)).toBe("browse.action.refund");
    expect(actionLabel("refund", { ...moneyIn, treatment: splitTo(5_000, w.jobs.food) })).toBe("browse.action.changeRefund");
  });

  it("words 'choose' for a transaction without a job and 'change' for one with a job", () => {
    expect(actionLabel("changeJob", out)).toBe("browse.action.chooseJob");
    expect(actionLabel("changeJob", { ...out, treatment: splitTo(-100, w.jobs.food) })).toBe("browse.action.changeJob");
    expect(actionLabel("transfer", { ...out, treatment: { kind: "transfer", partner: null } })).toBe("browse.action.changePartner");
    expect(actionLabel("note", out)).toBe("browse.action.addNote");
    expect(actionLabel("note", { ...out, note: "x" })).toBe("browse.action.editNote");
  });
});

describe("what each action does to the transaction (through core)", () => {
  const out = transaction({ accountId: w.accounts.everyday, date: "2026-10-05", amount: -84_900 });
  const moneyIn = transaction({ accountId: w.accounts.everyday, date: "2026-10-06", amount: 25_000 });
  const facts = withTransactions(w.facts, out, moneyIn);

  it("gives the whole amount to one job", () => {
    const t = after(facts, jobCommand(out, w.jobs.food), out.id);
    expect(t.treatment).toMatchObject({ kind: "split", allocations: [{ jobId: w.jobs.food, amount: -84_900 }] });
  });

  it("records money in against a job as a refund, a split with money coming in, and never as income", () => {
    const t = after(facts, refundCommand(moneyIn, w.jobs.food), moneyIn.id);
    expect(t.treatment.kind).toBe("split");
    expect(t.treatment).toMatchObject({ allocations: [{ jobId: w.jobs.food, amount: 25_000 }] });
  });

  it("builds no refund for money out and no income for money out", () => {
    expect(refundCommand(out, w.jobs.food)).toBeNull();
    expect(incomeCommand(out, "2026-12" as never, "other")).toBeNull();
  });

  it("records money in that funds a month as income with its source", () => {
    const t = after(facts, incomeCommand(moneyIn, "2026-12" as never, "contribution"), moneyIn.id);
    expect(t.treatment).toEqual({ kind: "income", fundsMonth: "2026-12", source: "contribution" });
  });

  it("saves a split across jobs that adds up", () => {
    const allocations = [
      { jobId: w.jobs.insurance, amount: money(-50_000) },
      { jobId: w.jobs.electricity, amount: money(-34_900) },
    ] as const;
    const t = after(facts, splitCommand(out, allocations), out.id);
    expect(t.treatment).toMatchObject({ kind: "split", allocations: [...allocations] });
  });

  it("refuses a split that does not add up, in core's words", () => {
    const result = run(facts, splitCommand(out, [{ jobId: w.jobs.food, amount: money(-84_899) }]));
    expect(result.ok ? null : result.refusal.code).toBe("splitDoesNotAddUp");
  });

  it("takes the rule off a transaction when the family decides it", () => {
    const ruled = { ...out, treatment: splitTo(-84_900, w.jobs.food), ruleId: ruleId(testId(9)) };
    const withRule = { ...facts, rules: new Map([[ruleId(testId(9)), { id: ruleId(testId(9)), match: { counterparty: "x" }, result: { kind: "job" as const, jobId: w.jobs.food }, origin: "set" as const, priority: 0 }]]), transactions: new Map(facts.transactions).set(out.id, ruled) };
    const t = after(withRule, jobCommand(ruled, w.jobs.electricity), out.id);
    expect(t.ruleId).toBeUndefined();
  });

  it("sends a transaction back to needs you, and that is refused before the plan start", () => {
    const decided = { ...out, treatment: splitTo(-84_900, w.jobs.food) };
    const withDecided = withTransactions(facts, decided);
    expect(after(withDecided, needsYouCommand(decided), out.id).treatment).toEqual({ kind: "needsYou" });
    const old = transaction({ accountId: w.accounts.everyday, date: "2026-07-05", amount: -100, treatment: { kind: "history", jobId: null } });
    expect(refusedWith(withTransactions(facts, old), needsYouCommand(old))).toBe("notHistoryBeforePlanStart");
  });

  it("marks a transaction before the plan start as history, and refuses it from the plan start on", () => {
    const old = transaction({ accountId: w.accounts.everyday, date: "2026-07-05", amount: -100, treatment: { kind: "history", jobId: null } });
    expect(refusedWith(facts, historyCommand(out))).toBe("historyFromPlanStart");
    expect(refusedWith(withTransactions(facts, old), historyCommand(old))).toBeNull();
  });

  it("keeps the one job a transaction has when it becomes history", () => {
    const withJob = { ...out, treatment: splitTo(-84_900, w.jobs.food) };
    expect(historyCommand(withJob)).toMatchObject({ treatment: { kind: "history", jobId: w.jobs.food } });
    expect(historyCommand(out)).toMatchObject({ treatment: { kind: "history", jobId: null } });
  });

  it("saves a note trimmed, and an empty note removes it", () => {
    const noted = after(facts, noteCommand(out, "  Paid for the neighbour  "), out.id);
    expect(noted.note).toBe("Paid for the neighbour");
    const cleared = after(withTransactions(facts, noted), noteCommand(noted, "   "), out.id);
    expect(cleared.note).toBeUndefined();
  });
});

describe("the month income funds", () => {
  it("is the month after it arrives, and the choices reach two months back and three forward", () => {
    const t = { bookingDate: localDate("2026-11-20") };
    expect(defaultFundsMonth(t)).toBe("2026-12");
    expect(fundsMonthChoices(t)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(fundsMonthChoices(t)).toContain(defaultFundsMonth(t));
  });
});
