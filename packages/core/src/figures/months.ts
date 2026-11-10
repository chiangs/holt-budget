/**
 * The plan, month by month (decision record 0046; rule 4; decisions 1, 2 and 13). A month's money is
 * what it carries in plus the income that funds it. Buckets run on from the month before, and an ended
 * month's leftovers return to unassigned, so the months are worked out in order.
 */

import type { Month } from "../dates.ts";
import { type BudgetMonthState, type Facts, assignmentKey } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import type { EstimateFor } from "./estimates.ts";
import { type Assigned, type JobFigures, type JobMonth, costOf, keepsMoney, monthMoney, projection } from "./jobs.ts";
import type { TransactionIndex } from "./transactions.ts";

/** A month with no budget month row is planned: its amounts are projections. */
export type MonthState = BudgetMonthState | "planned";

/** Where a month sits against `asOf`. Only ended months return leftovers, and months ahead have no spending yet. */
export type MonthTiming = "ended" | "current" | "ahead";

/** Rule 4: money with no job yet, or more assigned than available. Over-assigned money is shown, and doesn't carry forward. */
export type Unassigned = { readonly kind: "unassigned"; readonly amount: Money } | { readonly kind: "overAssigned"; readonly amount: Money };

export interface MonthFigures {
  readonly month: Month;
  readonly state: MonthState;
  readonly timing: MonthTiming;
  /** Unassigned money from the month before, plus what its jobs returned. Nothing at the plan start. */
  readonly carriedIn: Money;
  /** Income whose funds month is this month, whenever it arrived. */
  readonly income: Money;
  readonly available: Money;
  /** The sum of every job's assigned amount. */
  readonly assigned: Money;
  readonly unassigned: Unassigned;
  /** The leftovers this month returns to unassigned. Zero until the month has ended. */
  readonly returned: Money;
  readonly jobs: ReadonlyMap<JobId, JobMonth>;
}

export interface PlanFigures {
  readonly months: ReadonlyMap<Month, MonthFigures>;
  readonly jobs: ReadonlyMap<JobId, JobFigures>;
}

export function planFigures(facts: Facts, planMonths: readonly Month[], current: Month, index: TransactionIndex, estimateFor: EstimateFor): PlanFigures {
  const jobs = [...facts.jobs.values()].map((job) => ({ job, keeps: keepsMoney(job), months: new Map<Month, JobMonth>() }));
  const bucketBefore = new Map<JobId, Money>(jobs.map(({ job }) => [job.id, job.opening]));
  // A job's bucket now is the end of the current month, or its opening amount while the plan hasn't started.
  const bucketNow = new Map(bucketBefore);
  const months = new Map<Month, MonthFigures>();
  let carriedIn = money(0);

  for (const m of planMonths) {
    const state: MonthState = facts.budgetMonths.get(m)?.state ?? "planned";
    const timing: MonthTiming = m < current ? "ended" : m === current ? "current" : "ahead";
    const ended = timing === "ended";
    const income = index.income.get(m) ?? money(0);
    const jobsInMonth = new Map<JobId, JobMonth>();
    let assignedTotal = 0;
    let returned = 0;

    for (const { job, keeps, months: jobMonths } of jobs) {
      const start = bucketBefore.get(job.id) ?? money(0);
      const assigned: Assigned =
        state === "planned"
          ? projection(job, m, start, estimateFor)
          : { kind: "assignment", amount: facts.assignments.get(assignmentKey(m, job.id))?.amount ?? money(0) };
      const spent = index.spent.get(job.id)?.get(m) ?? money(0);
      const jobMoney = monthMoney(keeps, start, assigned.amount, spent, ended);
      const jobMonth: JobMonth = { month: m, assigned, spent, money: jobMoney, cost: costOf(job, m, spent, ended, estimateFor) };

      jobsInMonth.set(job.id, jobMonth);
      jobMonths.set(m, jobMonth);
      assignedTotal += assigned.amount;
      if (jobMoney.kind === "returned") returned += jobMoney.amount;
      if (jobMoney.kind === "bucket" || jobMoney.kind === "short") {
        bucketBefore.set(job.id, jobMoney.end);
        if (m === current) bucketNow.set(job.id, jobMoney.end);
      }
    }

    const available = money(carriedIn + income);
    const signed = available - assignedTotal;
    months.set(m, {
      month: m,
      state,
      timing,
      carriedIn,
      income,
      available,
      assigned: money(assignedTotal),
      unassigned: signed < 0 ? { kind: "overAssigned", amount: money(-signed) } : { kind: "unassigned", amount: money(signed) },
      returned: money(returned),
      jobs: jobsInMonth,
    });
    carriedIn = money(Math.max(0, signed) + returned);
  }

  return {
    months,
    jobs: new Map(
      jobs.map(({ job, keeps, months: jobMonths }): [JobId, JobFigures] => [
        job.id,
        { job, months: jobMonths, bucket: keeps ? { kind: "kept", balance: bucketNow.get(job.id) ?? job.opening } : { kind: "absent" } },
      ]),
    ),
  };
}
