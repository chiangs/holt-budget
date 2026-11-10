import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addMonths, localDate, month } from "../dates.ts";
import { arbitraryHousehold } from "../testing/arbitrary-facts.ts";
import { averageEstimate } from "../testing/estimates.ts";
import { factsBuilder, kr, monthlySaving, setAmount } from "../testing/facts-builder.ts";
import { jobIn, monthIn, signed } from "../testing/read-figures.ts";
import { computeFigures } from "./index.ts";

const figuresOf = (b: ReturnType<typeof factsBuilder>, asOf: string) => computeFigures(b.facts(), localDate(asOf), { estimate: averageEstimate });

describe("money available (rule 4, decision 1)", () => {
  it("is the income whose funds month is this month, whenever it arrived, and the plan start carries nothing in", () => {
    const b = factsBuilder();
    b.account({ openingBalance: kr(50_000) });
    const food = b.spendJob({ plan: setAmount(kr(14_000)) });
    b.budgetMonth("2026-01");
    b.assign("2026-01", food, kr(14_000));
    b.income({ date: "2025-12-20", amount: kr(60_000), fundsMonth: "2026-01" });
    b.income({ date: "2026-01-05", amount: kr(1_500), fundsMonth: "2026-01" });

    const january = monthIn(figuresOf(b, "2026-01-15"), "2026-01");
    expect(january.carriedIn).toBe(0);
    expect(january.income).toBe(kr(61_500));
    expect(january.available).toBe(kr(61_500));
    expect(january.assigned).toBe(kr(14_000));
    expect(january.unassigned).toEqual({ kind: "unassigned", amount: kr(47_500) });
  });

  it("carries unassigned money forward with the leftovers the ended month returned", () => {
    const b = factsBuilder();
    const food = b.spendJob({ plan: setAmount(kr(14_000)) });
    b.budgetMonth("2026-01");
    b.budgetMonth("2026-02");
    b.assign("2026-01", food, kr(14_000));
    b.assign("2026-02", food, kr(14_000));
    b.income({ date: "2025-12-20", amount: kr(60_000), fundsMonth: "2026-01" });
    b.income({ date: "2026-01-20", amount: kr(10_000), fundsMonth: "2026-02" });
    b.spend({ date: "2026-01-10", amount: kr(-13_000), jobId: food });

    const figures = figuresOf(b, "2026-02-10");
    expect(monthIn(figures, "2026-01").returned).toBe(kr(1_000));
    const february = monthIn(figures, "2026-02");
    expect(february.carriedIn).toBe(kr(46_000 + 1_000));
    expect(february.available).toBe(kr(57_000));
    expect(february.unassigned).toEqual({ kind: "unassigned", amount: kr(43_000) });
  });

  it("shows over-assigned money and doesn't carry it into the next month", () => {
    const b = factsBuilder();
    const holidays = b.saveUpJob({ target: monthlySaving(kr(10_500)) });
    b.budgetMonth("2026-01");
    b.budgetMonth("2026-02");
    b.assign("2026-01", holidays, kr(10_500));
    b.assign("2026-02", holidays, kr(4_000));
    b.income({ date: "2025-12-20", amount: kr(10_000), fundsMonth: "2026-01" });
    b.income({ date: "2026-01-20", amount: kr(10_000), fundsMonth: "2026-02" });

    const figures = figuresOf(b, "2026-02-10");
    expect(monthIn(figures, "2026-01").unassigned).toEqual({ kind: "overAssigned", amount: kr(500) });
    expect(monthIn(figures, "2026-02").carriedIn).toBe(0);
    expect(monthIn(figures, "2026-02").unassigned).toEqual({ kind: "unassigned", amount: kr(6_000) });
  });

  it("counts a planned month's projections as assigned", () => {
    const b = factsBuilder();
    b.spendJob({ plan: setAmount(kr(14_200)) });
    b.saveUpJob({ target: monthlySaving(kr(3_000)) });
    b.income({ date: "2026-01-20", amount: kr(16_000), fundsMonth: "2026-02" });

    const february = monthIn(figuresOf(b, "2026-01-25"), "2026-02");
    expect(february.state).toBe("planned");
    expect(february.assigned).toBe(kr(17_200));
    expect(february.unassigned).toEqual({ kind: "overAssigned", amount: kr(1_200) });
  });

  it("covers the plan start to twelve months after the current month, each marked ended, current or ahead", () => {
    const b = factsBuilder();
    const figures = figuresOf(b, "2026-03-15");
    const keys = [...figures.months.keys()];
    expect(keys[0]).toBe("2026-01");
    expect(keys.at(-1)).toBe("2027-03");
    expect(keys).toHaveLength(15);
    expect([monthIn(figures, "2026-02").timing, monthIn(figures, "2026-03").timing, monthIn(figures, "2026-04").timing]).toEqual(["ended", "current", "ahead"]);
    expect(computeFigures(b.facts(), localDate("2026-03-15"), { estimate: averageEstimate, horizonMonths: 2 }).months.size).toBe(5);
  });
});

describe("rule 4 holds for any plan", () => {
  it("unassigned is money available less assigned, over-assigned is shown, and only what is left over carries", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), ({ facts, asOf }) => {
        const figures = computeFigures(facts, asOf, { estimate: averageEstimate });
        const incomeByMonth = new Map<string, number>();
        for (const t of facts.transactions.values()) {
          if (t.treatment.kind === "income" && t.bookingDate <= asOf) incomeByMonth.set(t.treatment.fundsMonth, (incomeByMonth.get(t.treatment.fundsMonth) ?? 0) + t.amount);
        }

        let expectedCarriedIn = 0;
        for (const [m, figuresForMonth] of figures.months) {
          const jobsAssigned = [...figuresForMonth.jobs.values()].reduce((sum, j) => sum + j.assigned.amount, 0);
          const jobsReturned = [...figuresForMonth.jobs.values()].reduce((sum, j) => sum + (j.money.kind === "returned" ? j.money.amount : 0), 0);
          expect(figuresForMonth.carriedIn).toBe(expectedCarriedIn);
          expect(figuresForMonth.income).toBe(incomeByMonth.get(m) ?? 0);
          expect(figuresForMonth.available).toBe(figuresForMonth.carriedIn + figuresForMonth.income);
          expect(figuresForMonth.assigned).toBe(jobsAssigned);
          expect(signed(figuresForMonth.unassigned)).toBe(figuresForMonth.available - jobsAssigned);
          if (jobsAssigned > figuresForMonth.available) expect(figuresForMonth.unassigned).toEqual({ kind: "overAssigned", amount: jobsAssigned - figuresForMonth.available });
          expect(figuresForMonth.returned).toBe(jobsReturned);
          expectedCarriedIn = Math.max(0, signed(figuresForMonth.unassigned)) + jobsReturned;
        }
      }),
    );
  });

  it("assigns every job in every month", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), ({ facts, asOf, jobs }) => {
        const figures = computeFigures(facts, asOf, { estimate: averageEstimate });
        for (const m of figures.months.keys()) {
          for (const job of jobs) expect(jobIn(figures, job, m).month).toBe(m);
        }
        expect(figures.months.has(addMonths(month(asOf.slice(0, 7)), 12))).toBe(true);
      }),
    );
  });
});
