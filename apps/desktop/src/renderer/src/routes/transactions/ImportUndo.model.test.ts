import { type Facts, type ImportBatchId, type TransactionId, apply, planImport, transactionId } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { firstOf, undoView } from "./ImportUndo.model.ts";
import { type RowSpec, commitPlan, importHousehold, importInput, numbers, statement, today } from "./ImportTestKit.ts";

const shop = (date: string, description = "Kiwi Sentrum", amount = kr(-120)): RowSpec => ({ account: numbers.everyday, date, amount, description });
const transferRows = (date: string): RowSpec[] => [
  { account: numbers.everyday, date, amount: kr(-2_000), description: "Overføring" },
  { account: numbers.savings, date, amount: kr(2_000), description: "Overføring" },
];
const run = (facts: Facts, ...commands: Parameters<typeof apply>[1][]): Facts =>
  commands.reduce((now, command) => {
    const result = apply(now, command, { asOf: today });
    if (!result.ok) throw new Error(`Refused: ${result.refusal.code}`);
    return result.facts;
  }, facts);

/** The household after one import of a Kiwi purchase, a Rema purchase, a Bakeri purchase the family had recorded by hand, and a transfer that completed a move. */
function world() {
  const h = importHousehold();
  const handMade = h.builder.needsYou({ date: "2026-11-04", amount: kr(-300), description: "Bakeri" });
  const move = h.builder.move({ from: h.accounts.everyday, to: h.accounts.savings, amount: kr(2_000), month: "2026-11", reason: "Fill the buffer" });
  const before = h.facts();
  const plan = planImport(before, statement([shop("2026-11-02"), shop("2026-11-03", "Rema"), shop("2026-11-04", "Bakeri", kr(-300)), ...transferRows("2026-11-05")]), importInput("first", 10_000));
  if (!plan.ok) throw new Error("expected a plan");
  const ids = (description: string): TransactionId => {
    const found = plan.preview.sample.find((l) => l.description === description);
    if (found === undefined) throw new Error(`no ${description}`);
    return found.transactionId;
  };
  return { h, facts: commitPlan(before, plan), batchId: plan.preview.batchId, handMade, move, kiwi: ids("Kiwi Sentrum"), rema: ids("Rema") };
}

const described = (facts: Facts, batchId: ImportBatchId) => {
  const result = undoView(facts, batchId);
  if (!result.ok) throw new Error(`Refused: ${result.refusal.code}`);
  return result.view;
};

describe("what undoing an import would do", () => {
  it("counts what it removes and what the family has not touched", () => {
    const { facts, batchId } = world();
    const view = described(facts, batchId);
    expect(view.removed).toBe(4);
    expect(view.changed).toEqual([]);
    expect(view.fileName).toBe("first.csv");
  });

  it("lists first what the family changed since: a note, a job, or both", () => {
    const { facts, batchId, h, kiwi, rema } = world();
    const toFood = { kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-120) }] } as const;
    const changed = run(facts, { kind: "setNote", transactionId: kiwi, note: "For the party" }, { kind: "setTreatment", transactionId: kiwi, treatment: toFood }, { kind: "setTreatment", transactionId: rema, treatment: toFood });
    const view = described(changed, batchId);
    expect(view.changed.map((c) => [c.description, c.date, c.amount, c.changes])).toEqual([
      ["Kiwi Sentrum", "2026-11-02", kr(-120), ["note", "treatment"]],
      ["Rema", "2026-11-03", kr(-120), ["treatment"]],
    ]);
    expect(view.removed).toBe(4);
  });

  it("says which transactions stay: one another import also holds, and one the family recorded by hand", () => {
    const { facts, batchId, handMade, rema } = world();
    const second = planImport(facts, statement([shop("2026-11-03", "Rema")]), importInput("second", 20_000));
    const view = described(commitPlan(facts, second), batchId);
    expect(view.keptByAnotherImport.map((l) => l.transactionId)).toEqual([rema]);
    expect(view.keptRecordedByHand.map((l) => l.transactionId)).toEqual([handMade]);
    expect(view.removed).toBe(3);
  });

  it("names the move at the bank that goes back to to do, with its accounts", () => {
    const { facts, batchId, move } = world();
    const [line] = described(facts, batchId).moves;
    expect(line).toMatchObject({ moveId: move, month: "2026-11", amount: kr(2_000), from: "Everyday", to: "Savings", reason: "Fill the buffer" });
  });

  it("names a transfer that stays but loses the partner that goes", () => {
    const h = importHousehold();
    const one = commitPlan(h.facts(), planImport(h.facts(), statement([transferRows("2026-11-05")[0]!]), importInput("a", 10_000)));
    const secondPlan = planImport(one, statement([transferRows("2026-11-05")[1]!]), importInput("b", 20_000));
    if (!secondPlan.ok) throw new Error("expected a plan");
    const both = commitPlan(one, secondPlan);
    const first = [...both.importBatches.values()].find((b) => b.fileName === "a.csv");
    const view = described(both, secondPlan.preview.batchId);
    expect(view.partners).toHaveLength(1);
    expect(view.partners[0]?.description).toBe("Overføring");
    expect(first).toBeDefined();
  });

  it("matches what the undo command then does to the facts", () => {
    const { facts, batchId } = world();
    const view = described(facts, batchId);
    const after = run(facts, { kind: "undoImport", batchId });
    expect(facts.transactions.size - after.transactions.size).toBe(view.removed);
  });

  it("refuses an import that is already undone or unknown, in core's words", () => {
    const { facts, batchId } = world();
    const undone = run(facts, { kind: "undoImport", batchId });
    const again = undoView(undone, batchId);
    expect(again).toMatchObject({ ok: false, refusal: { code: "importAlreadyUndone" } });
    expect(undoView(facts, transactionId(testId(999)) as never)).toMatchObject({ ok: false, refusal: { code: "importNotFound" } });
  });
});

describe("a long list", () => {
  it("shows the first few and says how many more there are", () => {
    expect(firstOf([1, 2, 3, 4, 5, 6, 7], 5)).toEqual({ shown: [1, 2, 3, 4, 5], more: 2 });
    expect(firstOf([1, 2], 5)).toEqual({ shown: [1, 2], more: 0 });
  });
});
