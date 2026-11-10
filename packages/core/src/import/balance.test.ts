import { describe, expect, it } from "vitest";
import { localDate } from "../dates.ts";
import { kr } from "../testing/facts-builder.ts";
import { type RowSpec, commitPlan, importHousehold, importInput, numbers, statement, today } from "../testing/synthetic-statement.ts";
import { balanceCheck } from "./balance.ts";
import { planImport } from "./plan.ts";

const row = (date: string, amount: number, description = "Kiwi", pending = false): RowSpec => ({ account: numbers.everyday, date, amount: kr(amount), description, pending });

/** Everyday opens on 31 August with 10,000 kr. */
function household() {
  const h = importHousehold();
  return { h, facts: h.facts(), everyday: h.accounts.everyday };
}

describe("balanceCheck", () => {
  it("doesn't check an account without a balance the family typed", () => {
    const { facts, everyday } = household();
    expect(balanceCheck(facts, everyday, undefined)).toEqual({ kind: "notChecked", accountId: everyday });
  });

  it("compares the typed balance with the balance on its date, counting only transactions booked by then", () => {
    const { facts, everyday } = household();
    const after = commitPlan(facts, planImport(facts, statement([row("2026-09-02", -400), row("2026-09-20", -100)]), importInput("one", 10_000)));
    expect(balanceCheck(after, everyday, { value: kr(9_600), asOf: localDate("2026-09-10") })).toEqual({
      kind: "matches",
      accountId: everyday,
      asOf: "2026-09-10",
      entered: kr(9_600),
      calculated: kr(9_600),
    });
    expect(balanceCheck(after, everyday, { value: kr(9_600), asOf: today })).toMatchObject({ kind: "differs", calculated: kr(9_500), difference: kr(100) });
  });

  it("lists the likely causes of a difference: a gap between imports, a near duplicate, the latest file's pending rows and a move still to do", () => {
    const { h, everyday } = household();
    const move = h.builder.move({ from: everyday, to: h.accounts.savings, amount: kr(1_000), month: "2026-10" });
    h.builder.move({ from: everyday, to: h.accounts.savings, amount: kr(1_000), month: "2026-12" });
    const byHand = h.builder.needsYou({ date: "2026-10-12", amount: kr(-100), description: "Bakeri" });
    const facts = h.facts();
    const september = commitPlan(facts, planImport(facts, statement([row("2026-09-01", -100), row("2026-09-30", -100), row("2026-09-30", -20, "Kiosk", true)]), importInput("september", 10_000)));
    const plan = planImport(september, statement([row("2026-10-10", -100), row("2026-10-11", -100, "Bakeri"), row("2026-10-31", -55, "Rema", true)]), {
      ...importInput("october", 20_000),
      importedAt: "2026-11-09T11:00:00Z",
    });
    const october = commitPlan(september, plan);
    const [, imported] = plan.ok ? plan.preview.sample.map((s) => s.transactionId) : [];
    const check = balanceCheck(october, everyday, { value: kr(9_000), asOf: today });
    const pendingRows = [...october.importRows.values()].filter((r) => r.pending && r.batchId === (plan.ok ? plan.preview.batchId : null)).map((r) => r.id);
    expect(check).toEqual({
      kind: "differs",
      accountId: everyday,
      asOf: today,
      entered: kr(9_000),
      calculated: kr(9_500),
      difference: kr(-500),
      causes: [
        { kind: "gap", from: "2026-10-01", to: "2026-10-09" },
        { kind: "nearDuplicate", transactionId: byHand, of: imported },
        { kind: "nearDuplicate", transactionId: imported, of: byHand },
        { kind: "pending", rows: pendingRows, amount: kr(-55) },
        { kind: "moveToDo", moveId: move },
      ],
    });
  });

  it("names the period before the first import as a gap, from the day after the opening balance", () => {
    const { facts, everyday } = household();
    const after = commitPlan(facts, planImport(facts, statement([row("2026-10-05", -100)]), importInput("late", 10_000)));
    expect(balanceCheck(after, everyday, { value: kr(1), asOf: today })).toMatchObject({ causes: [{ kind: "gap", from: "2026-09-01", to: "2026-10-04" }] });
  });
});
