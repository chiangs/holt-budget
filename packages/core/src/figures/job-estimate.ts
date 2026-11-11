/**
 * What a variable cost is expected to be over the next twelve months, and how the app worked each month out
 * (decision record 0048; the panel's "How Holt estimated this"). The estimates are the figures' own, never
 * worked out again here: this reads them, and for each one says which method gave it and which months of the
 * job's history it used, as data the screen turns into words. A month the family overrode says so, and keeps
 * the figure the app would have given.
 *
 * Nothing here is an actual (rule 12): the totals carry their kind, so a screen shows them with ≈.
 */

import { type LocalDate, type Month, addMonths, monthRange } from "../dates.ts";
import { type Estimate, type EstimateInput, estimate as defaultEstimate } from "../estimate.ts";
import type { Facts } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { averageHalfUp, billOf, forecastMonths } from "./forecast.ts";
import { type EstimateFunction, computeFigures } from "./index.ts";

/** A month of the job's history, and what was paid in it. */
export interface UsedMonth {
  readonly month: Month;
  readonly amount: Money;
}

/** The last three months of history against the same three a year earlier, which scale the same month last year. */
export interface Trend {
  readonly recent: readonly UsedMonth[];
  readonly recentTotal: Money;
  readonly yearBefore: readonly UsedMonth[];
  readonly yearBeforeTotal: Money;
}

/** Which method gave an estimate and the history it used. Months are oldest first. */
export type EstimateBasis =
  /** You typed this figure. */
  | { readonly kind: "enteredByYou" }
  | { readonly kind: "fixed" }
  | { readonly kind: "plannedItems" }
  /** The job has no history yet, so the estimate is nothing and rough. */
  | { readonly kind: "noHistory" }
  /** The average of the last months of history (up to six). */
  | { readonly kind: "average"; readonly months: readonly UsedMonth[] }
  /** The same month a year earlier, scaled by the trend when there are six months to compare. Null when there are not. */
  | { readonly kind: "sameMonthLastYear"; readonly lastYear: UsedMonth; readonly trend: Trend | null }
  /** The history's dearest month and the comparable months that stand in for this one. */
  | { readonly kind: "nearestMonths"; readonly peak: UsedMonth; readonly comparable: readonly UsedMonth[] }
  /** The months could not be named, so the screen says only that the history gave the figure. */
  | { readonly kind: "unexplained" };

const MONTHS_IN_YEAR = 12;
const TREND_MONTHS = 3;
const IRREGULAR_MONTHS = 6;

const used = (history: ReadonlyMap<Month, Money>, month: Month): UsedMonth | null => {
  const amount = history.get(month);
  return amount === undefined ? null : { month, amount };
};

const total = (months: readonly UsedMonth[]): Money => money(months.reduce((sum, u) => sum + u.amount, 0));
const calendarIndex = (m: Month): number => Number(m.slice(5, 7)) - 1;
const circularDistance = (a: number, b: number): number => Math.min(Math.abs(a - b) % MONTHS_IN_YEAR, MONTHS_IN_YEAR - (Math.abs(a - b) % MONTHS_IN_YEAR));
const byMonth = (a: UsedMonth, b: UsedMonth): number => (a.month < b.month ? -1 : 1);

function sameMonthLastYear(history: ReadonlyMap<Month, Money>, target: Month): { lastYear: UsedMonth; trend: Trend | null } | null {
  const lastYear = used(history, addMonths(target, -MONTHS_IN_YEAR));
  const latest = [...history.keys()].sort().at(-1);
  if (lastYear === null || latest === undefined) return null;
  const recent = Array.from({ length: TREND_MONTHS }, (_, i) => used(history, addMonths(latest, i - (TREND_MONTHS - 1))));
  const yearBefore = Array.from({ length: TREND_MONTHS }, (_, i) => used(history, addMonths(latest, i - (TREND_MONTHS - 1) - MONTHS_IN_YEAR)));
  const complete = (list: readonly (UsedMonth | null)[]): list is UsedMonth[] => list.every((u) => u !== null);
  if (!complete(recent) || !complete(yearBefore)) return { lastYear, trend: null };
  return { lastYear, trend: { recent, recentTotal: total(recent), yearBefore, yearBeforeTotal: total(yearBefore) } };
}

function nearestMonths(history: ReadonlyMap<Month, Money>, target: Month): { peak: UsedMonth; comparable: readonly UsedMonth[] } | null {
  const latestByCalendarMonth = new Map<number, UsedMonth>();
  let peak: UsedMonth | null = null;
  for (const month of [...history.keys()].sort()) {
    const entry = used(history, month) as UsedMonth;
    latestByCalendarMonth.set(calendarIndex(month), entry);
    if (peak === null || entry.amount >= peak.amount) peak = entry;
  }
  if (peak === null) return null;
  const peakIndex = calendarIndex(peak.month);
  const targetIndex = calendarIndex(target);
  const mirror = (((2 * peakIndex - targetIndex) % MONTHS_IN_YEAR) + MONTHS_IN_YEAR) % MONTHS_IN_YEAR;
  const wanted = circularDistance(targetIndex, peakIndex) <= 1 ? [mirror, peakIndex] : [mirror];
  const found = [...new Set(wanted)].flatMap((i) => latestByCalendarMonth.get(i) ?? []);
  if (found.length > 0) return { peak, comparable: found.sort(byMonth) };
  const closest = Math.min(...[...latestByCalendarMonth.keys()].map((i) => circularDistance(i, mirror)));
  const standIns = [...latestByCalendarMonth].filter(([i]) => circularDistance(i, mirror) === closest).map(([, entry]) => entry);
  return { peak, comparable: standIns.sort(byMonth) };
}

