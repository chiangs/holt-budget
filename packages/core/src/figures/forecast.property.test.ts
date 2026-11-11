import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkFacts } from "../commands/check-facts.ts";
import { addMonths, monthRange } from "../dates.ts";
import { keepsMoney } from "../figures/jobs.ts";
import { arbitraryVariableCost, snapshotOf } from "../testing/variable-cost-household.ts";
import { forecastMonths, jobForecast } from "./forecast.ts";
import { computeFigures } from "./index.ts";
import { historyMonths, jobHistory } from "./job-history.ts";
import { jobEstimate } from "./job-estimate.ts";

const runs = { numRuns: 300 };

describe("the random households", () => {
  it("are sound, and reach the cases the properties below are about", () => {
    const seen = { keepers: 0, spendJobs: 0, planned: 0, closed: 0, overrides: 0, spentThisMonth: 0, transfers: 0, dry: 0, preplan: 0 };
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job, current }) => {
        expect(checkFacts(facts).filter((v) => v.code !== "noBuffer")).toEqual([]);
        const found = facts.jobs.get(job);
        if (found !== undefined && keepsMoney(found)) seen.keepers += 1;
        if (found?.kind === "spend") seen.spendJobs += 1;
        const state = facts.budgetMonths.get(current)?.state;
        if (state === undefined) seen.planned += 1;
        if (state === "closed") seen.closed += 1;
        if ([...facts.enteredValues.values()].some((v) => v.kind === "estimateOverride")) seen.overrides += 1;
        if ([...facts.transactions.values()].some((t) => t.bookingDate.startsWith(current) && t.treatment.kind === "split")) seen.spentThisMonth += 1;
        if (facts.bucketTransfers.size > 0) seen.transfers += 1;
        if ([...facts.transactions.values()].some((t) => t.treatment.kind === "history")) seen.preplan += 1;
        if (jobForecast(facts, job, asOf)?.runsDryIn != null) seen.dry += 1;
      }),
      { numRuns: 400 },
    );
    for (const [what, count] of Object.entries(seen)) expect(count, what).toBeGreaterThan(15);
  });
});

describe("a forecast, in any household", () => {
  it("agrees with the figures: the same plan each month, and a bucket that differs only by the bills still to come", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job }) => {
        const forecast = jobForecast(facts, job, asOf);
        const found = facts.jobs.get(job);
        expect(forecast === null).toBe(found === undefined || !keepsMoney(found));
        if (forecast === null) return;
        const figures = computeFigures(facts, asOf, { horizonMonths: forecastMonths - 1 }).jobs.get(job);
        let stillToCome = 0;
        forecast.months.forEach((row, i) => {
          const figured = figures?.months.get(row.month);
          if (figured?.money.kind !== "bucket" && figured?.money.kind !== "short") throw new Error("The job keeps its money, so every month has a bucket");
          if (i === 0) expect(forecast.startsWith).toBe(figured.money.start);
          expect(row.planned).toBe(figured.assigned.amount);
          expect(row.spent).toBe(figured.spent);
          expect(row.transfersIn).toBe(figured.transfersIn);
          expect(row.transfersOut).toBe(figured.transfersOut);
          const estimated = figured.cost.kind === "estimate" ? figured.cost.estimate.amount : 0;
          stillToCome += Math.max(estimated - figured.spent, 0);
          expect(row.bucketEnd).toBe(figured.money.end - stillToCome);
        });
      }),
      runs,
    );
  });

  it("covers the current month and the eleven after it, in order, and ends where the bucket ends", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job, current }) => {
        const forecast = jobForecast(facts, job, asOf);
        if (forecast === null) return;
        expect(forecast.months.map((m) => m.month)).toEqual(monthRange(current, addMonths(current, forecastMonths - 1)));
        let balance: number = forecast.startsWith;
        for (const row of forecast.months) {
          balance = balance + row.planned + row.transfersIn - row.transfersOut - row.bill;
          expect(row.bucketEnd).toBe(balance);
        }
      }),
      runs,
    );
  });

  it("names the lowest point and the first month below zero, as the months show them", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job }) => {
        const forecast = jobForecast(facts, job, asOf);
        if (forecast === null) return;
        const ends = forecast.months.map((m) => m.bucketEnd);
        const lowest = Math.min(...ends);
        expect(forecast.lowest).toEqual({ month: forecast.months[ends.findIndex((e) => e === lowest)]?.month, amount: lowest });
        expect(forecast.runsDryIn).toBe(forecast.months.find((m) => m.bucketEnd < 0)?.month ?? null);
        expect(forecast.runsDryIn === null).toBe(lowest >= 0);
      }),
      runs,
    );
  });

  it("changes no fact", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job }) => {
        const before = snapshotOf(facts);
        jobForecast(facts, job, asOf);
        jobHistory(facts, job, asOf);
        jobEstimate(facts, job, asOf);
        expect(snapshotOf(facts)).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});

