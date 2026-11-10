import { describe, expect, it } from "vitest";
import type { Facts, ImportRow, Transaction } from "../facts.ts";
import { type ImportBatchId, importBatchId, ruleId, transactionId } from "../ids.ts";
import { describeUndoImport } from "../import/undo-import.ts";
import { nearMatches } from "../import/near-matches.ts";
import { type ImportPlan, planImport } from "../import/plan.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { type RowSpec, commitPlan, importHousehold, importInput, numbers, statement, today } from "../testing/synthetic-statement.ts";
import { type ApplyResult, type Command, apply } from "./apply.ts";
import type { ImportCommand } from "./imports.ts";
import { importMessages } from "./imports.messages.ts";
import type { RefusalCode } from "./refusal.ts";

const run = (facts: Facts, command: Command): ApplyResult => apply(facts, command, { asOf: today });

function accepted(result: ApplyResult): Facts {
  if (!result.ok) throw new Error(`Refused (${result.refusal.code})`);
  return result.facts;
}

function codeOf(result: ApplyResult): RefusalCode | "accepted" {
  return result.ok ? "accepted" : result.refusal.code;
}

const unknown = transactionId(testId(999_999));
const shop = (date: string, description = "Kiwi Sentrum", amount = kr(-120)): RowSpec => ({ account: numbers.everyday, date, amount, description });
const transferRows = (date: string, amount = 2_000): RowSpec[] => [
  { account: numbers.everyday, date, amount: kr(-amount), description: "Overføring" },
  { account: numbers.savings, date, amount: kr(amount), description: "Overføring" },
];

/** The importFile command a plan starts with. */
function importCommandOf(plan: ImportPlan): Extract<ImportCommand, { kind: "importFile" }> {
  if (!plan.ok) throw new Error("expected a plan");
  const [first] = plan.command.commands;
  if (first?.kind !== "importFile") throw new Error("expected importFile first");
  return first;
}

function batchIdOf(plan: ImportPlan): ImportBatchId {
  if (!plan.ok) throw new Error("expected a plan");
  return plan.preview.batchId;
}

/** A household after one import: two Kiwi purchases, a needs-you row, and a transfer pair that completed a move. */
function imported() {
  const h = importHousehold();
  const handMade = h.builder.needsYou({ date: "2026-11-04", amount: kr(-300), description: "Bakeri" });
  const move = h.builder.move({ from: h.accounts.everyday, to: h.accounts.savings, amount: kr(2_000), month: "2026-11" });
  const before = h.facts();
  const plan = planImport(before, statement([shop("2026-11-02"), shop("2026-11-03", "Rema"), { ...shop("2026-11-04", "Bakeri", kr(-300)) }, ...transferRows("2026-11-05")]), importInput("first", 10_000));
  const facts = commitPlan(before, plan);
  if (!plan.ok) throw new Error("expected a plan");
  const [kiwi, rema, outgoing, incoming] = plan.preview.sample.map((s) => s.transactionId);
  return { h, before, facts, plan, batchId: plan.preview.batchId, handMade, move, kiwi: kiwi!, rema: rema!, outgoing: outgoing!, incoming: incoming! };
}

