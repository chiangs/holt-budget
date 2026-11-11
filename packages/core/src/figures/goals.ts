/**
 * A save-up job's goal (decision record 0048, "Goal"): what it aims for, what its bucket holds, what it is
 * given each month, and how long that takes. A figure like the others: worked out from the facts, never
 * stored. Only a save-up job has a goal, so a spend job and a pay-into job give `null`.
 */

import { type LocalDate, type Month, addMonths, monthsBetween } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, divideUp, money } from "../money.ts";
import { type Figures, computeFigures } from "./index.ts";
import type { JobFigures } from "./jobs.ts";

/** "3,000 kr a month for 7 months, December to June": what a goal with a date needs each month over the months left. */
export interface MonthlyToReach {
  readonly monthly: Money;
  /** The months from `from` to `to`, both included. */
  readonly months: number;
  readonly from: Month;
  readonly to: Month;
}

/**
 * The monthly amount that brings `saved` up to `target` by the end of `readyBy`, giving money from `from` on.
 * It is the projection of a save-up job with an "amount by month" target (decision 0046), so a New job form can say it
 * before the job exists. Null when `from` is after `readyBy`.
 */
export function monthlyToReach(input: { readonly target: Money; readonly saved: Money; readonly from: Month; readonly readyBy: Month }): MonthlyToReach | null {
  const months = monthsBetween(input.from, input.readyBy) + 1;
  if (months < 1) return null;
  return { monthly: divideUp(money(Math.max(0, input.target - input.saved)), months), months, from: input.from, to: input.readyBy };
}

export interface Goal {
  readonly jobId: JobId;
  /** The amount by month for a job with a date, buffer months times the essential monthly total for the buffer, and none for a plain monthly amount (or a buffer with no essential job to cover). */
  readonly target: Money | null;
  /** What the bucket holds at the end of the current month. */
  readonly saved: Money;
  /** What the job is given in the current month. */
  readonly monthly: Money;
  /** `ceil((target - saved) / monthly)`. 0 when the target is reached, null with no target, or with none reached and no monthly amount. */
  readonly monthsToGo: number | null;
  /** The month the goal is reached at `monthly` a month: the current month plus `monthsToGo`. */
  readonly readyMonth: Month | null;
  /** For a job with a date: what it takes each month from next month to the date, given what the bucket holds now. Null for the other targets, or when the date has passed. */
  readonly reachBy: MonthlyToReach | null;
}

function goalOfJob(figures: Figures, jobFigures: JobFigures): Goal | null {
  const { job } = jobFigures;
  if (job.kind !== "saveUp") return null;
  const saved = jobFigures.bucket.kind === "kept" ? jobFigures.bucket.balance : job.opening;
  const monthly = figures.months.get(figures.current)?.jobs.get(job.id)?.assigned.amount ?? money(0);

  let target: Money | null = null;
  switch (job.target.kind) {
    case "amountByMonth":
      target = job.target.amount;
      break;
    case "bufferMonths":
      target = figures.buffer.kind === "buffer" && figures.buffer.essentialMonthly > 0 ? figures.buffer.target : null;
      break;
    case "monthly":
      break;
  }

  const monthsToGo = target === null ? null : saved >= target ? 0 : monthly > 0 ? Math.ceil((target - saved) / monthly) : null;
  const reachBy = job.target.kind === "amountByMonth" ? monthlyToReach({ target: job.target.amount, saved, from: addMonths(figures.current, 1), readyBy: job.target.readyBy }) : null;
  return { jobId: job.id, target, saved, monthly, monthsToGo, readyMonth: monthsToGo === null ? null : addMonths(figures.current, monthsToGo), reachBy };
}

/** The goal of every save-up job in these figures, by job. */
export function goalsFrom(figures: Figures): ReadonlyMap<JobId, Goal> {
  const goals = new Map<JobId, Goal>();
  for (const jobFigures of figures.jobs.values()) {
    const goal = goalOfJob(figures, jobFigures);
    if (goal !== null) goals.set(goal.jobId, goal);
  }
  return goals;
}

/** The goal of one save-up job as of `asOf`, or null for any other job, or none with that ID. */
export function goalOf(facts: Facts, jobId: JobId, asOf: LocalDate): Goal | null {
  return goalsFrom(computeFigures(facts, asOf, { horizonMonths: 0 })).get(jobId) ?? null;
}
