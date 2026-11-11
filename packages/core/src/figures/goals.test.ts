import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addMonths, localDate, month } from "../dates.ts";
import { jobId } from "../ids.ts";
import { money } from "../money.ts";
import { amountByMonth, factsBuilder, kr, monthlySaving, testId } from "../testing/facts-builder.ts";
import { planHousehold, planToday } from "../testing/plan-household.ts";
import { jobIn } from "../testing/read-figures.ts";
import { goalOf, goalsFrom, monthlyToReach } from "./goals.ts";
import { computeFigures } from "./index.ts";

const today = localDate("2026-11-09");

/** One open month with a save-up job given `assigned` a month and holding `opening`, as of 9 November 2026. */
function oneGoal(spec: { readonly target: ReturnType<typeof amountByMonth>; readonly assigned: number; readonly opening?: number }) {
  const b = factsBuilder({ planStart: "2026-11" });
  b.group();
  b.buffer({ monthly: kr(1_000) });
  const job = b.saveUpJob({ name: "Holidays", target: spec.target, opening: kr(spec.opening ?? 0) });
  b.budgetMonth("2026-11", "open");
  b.assign("2026-11", job, kr(spec.assigned));
  return { b, job, facts: b.facts() };
}

describe("monthlyToReach", () => {
  it("says 3,000 kr a month for 7 months, December to June, for 21,000 kr by June", () => {
    expect(monthlyToReach({ target: kr(21_000), saved: kr(0), from: month("2026-12"), readyBy: month("2027-06") })).toEqual({
      monthly: kr(3_000),
      months: 7,
      from: "2026-12",
      to: "2027-06",
    });
  });

  it("rounds the monthly amount up, so the months it names reach the target", () => {
    const reach = monthlyToReach({ target: money(21_001), saved: money(0), from: month("2026-12"), readyBy: month("2027-06") });
    expect(reach?.monthly).toBe(3_001);
    expect((reach?.monthly ?? 0) * 7).toBeGreaterThanOrEqual(21_001);
  });

  it("takes what is saved off first, and asks for nothing once the target is reached", () => {
    expect(monthlyToReach({ target: kr(21_000), saved: kr(7_000), from: month("2026-12"), readyBy: month("2027-06") })?.monthly).toBe(kr(2_000));
    expect(monthlyToReach({ target: kr(21_000), saved: kr(21_000), from: month("2026-12"), readyBy: month("2027-06") })?.monthly).toBe(0);
    expect(monthlyToReach({ target: kr(21_000), saved: kr(30_000), from: month("2026-12"), readyBy: month("2027-06") })?.monthly).toBe(0);
  });

  it("counts both ends: starting in the month it is due is one month, and starting after it is no plan", () => {
    expect(monthlyToReach({ target: kr(500), saved: kr(0), from: month("2027-06"), readyBy: month("2027-06") })).toMatchObject({ months: 1, monthly: kr(500) });
    expect(monthlyToReach({ target: kr(500), saved: kr(0), from: month("2027-07"), readyBy: month("2027-06") })).toBeNull();
  });

  it("is what the figures project for a planned month of a job with a date", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4_000_000 }), fc.integer({ min: 0, max: 3_000_000 }), fc.integer({ min: 0, max: 14 }), (target, opening, ahead) => {
        const b = factsBuilder({ planStart: "2026-11" });
        b.group();
        b.buffer({ monthly: kr(1_000) });
        const readyBy = addMonths(month("2026-11"), ahead);
        const job = b.saveUpJob({ target: { kind: "amountByMonth", amount: money(target), readyBy }, opening: money(opening) });
        b.budgetMonth("2026-11", "open");
        const figures = computeFigures(b.facts(), today);
        for (let step = 1; step <= 12; step += 1) {
          const m = addMonths(month("2026-11"), step);
          const planned = jobIn(figures, job, m).assigned.amount;
          const before = jobIn(figures, job, addMonths(m, -1)).money;
          const saved = before.kind === "bucket" || before.kind === "short" ? before.end : money(0);
          const reach = monthlyToReach({ target: money(target), saved, from: m, readyBy });
          expect(planned).toBe(reach?.monthly ?? 0);
        }
      }),
    );
  });
});