describe("importFile", () => {
  it("stores the batch, every row and the new transactions in one change", () => {
    const { facts, plan, before } = imported();
    const command = importCommandOf(plan);
    expect(facts.importBatches.get(command.batch.id)).toEqual(command.batch);
    expect(facts.importRows.size).toBe(5);
    expect(facts.transactions.size).toBe(before.transactions.size + 4);
  });

  it("refuses a command whose rows and transactions don't agree", () => {
    const h = importHousehold();
    h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum" });
    const facts = h.facts();
    const command = importCommandOf(planImport(facts, statement([shop("2026-11-02"), shop("2026-11-03")]), importInput("x", 10_000)));
    const [matchedRow, creatingRow] = command.rows as [ImportRow, ImportRow];
    const [created] = command.transactions as [Transaction];
    const tampered: readonly ImportCommand[] = [
      { ...command, rows: [matchedRow, { ...creatingRow, backs: unknown }] },
      { ...command, rows: [matchedRow, { ...creatingRow, backs: matchedRow.backs }] },
      { ...command, rows: [matchedRow, { ...creatingRow, pending: true }] },
      { ...command, rows: [{ ...matchedRow, backs: null }, creatingRow] },
      { ...command, transactions: [{ ...created, id: transactionId(testId(888_888)) }] },
      { ...command, rows: [matchedRow, { ...creatingRow, backs: transactionId(testId(888_888)) }], transactions: [{ ...created, id: transactionId(testId(888_888)) }] },
      { ...command, transactions: [{ ...created, amount: kr(-121) }] },
      { ...command, transactions: [{ ...created, treatment: { kind: "transfer", partner: null } }] },
      { ...command, batch: { ...command.batch, created: 2 } },
      { ...command, batch: { ...command.batch, matched: 0 } },
      { ...command, batch: { ...command.batch, to: command.batch.from } },
      { ...command, rows: [matchedRow, { ...creatingRow, batchId: importBatchId(testId(777_777)) }] },
    ];
    for (const bad of tampered) expect(codeOf(run(facts, bad))).toBe("importDisagrees");
    expect(codeOf(run(facts, command))).toBe("accepted");
  });

  it("refuses a file that backs one transaction with two rows, even when its counts agree", () => {
    const h = importHousehold();
    const first = h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum" });
    h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum" });
    const facts = h.facts();
    const command = importCommandOf(planImport(facts, statement([shop("2026-11-02"), shop("2026-11-02")]), importInput("x", 10_000)));
    const [one, two] = command.rows as [ImportRow, ImportRow];
    expect(codeOf(run(facts, { ...command, rows: [one, { ...two, backs: first }], batch: { ...command.batch, matched: 1 } }))).toBe("importDisagrees");
  });
});

describe("undoImport", () => {
  it("removes what the import brought, keeps what the family recorded by hand, reopens the move and lets go of the rows", () => {
    const { facts, before, batchId, handMade, move } = imported();
    const after = accepted(run(facts, { kind: "undoImport", batchId }));
    expect([...after.transactions.keys()]).toEqual([...before.transactions.keys()]);
    expect(after.transactions.get(handMade)).toEqual(before.transactions.get(handMade));
    expect(after.moves.get(move)).toMatchObject({ status: "todo", completedBy: null });
    expect(after.importBatches.get(batchId)?.undone).toBe(true);
    expect([...after.importRows.values()].every((r) => r.backs === null)).toBe(true);
  });

  it("previews the losses first: the transactions the family noted or treated, and those another import keeps", () => {
    const { facts, h, batchId, handMade, kiwi, rema, outgoing, incoming, move } = imported();
    const toFood = { kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-120) }] } as const;
    const noted = accepted(run(facts, { kind: "setNote", transactionId: kiwi, note: "For the party" }));
    const treated = accepted(run(noted, { kind: "batch", commands: [{ kind: "setTreatment", transactionId: kiwi, treatment: toFood }, { kind: "setTreatment", transactionId: rema, treatment: toFood }] }));
    const second = planImport(treated, statement([shop("2026-11-03", "Rema")]), importInput("second", 20_000));
    const both = commitPlan(treated, second);
    const result = describeUndoImport(both, batchId);
    expect(result).toEqual({
      ok: true,
      preview: {
        batchId,
        removed: [kiwi, outgoing, incoming].sort(),
        changedByYou: [{ transactionId: kiwi, changes: ["note", "treatment"] }],
        keptByAnotherImport: [rema],
        keptRecordedByHand: [handMade],
        movesBackToDo: [move],
        partnersUnlinked: [],
      },
    });
    expect(describeUndoImport(both, batchIdOf(second))).toMatchObject({ ok: true, preview: { removed: [], keptByAnotherImport: [rema] } });
  });

  it("leaves a transfer partner from another import waiting for its other side, and reopens the move the pair completed", () => {
    const h = importHousehold();
    const move = h.builder.move({ from: h.accounts.everyday, to: h.accounts.savings, amount: kr(2_000), month: "2026-11" });
    const first = planImport(h.facts(), statement([transferRows("2026-11-05")[0]!]), importInput("bank-a", 10_000));
    const one = commitPlan(h.facts(), first);
    const second = planImport(one, statement([transferRows("2026-11-05")[1]!]), importInput("bank-b", 20_000));
    const both = commitPlan(one, second);
    const [outgoing] = first.ok ? first.preview.sample.map((s) => s.transactionId) : [];
    expect(both.moves.get(move)).toMatchObject({ status: "done", completedBy: outgoing });
    const after = accepted(run(both, { kind: "undoImport", batchId: batchIdOf(second) }));
    expect(after.transactions.get(outgoing!)?.treatment).toEqual({ kind: "transfer", partner: null });
    expect(after.moves.get(move)).toMatchObject({ status: "todo", completedBy: null });
  });
});

