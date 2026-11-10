import { describe, expect, it } from "vitest";
import { type LocalDate, localDate, month } from "../dates.ts";
import { type Facts, assignmentKey, makeSplit } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import { type JobId, transactionId } from "../ids.ts";
import { accepted } from "../testing/command-household.ts";
import { factsBuilder, followBills, kr, setAmount, testId } from "../testing/facts-builder.ts";
import { jobIn } from "../testing/read-figures.ts";
import { type Command, apply } from "./apply.ts";

function assignmentsIn(facts: Facts, m: string): Record<string, number> {
  return Object.fromEntries([...facts.assignments.values()].filter((a) => a.month === month(m)).map((a) => [a.jobId, a.amount]));
}

describe("opening a month (decision 12)", () => {
  // Electricity follows the bills. Its estimate is the average of the last three bills: (2,600 + 3,100 + 4,200) ÷ 3 = 3,300 kr.
  const b = factsBuilder({ planStart: "2026-11" });
  const regninger = b.account({ name: "Regninger", kind: "bills" });
  const buffer = b.buffer({ monthly: kr(1_000) });
  const electricity = b.spendJob({ name: "Electricity", plan: followBills(), accountId: regninger, essential: true });
  const food = b.spendJob({ name: "Food and household", plan: setAmount(kr(14_200)), essential: true });
  b.spendJob({ name: "Union fees", plan: setAmount(kr(450)), status: "paused" });
  b.spendJob({ name: "Hobbies", plan: setAmount(kr(0)) });
  for (const [date, amount] of [["2026-08-15", 2_600], ["2026-09-15", 3_100], ["2026-10-15", 4_200]] as const) b.history({ date, amount: kr(-amount), jobId: electricity, accountId: regninger });
  const planned = b.facts();
  const asOf: LocalDate = localDate("2026-11-01");
  const run = (facts: Facts, command: Command) => accepted(apply(facts, command, { asOf }));
  const lateBill: Command = {
    kind: "recordTransaction",
    transaction: { id: transactionId(testId(700_000)), accountId: regninger, bookingDate: localDate("2026-10-28"), amount: kr(-600), description: "Lyse", treatment: { kind: "history", jobId: electricity } },
  };

  it("turns each job's projection into an assignment, with no row for a job that projects nothing", () => {
    const opened = run(planned, { kind: "openMonth", month: month("2026-11") });
    expect(assignmentsIn(opened, "2026-11")).toEqual({ [buffer]: kr(1_000), [electricity]: kr(3_300), [food]: kr(14_200) });
  });

  it("keeps an opened month's amounts when the estimates move, while planned months still move", () => {
    const opened = run(planned, { kind: "openMonth", month: month("2026-11") });
    // A late October bill makes the average (2,600 + 3,100 + 4,800) ÷ 3 = 3,500 kr.
    const figures = computeFigures(run(opened, lateBill), asOf);
    expect(jobIn(figures, electricity, "2026-11").assigned).toEqual({ kind: "assignment", amount: kr(3_300) });
    expect(jobIn(figures, electricity, "2026-12").assigned).toMatchObject({ kind: "estimate", amount: kr(3_500) });
  });

  it("without opening, the same month's amount moves with the estimate", () => {
    const figures = computeFigures(run(planned, lateBill), asOf);
    expect(jobIn(figures, electricity, "2026-11").assigned).toMatchObject({ kind: "estimate", amount: kr(3_500) });
  });

  it("opens months one after another from the plan start", () => {
    const tryOpen = (facts: Facts, m: string) => apply(facts, { kind: "openMonth", month: month(m) }, { asOf });
    expect(tryOpen(planned, "2026-12")).toMatchObject({ ok: false, refusal: { code: "monthNotNext" } });
    const november = run(planned, { kind: "openMonth", month: month("2026-11") });
    expect(tryOpen(november, "2026-11")).toMatchObject({ ok: false, refusal: { code: "monthNotNext" } });
    expect(tryOpen(november, "2027-01")).toMatchObject({ ok: false, refusal: { code: "monthNotNext" } });
    const closed = run(november, { kind: "closeMonth", month: month("2026-11") });
    const reopened = run(closed, { kind: "reopenMonth", month: month("2026-11") });
    expect(reopened.budgetMonths.get(month("2026-11"))?.state).toBe("reopened");
    expect(run(reopened, { kind: "openMonth", month: month("2026-12") }).budgetMonths.get(month("2026-12"))?.state).toBe("open");
  });

  it("only an open or reopened month takes assignments, and setting one to zero removes it", () => {
    const opened = run(planned, { kind: "openMonth", month: month("2026-11") });
    const cleared = run(opened, { kind: "assign", month: month("2026-11"), jobId: food, amount: kr(0) });
    expect(cleared.assignments.has(assignmentKey(month("2026-11"), food))).toBe(false);
    const closed = run(opened, { kind: "closeMonth", month: month("2026-11") });
    expect(apply(closed, { kind: "assign", month: month("2026-11"), jobId: food, amount: kr(100) }, { asOf })).toMatchObject({ ok: false, refusal: { code: "monthNotOpen" } });
    expect(apply(planned, { kind: "assign", month: month("2026-11"), jobId: food, amount: kr(100) }, { asOf })).toMatchObject({ ok: false, refusal: { code: "monthNotOpen" } });
  });
});

describe("an overspend is shown and never covered by itself (decisions 3 and 13)", () => {
  const b = factsBuilder({ planStart: "2026-10" });
  const everyday = b.account({ name: "Everyday" });
  const buffer = b.buffer({ monthly: kr(1_000), opening: kr(10_000) });
  const food = b.spendJob({ name: "Food and household", plan: setAmount(kr(5_000)), essential: true });
  const asOf = localDate("2026-11-20");
  const steps: readonly Command[] = [
    { kind: "openMonth", month: month("2026-10") },
    {
      kind: "recordTransaction",
      transaction: { id: transactionId(testId(700_001)), accountId: everyday, bookingDate: localDate("2026-10-20"), amount: kr(8_000), description: "Contribution", treatment: { kind: "income", fundsMonth: month("2026-11"), source: "contribution" } },
    },
    { kind: "openMonth", month: month("2026-11") },
    {
      kind: "recordTransaction",
      transaction: { id: transactionId(testId(700_002)), accountId: everyday, bookingDate: localDate("2026-11-03"), amount: kr(-6_500), description: "Rema 1000", treatment: makeSplit(kr(-6_500), [{ jobId: food, amount: kr(-6_500) }]) },
    },
    { kind: "closeMonth", month: month("2026-11") },
    { kind: "openMonth", month: month("2026-12") },
  ];
  const states = steps.reduce<Facts[]>((all, command) => [...all, accepted(apply(all.at(-1)!, command, { asOf }))], [b.facts()]);
  const afterOverspend = states.slice(4);
  const final = states.at(-1)!;

  it("shows the job as over by what it spent beyond its assignment", () => {
    expect(jobIn(computeFigures(final, asOf), food, "2026-11").money).toEqual({ kind: "over", amount: kr(1_500) });
  });

  it("leaves the over month's assignments as they were, through closing it and opening the next", () => {
    for (const facts of afterOverspend) expect(assignmentsIn(facts, "2026-11")).toEqual({ [buffer]: kr(1_000), [food]: kr(5_000) });
  });

  it("gives the next month the plan's amount, not reduced by the over", () => {
    const december: Record<JobId, number> = assignmentsIn(final, "2026-12");
    expect(december[food]).toBe(kr(5_000));
  });
});
