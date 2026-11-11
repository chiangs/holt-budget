/**
 * What a job's year looked like (decision record 0048; the Electricity panel's "Jan to Oct, actual" and "Last 3
 * months"): for each of the last twelve months up to the current one, what the plan gave the job and what was
 * paid, and the totals over the months that have ended. The screen reads these figures as they are.
 *
 * The record starts at the job's first month with a plan or a bill, so a job added in July doesn't have six
 * empty months pulling its average down. Months before the plan start are history: they show what was paid and
 * no plan.
 */

import { type LocalDate, type Month, addMonths, monthRange } from "../dates.ts";
import { type Facts, householdOf } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { averageHalfUp } from "./forecast.ts";
import { computeFigures } from "./index.ts";
import type { MonthState } from "./months.ts";
import { indexTransactions } from "./transactions.ts";

/** How many months the history reaches back, the current month included. */
export const historyMonths = 12;
const recentMonths = 3;

export interface HistoryMonth {
  readonly month: Month;
  /** The month's state, or "history" before the plan start. */
  readonly state: MonthState | "history";
  /** What the plan gave the job: the assignment, or the projection in a planned month. Null before the plan start. */
  readonly planned: Money | null;
  /** What was paid: a positive amount for a cost, and a refund reduces it. */
  readonly paid: Money;
  /** True for the current month, because more spending may still come in. */
  readonly stillComing: boolean;
}

/** The months that have ended, together: "Jan to Oct, actual 28,800 kr, 2,880 a month on average". */
export interface EndedTotals {
  readonly months: number;
  readonly from: Month | null;
  readonly to: Month | null;
  readonly planned: Money;
  readonly paid: Money;
  /** Null when no month has ended. */
  readonly averagePaid: Money | null;
}

/** The last three months that have ended: "you planned 2,900 each month and paid 2,760, 2,910 and 2,846". */
export interface RecentMonths {
  readonly months: readonly HistoryMonth[];
  readonly planned: Money;
  readonly paid: Money;
  /** What was planned less what was paid. Positive means under, negative means over. */
  readonly underBy: Money;
}

export interface JobHistory {
  readonly jobId: JobId;
  /** Oldest first, ending with the current month. */
  readonly months: readonly HistoryMonth[];
  readonly ended: EndedTotals;
  readonly recent: RecentMonths;
}

const sum = (amounts: readonly number[]): Money => money(amounts.reduce((total, a) => total + a, 0));

export function jobHistory(facts: Facts, jobId: JobId, asOf: LocalDate): JobHistory | null {
  if (!facts.jobs.has(jobId)) return null;
  const figures = computeFigures(facts, asOf, { horizonMonths: 0 });
  const { current } = figures;
  const planStart = householdOf(facts).planStart;
  const job = figures.jobs.get(jobId);
  const window = monthRange(addMonths(current, 1 - historyMonths), current);
  const index = window.some((m) => m < planStart) ? indexTransactions(facts, asOf) : null;

  const all = window.map((m): HistoryMonth => {
    const stillComing = m === current;
    const jobMonth = job?.months.get(m);
    const state = figures.months.get(m)?.state;
    if (jobMonth !== undefined && state !== undefined) return { month: m, state, planned: jobMonth.assigned.amount, paid: jobMonth.spent, stillComing };
    const paid = (index?.spent.get(jobId)?.get(m) ?? 0) + (index?.history.get(jobId)?.get(m) ?? 0);
    return { month: m, state: "history", planned: null, paid: money(paid), stillComing };
  });

  const first = all.findIndex((m) => m.stillComing || (m.planned ?? 0) !== 0 || m.paid !== 0);
  const months = all.slice(first);
  const ended = months.filter((m) => !m.stillComing);
  const recent = ended.slice(-recentMonths);
  const paidTotal = sum(ended.map((m) => m.paid));
  const recentPlanned = sum(recent.map((m) => m.planned ?? 0));
  const recentPaid = sum(recent.map((m) => m.paid));

  return {
    jobId,
    months,
    ended: {
      months: ended.length,
      from: ended[0]?.month ?? null,
      to: ended.at(-1)?.month ?? null,
      planned: sum(ended.map((m) => m.planned ?? 0)),
      paid: paidTotal,
      averagePaid: ended.length === 0 ? null : averageHalfUp(paidTotal, ended.length),
    },
    recent: { months: recent, planned: recentPlanned, paid: recentPaid, underBy: money(recentPlanned - recentPaid) },
  };
}