describe("mergeTransactions", () => {
  it("points the dropped transaction's rows at the kept one and removes the dropped one, which ends the near match", () => {
    const h = importHousehold();
    const first = commitPlan(h.facts(), planImport(h.facts(), statement([shop("2026-11-02")]), importInput("one", 10_000)));
    const second = planImport(first, statement([shop("2026-11-03")]), importInput("two", 20_000));
    const both = commitPlan(first, second);
    const [keep] = [...first.transactions.keys()];
    const [drop] = second.ok ? second.preview.sample.map((s) => s.transactionId) : [];
    expect(nearMatches(both).get(drop!)).toBe(keep);
    const merged = accepted(run(both, { kind: "mergeTransactions", keep: keep!, drop: drop! }));
    expect(merged.transactions.has(drop!)).toBe(false);
    expect([...merged.importRows.values()].map((r) => r.backs)).toEqual([keep, keep]);
    expect(nearMatches(merged).size).toBe(0);
    const undone = accepted(run(merged, { kind: "undoImport", batchId: batchIdOf(second) }));
    expect(undone.transactions.has(keep!)).toBe(true);
  });

  it("moves a move at the bank that the dropped transaction completed over to the kept one", () => {
    const h = importHousehold();
    const keep = h.builder.needsYou({ date: "2026-11-02", amount: kr(-1_000), description: "Til sparing" });
    const drop = h.builder.needsYou({ date: "2026-11-03", amount: kr(-1_000), description: "Til sparing" });
    const move = h.builder.move({ from: h.accounts.everyday, to: h.accounts.savings, amount: kr(1_000), month: "2026-11" });
    const done = accepted(run(h.facts(), { kind: "setMoveStatus", moveId: move, status: "done", completedBy: drop }));
    const merged = accepted(run(done, { kind: "mergeTransactions", keep, drop }));
    expect(merged.moves.get(move)).toMatchObject({ status: "done", completedBy: keep });
  });
});

describe("pairTransfers", () => {
  it("pairs two transactions, completes the move it names, and drops the rule that no longer gives the treatment", () => {
    const h = importHousehold();
    const out = h.builder.needsYou({ date: "2026-11-02", amount: kr(-2_000) });
    const into = h.builder.needsYou({ accountId: h.accounts.savings, date: "2026-11-02", amount: kr(2_000) });
    const move = h.builder.move({ from: h.accounts.everyday, to: h.accounts.savings, amount: kr(2_000), month: "2026-11" });
    const base = h.facts();
    const facts = { ...base, transactions: new Map([...base.transactions].map(([id, t]) => [id, id === out ? { ...t, ruleId: ruleId(testId(70_001)) } : t])) };
    const after = accepted(run(facts, { kind: "pairTransfers", pairs: [{ a: into, b: out, completesMove: move }] }));
    expect(after.transactions.get(out)).toMatchObject({ treatment: { kind: "transfer", partner: into } });
    expect(after.transactions.get(out)?.ruleId).toBeUndefined();
    expect(after.moves.get(move)).toMatchObject({ status: "done", completedBy: out });
  });
});