describe("a goal", () => {
  const { facts, jobs } = planHousehold();

  it("for the buffer aims at buffer months times the essential monthly total, and counts months at what it is given", () => {
    expect(goalOf(facts, jobs.buffer, planToday)).toEqual({
      jobId: jobs.buffer,
      target: kr(158_460),
      saved: kr(86_000),
      monthly: kr(3_000),
      monthsToGo: 25,
      readyMonth: "2028-12",
      reachBy: null,
    });
  });

  it("for a plain monthly amount has no target, so no months to go", () => {
    expect(goalOf(facts, jobs.build, planToday)).toEqual({ jobId: jobs.build, target: null, saved: kr(212_000), monthly: kr(4_500), monthsToGo: null, readyMonth: null, reachBy: null });
  });

  it("for a job with a date says what it takes each month from next month to the date", () => {
    expect(goalOf(facts, jobs.konfirmasjon, planToday)).toEqual({
      jobId: jobs.konfirmasjon,
      target: kr(38_000),
      saved: kr(9_600),
      monthly: kr(1_500),
      monthsToGo: 19,
      readyMonth: "2028-06",
      reachBy: { monthly: money(473_334), months: 6, from: "2026-12", to: "2027-05" },
    });
  });

  it("is only for a save-up job, and none for a job that does not exist", () => {
    expect(goalOf(facts, jobs.food, planToday)).toBeNull();
    expect(goalOf(facts, jobs.childSavings[0] as typeof jobs.food, planToday)).toBeNull();
    expect(goalOf(facts, jobId(testId(999_999)), planToday)).toBeNull();
  });

  it("is found for every save-up job at once", () => {
    const goals = goalsFrom(computeFigures(facts, planToday));
    expect([...goals.keys()].sort()).toEqual([jobs.konfirmasjon, jobs.christmas, jobs.buffer, jobs.build].sort());
  });

  it("rounds the months to go up: one øre more than a whole number of months is one more month", () => {
    const exact = oneGoal({ target: amountByMonth(kr(10_000), "2030-01"), assigned: 1_000 });
    expect(goalOf(exact.facts, exact.job, today)).toMatchObject({ saved: kr(1_000), monthly: kr(1_000), monthsToGo: 9 });
    const over = oneGoal({ target: amountByMonth(money(1_000_001), "2030-01"), assigned: 1_000 });
    expect(goalOf(over.facts, over.job, today)).toMatchObject({ saved: kr(1_000), monthly: kr(1_000), monthsToGo: 10 });
  });

  it("is 0 months once the target is reached, even with nothing given this month", () => {
    const reached = oneGoal({ target: amountByMonth(kr(10_000), "2030-01"), assigned: 0, opening: 10_000 });
    expect(goalOf(reached.facts, reached.job, today)).toMatchObject({ saved: kr(10_000), monthly: 0, monthsToGo: 0, readyMonth: "2026-11" });
    const over = oneGoal({ target: amountByMonth(kr(10_000), "2030-01"), assigned: 500, opening: 12_000 });
    expect(goalOf(over.facts, over.job, today)).toMatchObject({ monthsToGo: 0, readyMonth: "2026-11" });
  });

  it("has no months to go when it is given nothing and has not reached its target", () => {
    const idle = oneGoal({ target: amountByMonth(kr(10_000), "2030-01"), assigned: 0 });
    expect(goalOf(idle.facts, idle.job, today)).toMatchObject({ target: kr(10_000), monthly: 0, monthsToGo: null, readyMonth: null });
  });

  it("has no reach-by once the date has passed", () => {
    const late = oneGoal({ target: amountByMonth(kr(10_000), "2026-11"), assigned: 500 });
    expect(goalOf(late.facts, late.job, today)).toMatchObject({ monthsToGo: 19, reachBy: null });
  });

  it("has no buffer target while no essential job has money, since three months of nothing is no goal", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    b.group();
    const buffer = b.buffer({ monthly: kr(1_000), opening: kr(5_000) });
    b.budgetMonth("2026-11", "open");
    b.assign("2026-11", buffer, kr(1_000));
    expect(goalOf(b.facts(), buffer, today)).toMatchObject({ target: null, monthsToGo: null, saved: kr(6_000) });
  });

  it("counts money other buckets gave it and takes off money it gave them", () => {
    const { b, job } = oneGoal({ target: amountByMonth(kr(10_000), "2030-01"), assigned: 1_000 });
    const other = b.saveUpJob({ name: "Other", target: monthlySaving(kr(100)), opening: kr(5_000) });
    const base = goalOf(b.facts(), job, today);
    b.bucketTransfer({ month: "2026-11", from: other, to: job, amount: kr(2_000) });
    expect(goalOf(b.facts(), job, today)).toMatchObject({ saved: kr(3_000), monthsToGo: 7 });
    expect(base).toMatchObject({ saved: kr(1_000), monthsToGo: 9 });
    b.bucketTransfer({ month: "2026-11", from: job, to: other, amount: kr(500) });
    expect(goalOf(b.facts(), job, today)).toMatchObject({ saved: kr(2_500), monthsToGo: 8 });
  });

  it("counts what the job has spent", () => {
    const { b, job } = oneGoal({ target: amountByMonth(kr(10_000), "2030-01"), assigned: 1_000 });
    b.spend({ date: "2026-11-05", amount: kr(-400), jobId: job });
    expect(goalOf(b.facts(), job, today)).toMatchObject({ saved: kr(600), monthsToGo: 10 });
  });

  it("agrees with the bucket the figures hold", () => {
    const figures = computeFigures(facts, planToday);
    for (const goal of goalsFrom(figures).values()) {
      const bucket = figures.jobs.get(goal.jobId)?.bucket;
      expect(bucket).toEqual({ kind: "kept", balance: goal.saved });
      expect(goal.monthly).toBe(jobIn(figures, goal.jobId, "2026-11").assigned.amount);
    }
  });
});
