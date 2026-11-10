import { describe, expect, it } from "vitest";
import { computeFigures } from "../figures/index.ts";
import { averageEstimate } from "./estimates.ts";
import { signed } from "./read-figures.ts";
import { syntheticYear } from "./synthetic-year.ts";

describe("the synthetic year", () => {
  const { facts, asOf } = syntheticYear();

  it("has the size the benchmark promises: 6 accounts, 40 jobs and 3,000 to 5,000 transactions with every treatment", () => {
    expect(facts.accounts.size).toBe(6);
    expect(facts.jobs.size).toBe(40);
    expect(facts.transactions.size).toBeGreaterThanOrEqual(3_000);
    expect(facts.transactions.size).toBeLessThanOrEqual(5_000);
    const treatments = new Set([...facts.transactions.values()].map((t) => t.treatment.kind));
    expect([...treatments].sort()).toEqual(["history", "income", "needsYou", "split", "transfer"]);
  });

  it("assigns every job in every open or closed month", () => {
    expect(facts.budgetMonths.size).toBe(12);
    expect(facts.assignments.size).toBe(12 * 40);
  });

  it("is the same every time", () => {
    expect(syntheticYear()).toEqual({ facts, asOf });
  });

  it("works out figures that keep rules 4 and 6", () => {
    const figures = computeFigures(facts, asOf, { estimate: averageEstimate });
    for (const m of figures.months.values()) expect(signed(m.unassigned)).toBe(m.available - m.assigned);
    for (const account of figures.accounts.values()) {
      const remainder = account.remainder.kind === "unbucketed" ? account.remainder.amount : -account.remainder.amount;
      expect(account.bucketed + remainder).toBe(account.balance.amount);
    }
    expect(figures.staleEnteredValues.map((s) => s.value.subject)).toEqual(["House"]);
  });
});
