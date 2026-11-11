/**
 * A forecast for a job that keeps its money (decision record 0048, "Definitions"): for each of the next
 * twelve months, what the plan gives the job, what its bill is expected to be, and what the bucket holds
 * at the end of the month after both. It is the Electricity chart in the job panel.
 *
 * `computeFigures` adds nothing for a bill that hasn't come yet, so the bucket in a month ahead only grows.
 * The forecast takes the expected bill out. The twelve months are the current month and the eleven after
 * it, as in the mockup (November to October). It is worked out from the figures and changes no fact.
 */

import { type LocalDate, type Month, addMonths, monthRange } from "../dates.ts";
import type { Estimate } from "../estimate.ts";
import type { Facts } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { type Figures, computeFigures } from "./index.ts";
import type { JobMonth } from "./jobs.ts";
import type { MonthState } from "./months.ts";

/** How many months a forecast covers, the current month included. */
export const forecastMonths = 12;

export interface ForecastMonth {
  readonly month: Month;
  readonly state: MonthState;
  /** What the job is given: the family's assignment in a month they have opened, the plan's projection in a planned one. */
  readonly planned: Money;
  /** The app's estimate of the month's bill, or null for a job with no bills (a save-up or pay-into job). */
  readonly estimate: Estimate | null;
  /** Paid so far in the month. Always 0 for a month ahead. */
  readonly spent: Money;
  /** What the forecast takes out of the bucket: the estimate, or what has already been paid if that is more. */
  readonly bill: Money;
  readonly transfersIn: Money;
  readonly transfersOut: Money;
  /** What the bucket holds at the end of the month: the month before, plus planned and transfers in, less transfers out and the bill. */
  readonly bucketEnd: Money;
}

export interface JobForecast {
  readonly jobId: JobId;
  /** What the bucket holds at the start of the first month. */
  readonly startsWith: Money;
  readonly months: readonly ForecastMonth[];
  /** The lowest the bucket gets, and the first month it gets there. */
  readonly lowest: { readonly month: Month; readonly amount: Money };
  /** The first month the bucket would end below zero, or null when it never does. */
  readonly runsDryIn: Month | null;
}

export type ForecastRow = Omit<ForecastMonth, "bucketEnd">;

/** What a month costs the bucket: the estimate, or what is already paid if that is more. A job with no bills costs what it has paid. */
export function billOf(jobMonth: JobMonth): Money {
  switch (jobMonth.cost.kind) {
    case "estimate":
      return money(Math.max(jobMonth.cost.estimate.amount, jobMonth.spent));
    case "actual":
    case "notEstimated":
      return jobMonth.spent;
  }
}

/** A total shared out over some months, rounded half up so a cheaper month and a dearer one weigh alike. */
export function averageHalfUp(total: Money, count: number): Money {
  return money(Math.floor((2 * total + count) / (2 * count)));
}

/** The bucket at the end of each month, from what it holds at the start. */
export function rollBucket(startsWith: Money, rows: readonly ForecastRow[]): ForecastMonth[] {
  let balance: number = startsWith;
  return rows.map((row) => {
    balance += row.planned + row.transfersIn - row.transfersOut - row.bill;
    return { ...row, bucketEnd: money(balance) };
  });
}

/** The lowest point and the month it runs dry, from months already rolled. */
export function summarise(jobId: JobId, startsWith: Money, months: readonly ForecastMonth[]): JobForecast {
  const [first] = months;
  if (first === undefined) throw new RangeError("A forecast needs at least one month");
  let lowest = { month: first.month, amount: first.bucketEnd };
  for (const m of months) if (m.bucketEnd < lowest.amount) lowest = { month: m.month, amount: m.bucketEnd };
  return { jobId, startsWith, months, lowest, runsDryIn: months.find((m) => m.bucketEnd < 0)?.month ?? null };
}

/** The rows of the next twelve months for a job, from figures that reach that far. Null when the job keeps no money, or the plan hasn't started and so has no current month. */
export function forecastRows(figures: Figures, jobId: JobId): { readonly startsWith: Money; readonly rows: readonly ForecastRow[] } | null {
  const job = figures.jobs.get(jobId);
  if (job === undefined || job.bucket.kind !== "kept") return null;
  const rows: ForecastRow[] = [];
  let startsWith: Money | null = null;
  for (const month of monthRange(figures.current, addMonths(figures.current, forecastMonths - 1))) {
    const jobMonth = job.months.get(month);
    const state = figures.months.get(month)?.state;
    if (jobMonth === undefined || state === undefined) continue;
    if (startsWith === null) {
      if (jobMonth.money.kind !== "bucket" && jobMonth.money.kind !== "short") return null;
      startsWith = jobMonth.money.start;
    }
    rows.push({
      month,
      state,
      planned: jobMonth.assigned.amount,
      estimate: jobMonth.cost.kind === "estimate" ? jobMonth.cost.estimate : null,
      spent: jobMonth.spent,
      bill: billOf(jobMonth),
      transfersIn: jobMonth.transfersIn,
      transfersOut: jobMonth.transfersOut,
    });
  }
  return startsWith === null || rows[0]?.month !== figures.current ? null : { startsWith, rows };
}

/** The forecast from figures already worked out, so a screen that holds them needn't work them out again. */
export function forecastFromFigures(figures: Figures, jobId: JobId): JobForecast | null {
  const found = forecastRows(figures, jobId);
  return found === null ? null : summarise(jobId, found.startsWith, rollBucket(found.startsWith, found.rows));
}

/** The job's forecast for the next twelve months. Null when the job doesn't exist or keeps no money, because then it has no bucket. */
export function jobForecast(facts: Facts, jobId: JobId, asOf: LocalDate): JobForecast | null {
  return forecastFromFigures(computeFigures(facts, asOf, { horizonMonths: forecastMonths - 1 }), jobId);
}
