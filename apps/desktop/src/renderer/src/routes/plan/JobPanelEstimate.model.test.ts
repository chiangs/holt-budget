import { type EstimateBasis, type EstimateMonth, type JobHistory, type Month, jobEstimate, jobHistory, money } from "@holt/core";
import { followBills, kr } from "@holt/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbitraryVariableCost } from "../../../../../../../packages/core/src/testing/variable-cost-household.ts";
import { electricityHousehold, electricityToday } from "../../../../../../../packages/core/src/testing/electricity-household.ts";
import { type ExplainLine, lineOf, recentLineOf, workingOf } from "./JobPanelEstimate.model.ts";

function electricity(options: Parameters<typeof electricityHousehold>[0] = {}) {
  const world = electricityHousehold({ plan: followBills(), ...options });
  const history = jobHistory(world.facts, world.jobs.electricity, electricityToday);
  const estimate = jobEstimate(world.facts, world.jobs.electricity, electricityToday);
  if (history === null || estimate === null) throw new Error("No history or estimate");
  return { ...world, history, estimate };
}

const coverage = (lines: readonly ExplainLine[]): Month[] =>
  lines.flatMap((line) => {
    if (line.kind === "history") return [];
    if (line.kind === "enteredByYou" || line.kind === "nearestMonths") return [line.month];
    const months: Month[] = [];
    for (let m = line.from; m <= line.to; m = nextMonth(m)) months.push(m);
    return months;
  });

function nextMonth(m: Month): Month {
  const [year, number] = m.split("-").map(Number) as [number, number];
  return (number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`) as Month;
}

describe("how Electricity was estimated, as in the Plan mockup", () => {
  const { history, estimate } = electricity();
  const { lines } = workingOf(history, estimate);

  it("starts with the months of history the estimates are made from", () => {
    expect(lines[0]).toEqual({ kind: "history", from: "2026-01", to: "2026-10", months: 10 });
  });

  it("says November is about the same as March, and December the average of January and February, and that both are rough", () => {
    const november = lines.find((l) => l.kind === "nearestMonths" && l.month === "2026-11");
    const december = lines.find((l) => l.kind === "nearestMonths" && l.month === "2026-12");
    expect(november).toMatchObject({ amount: kr(3_300), rough: true, comparable: [{ month: "2026-03", amount: kr(3_300) }] });
    expect(december).toMatchObject({ amount: kr(4_200), rough: true, comparable: [{ month: "2026-01" }, { month: "2026-02" }] });
  });

  it("says January to October are the same month a year earlier, as one line, with no trend until there are six months to compare", () => {
    expect(lines.at(-1)).toEqual({ kind: "sameMonthLastYear", from: "2027-01", to: "2027-10", trend: null, rough: false });
    expect(lines).toHaveLength(4);
  });

  it("covers each of the twelve months once, in order, whatever the way they were estimated", () => {
    expect(coverage(lines)).toEqual(estimate.months.map((m) => m.month));
  });
});

describe("a month the family typed", () => {
  it("says it is the family's figure and what the app's own would have been", () => {
    const { facts, jobs, estimate } = electricity();
    const first = estimate.months[0] as EstimateMonth;
    const overridden: EstimateMonth = { ...first, estimate: { ...first.estimate, method: "enteredByYou", amount: kr(3_000) }, basis: { kind: "enteredByYou" }, appsOwn: first.estimate };
    expect(lineOf(overridden)).toEqual({ kind: "enteredByYou", month: first.month, amount: kr(3_000), appsOwn: first.estimate.amount });
    expect(facts.jobs.has(jobs.electricity)).toBe(true);
  });
});

describe("every way an estimate can be made", () => {
  const base = electricity().estimate.months[0] as EstimateMonth;
  const used = (m: string, a: number) => ({ month: m as Month, amount: kr(a) });
  const bases: readonly EstimateBasis[] = [
    { kind: "enteredByYou" },
    { kind: "fixed" },
    { kind: "plannedItems" },
    { kind: "noHistory" },
    { kind: "average", months: [used("2026-05", 100)] },
    { kind: "sameMonthLastYear", lastYear: used("2025-11", 100), trend: null },
    { kind: "nearestMonths", peak: used("2026-01", 400), comparable: [used("2026-03", 300)] },
    { kind: "unexplained" },
  ];

  it("has a line for each kind of basis, naming the same month", () => {
    for (const basis of bases) {
      const line = lineOf({ ...base, basis });
      expect(line.kind).toBe(basis.kind);
    }
    expect(new Set(bases.map((b) => b.kind)).size).toBe(8);
  });
});

describe("the last three months", () => {
  it("says what was planned each month, what was paid and how far under that is in total", () => {
    const { history } = electricity();
    expect(recentLineOf(history)).toEqual({ months: 3, planned: { kind: "same", amount: kr(2_900) }, paid: [kr(2_760), kr(2_910), kr(2_846)], underBy: kr(184) });
  });

  it("says over, as a negative amount, when more was paid than planned", () => {
    const { history } = electricity({ assignedBefore: "matchingBills", plan: followBills() });
    const line = recentLineOf(history);
    expect(line?.planned).toEqual({ kind: "each", amounts: [kr(2_760), kr(2_910), kr(2_846)] });
    expect(line?.underBy).toBe(kr(0));
    const over: JobHistory = { ...history, recent: { ...history.recent, underBy: money(-5_000) } };
    expect(recentLineOf(over)?.underBy).toBe(money(-5_000));
  });

  it("has no line for a job with no month behind it, and compares nothing for a month before the plan began", () => {
    const { history } = electricity();
    expect(recentLineOf({ ...history, recent: { months: [], planned: money(0), paid: money(0), underBy: money(0) } })).toBeNull();
    const early = { ...history, recent: { ...history.recent, months: history.recent.months.map((m, i) => (i === 0 ? { ...m, planned: null } : m)) } };
    expect(recentLineOf(early)).toMatchObject({ planned: { kind: "none" }, underBy: null });
  });
});

describe("for any household around a variable cost", () => {
  it("covers every month of the estimate exactly once and never more lines than months", () => {
    let seen = 0;
    fc.assert(
      fc.property(arbitraryVariableCost(), (c) => {
        const history = jobHistory(c.facts, c.job, c.asOf);
        const estimate = jobEstimate(c.facts, c.job, c.asOf);
        if (history === null || estimate === null || estimate.months.length === 0) return;
        seen += 1;
        const { lines } = workingOf(history, estimate);
        expect(coverage(lines)).toEqual(estimate.months.map((m) => m.month));
        expect(lines.filter((l) => l.kind !== "history").length).toBeLessThanOrEqual(estimate.months.length);
        const unexplained = lines.some((l) => l.kind === "unexplained");
        expect(unexplained, "core never gives a basis it cannot explain").toBe(false);
      }),
      { numRuns: 200 },
    );
    expect(seen).toBeGreaterThan(50);
  });
});