describe("import refusals", () => {
  const reach: { readonly [C in keyof typeof importMessages]: () => ApplyResult } = {
    importFingerprintLive: () => {
      const { facts } = imported();
      const h = importHousehold();
      return run(facts, importCommandOf(planImport(h.facts(), statement([shop("2026-11-20")]), importInput("first", 30_000))));
    },
    importDisagrees: () => {
      const h = importHousehold();
      const command = importCommandOf(planImport(h.facts(), statement([shop("2026-11-02")]), importInput("x", 10_000)));
      return run(h.facts(), { ...command, batch: { ...command.batch, rows: 9 } });
    },
    importNotFound: () => run(importHousehold().facts(), { kind: "undoImport", batchId: importBatchId(testId(999_998)) }),
    importAlreadyUndone: () => {
      const { facts, batchId } = imported();
      return run(accepted(run(facts, { kind: "undoImport", batchId })), { kind: "undoImport", batchId });
    },
    mergeSameTransaction: () => {
      const { facts, kiwi } = imported();
      return run(facts, { kind: "mergeTransactions", keep: kiwi, drop: kiwi });
    },
    mergeMismatch: () => {
      const { facts, kiwi, handMade } = imported();
      return run(facts, { kind: "mergeTransactions", keep: handMade, drop: kiwi });
    },
    mergeSameFile: () => {
      const { facts, kiwi, rema } = imported();
      return run(facts, { kind: "mergeTransactions", keep: kiwi, drop: rema });
    },
    transferSameAccount: () => {
      const { facts, kiwi, rema } = imported();
      return run(facts, { kind: "pairTransfers", pairs: [{ a: kiwi, b: rema }] });
    },
    transferAmountsDiffer: () => {
      const { facts, kiwi, incoming } = imported();
      return run(facts, { kind: "pairTransfers", pairs: [{ a: kiwi, b: incoming }] });
    },
    transferAlreadyPaired: () => {
      const { h, facts, incoming } = imported();
      const another: Transaction = { id: transactionId(testId(555_555)), accountId: h.accounts.everyday, bookingDate: today, amount: kr(-2_000), description: "Til sparing", treatment: { kind: "needsYou" } };
      return run({ ...facts, transactions: new Map([...facts.transactions, [another.id, another]]) }, { kind: "pairTransfers", pairs: [{ a: another.id, b: incoming }] });
    },
    moveDoesNotMatch: () => {
      const h = importHousehold();
      const out = h.builder.needsYou({ date: "2026-11-02", amount: kr(-2_000) });
      const into = h.builder.needsYou({ accountId: h.accounts.savings, date: "2026-11-02", amount: kr(2_000) });
      const move = h.builder.move({ from: h.accounts.savings, to: h.accounts.everyday, amount: kr(2_000), month: "2026-11" });
      return run(h.facts(), { kind: "pairTransfers", pairs: [{ a: out, b: into, completesMove: move }] });
    },
  };

  it.each(Object.keys(reach) as (keyof typeof importMessages)[])("the app can refuse with %s", (code) => {
    expect(codeOf(reach[code]())).toBe(code);
  });

  it("refuses commands that name what isn't there", () => {
    const { facts, kiwi, outgoing, incoming, move } = imported();
    expect(codeOf(run(facts, { kind: "mergeTransactions", keep: kiwi, drop: unknown }))).toBe("transactionNotFound");
    expect(codeOf(run(facts, { kind: "pairTransfers", pairs: [{ a: unknown, b: kiwi }] }))).toBe("transactionNotFound");
    expect(codeOf(run(facts, { kind: "pairTransfers", pairs: [{ a: outgoing, b: incoming, completesMove: move }] }))).toBe("moveNotToDo");
  });

  it("refuses to pair transactions from before the plan start, which are history", () => {
    const h = importHousehold();
    const out = h.builder.history({ date: "2026-09-02", amount: kr(-2_000) });
    const into = h.builder.history({ accountId: h.accounts.savings, date: "2026-09-02", amount: kr(2_000) });
    expect(codeOf(run(h.facts(), { kind: "pairTransfers", pairs: [{ a: out, b: into }] }))).toBe("notHistoryBeforePlanStart");
  });

  it("gives each import refusal a message that names who acts", () => {
    for (const message of Object.values(importMessages)) expect(message).toMatch(/^(The app|You)/);
  });
});