/** Whether the months named are enough to give the same estimate by the same method. A basis that can't show this is never offered. */
function reproduces(input: EstimateInput, result: Estimate, months: readonly UsedMonth[]): boolean {
  const history = new Map(months.map((u) => [u.month, u.amount] as const));
  const again = defaultEstimate({ month: input.month, history, seasonality: result.method === "average" ? "irregular" : "seasonal" });
  return again.amount === result.amount && again.method === result.method;
}

/**
 * Says which method gave `result` for `input` and which months of history it used. The estimate itself is
 * `estimate.ts`'s. This only names the months, and checks its answer by working the estimate again from just
 * those months: if that doesn't give the same figure, the basis is "unexplained" rather than wrong.
 */
export function explainEstimate(input: EstimateInput, result: Estimate): EstimateBasis {
  switch (result.method) {
    case "enteredByYou":
    case "fixed":
    case "plannedItems":
      return { kind: result.method };
    case "average": {
      const months = [...input.history.keys()].sort().slice(-IRREGULAR_MONTHS).map((m) => used(input.history, m) as UsedMonth);
      if (months.length === 0) return { kind: "noHistory" };
      return reproduces(input, result, months) ? { kind: "average", months } : { kind: "unexplained" };
    }
    case "sameMonthLastYear": {
      const found = sameMonthLastYear(input.history, input.month);
      if (found === null) return { kind: "unexplained" };
      const latest = [...input.history.keys()].sort().at(-1) as Month;
      const needed = [found.lastYear, used(input.history, latest) as UsedMonth, ...(found.trend?.recent ?? []), ...(found.trend?.yearBefore ?? [])];
      return reproduces(input, result, needed) ? { kind: "sameMonthLastYear", ...found } : { kind: "unexplained" };
    }
    case "nearestMonths": {
      const found = nearestMonths(input.history, input.month);
      if (found === null) return { kind: "unexplained" };
      return reproduces(input, result, [found.peak, ...found.comparable]) ? { kind: "nearestMonths", ...found } : { kind: "unexplained" };
    }
  }
}

/** An amount that is an estimate, so a screen shows it with ≈ (rule 12). */
export interface EstimatedAmount {
  readonly kind: "estimate";
  readonly amount: Money;
}

export interface EstimateMonth {
  readonly month: Month;
  /** The app's estimate, or the figure you typed, which says so in its method. */
  readonly estimate: Estimate;
  readonly basis: EstimateBasis;
  /** What the app would have estimated without your figure. Present only for a month you overrode. */
  readonly appsOwn: Estimate | null;
  /** Paid so far in the month. Always 0 for a month ahead. */
  readonly spent: Money;
  /** What the month counts as: the estimate, or what has already been paid if that is more. */
  readonly bill: Money;
}

export interface JobEstimate {
  readonly jobId: JobId;
  /** The current month and the eleven after it. */
  readonly months: readonly EstimateMonth[];
  /** The twelve months' bills together. */
  readonly total: EstimatedAmount;
  /** The total ÷ 12, rounded to the nearest unit: what evening out would cost a month before rounding up to the step. */
  readonly monthlyAverage: EstimatedAmount;
}

/** The next twelve months of a spend job. Null when the job doesn't exist or has no bills to estimate. */
export function jobEstimate(facts: Facts, jobId: JobId, asOf: LocalDate): JobEstimate | null {
  if (facts.jobs.get(jobId)?.kind !== "spend") return null;
  // The figures hand back the very Estimate object the estimate function returned, so it names the input that gave it.
  const inputs = new Map<Estimate, EstimateInput>();
  const recording: EstimateFunction = (input) => {
    const result = defaultEstimate(input);
    inputs.set(result, input);
    return result;
  };
  const figures = computeFigures(facts, asOf, { horizonMonths: forecastMonths - 1, estimate: recording });
  const job = figures.jobs.get(jobId);

  const months: EstimateMonth[] = [];
  for (const month of monthRange(figures.current, addMonths(figures.current, forecastMonths - 1))) {
    const jobMonth = job?.months.get(month);
    if (jobMonth === undefined || jobMonth.cost.kind !== "estimate") continue;
    const result = jobMonth.cost.estimate;
    const input = inputs.get(result);
    if (input === undefined) continue;
    const { override: _override, ...own } = input;
    months.push({
      month,
      estimate: result,
      basis: explainEstimate(input, result),
      appsOwn: input.override === undefined ? null : defaultEstimate(own),
      spent: jobMonth.spent,
      bill: billOf(jobMonth),
    });
  }
  const sum = money(months.reduce((all, m) => all + m.bill, 0));
  return {
    jobId,
    months,
    total: { kind: "estimate", amount: sum },
    monthlyAverage: { kind: "estimate", amount: months.length === 0 ? money(0) : averageHalfUp(sum, months.length) },
  };
}