describe("a job's history, in any household", () => {
  it("ends with the current month, still coming, reaches back at most twelve months, and totals only the months that have ended", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job, current }) => {
        const history = jobHistory(facts, job, asOf);
        if (history === null) throw new Error("The job exists");
        expect(history.months.length).toBeLessThanOrEqual(historyMonths);
        expect(history.months.at(-1)).toMatchObject({ month: current, stillComing: true });
        const ended = history.months.filter((m) => !m.stillComing);
        expect(history.months.filter((m) => m.stillComing)).toHaveLength(1);
        expect(history.ended.months).toBe(ended.length);
        expect(history.ended.paid).toBe(ended.reduce((sum, m) => sum + m.paid, 0));
        expect(history.ended.planned).toBe(ended.reduce((sum, m) => sum + (m.planned ?? 0), 0));
        expect(history.ended.from).toBe(ended[0]?.month ?? null);
        expect(history.ended.to).toBe(ended.at(-1)?.month ?? null);
        if (ended.length === 0) expect(history.ended.averagePaid).toBeNull();
        else expect(Math.abs((history.ended.averagePaid ?? Number.NaN) * ended.length - history.ended.paid)).toBeLessThanOrEqual(ended.length / 2);
        expect(history.recent.months).toEqual(ended.slice(-3));
        expect(history.recent.underBy).toBe(history.recent.planned - history.recent.paid);
      }),
      runs,
    );
  });

  it("reads each plan month's plan and spending from the figures, and the months before the plan from history", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job }) => {
        const history = jobHistory(facts, job, asOf);
        const figures = computeFigures(facts, asOf, { horizonMonths: 0 });
        for (const row of history?.months ?? []) {
          const figured = figures.jobs.get(job)?.months.get(row.month);
          if (figured === undefined) {
            expect(row.state).toBe("history");
            expect(row.planned).toBeNull();
          } else {
            expect([row.state, row.planned, row.paid]).toEqual([figures.months.get(row.month)?.state, figured.assigned.amount, figured.spent]);
          }
        }
      }),
      runs,
    );
  });
});

describe("a job's estimate, in any household", () => {
  it("is the figures' own estimates, each with a basis that names real history, and totals the bills", () => {
    fc.assert(
      fc.property(arbitraryVariableCost(), ({ facts, asOf, job, current }) => {
        const estimate = jobEstimate(facts, job, asOf);
        expect(estimate === null).toBe(facts.jobs.get(job)?.kind !== "spend");
        if (estimate === null) return;
        const figures = computeFigures(facts, asOf, { horizonMonths: forecastMonths - 1 }).jobs.get(job);
        expect(estimate.months.map((m) => m.month)).toEqual(monthRange(current, addMonths(current, forecastMonths - 1)));
        for (const row of estimate.months) {
          const figured = figures?.months.get(row.month);
          expect(figured?.cost).toEqual({ kind: "estimate", estimate: row.estimate });
          expect(row.basis.kind).not.toBe("unexplained");
          expect(row.appsOwn === null).toBe(row.estimate.method !== "enteredByYou");
          expect(row.bill).toBe(Math.max(row.estimate.amount, row.spent));
          if (row.month !== current) expect(row.spent).toBe(0);
        }
        const total = estimate.months.reduce((sum, m) => sum + m.bill, 0);
        expect(estimate.total).toEqual({ kind: "estimate", amount: total });
        expect(Math.abs(estimate.monthlyAverage.amount * estimate.months.length - total)).toBeLessThanOrEqual(estimate.months.length / 2);
      }),
      runs,
    );
  });
});
