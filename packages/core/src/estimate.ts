/**
 * Estimates (domain model, "Estimate"; decision record 0046). The app's forecast of what a job costs in
 * a month. Never stored and never an actual (rule 12): it carries its method, and `rough` when it is a guess.
 *
 * Method precedence: an override, then a fixed amount, then planned items, then the history.
 * Everything is integer arithmetic. Rounding is half up, and the trend multiplication runs in BigInt so a
 * large amount cannot overflow before the division.
 */

import { addMonths, type Month } from "./dates.ts";
import { type Money, money } from "./money.ts";

export type EstimateMethod = "enteredByYou" | "fixed" | "plannedItems" | "sameMonthLastYear" | "nearestMonths" | "average";

export interface Estimate {
  readonly month: Month;
  readonly amount: Money;
  readonly method: EstimateMethod;
  /** True when the estimate is a rough guess, for example with less than a year of history. */
  readonly rough: boolean;
}

export interface EstimateInput {
  /** The month to estimate. */
  readonly month: Month;
  /** What was actually spent on the job in each ended month, as a positive amount. Months with no spending may be absent. */
  readonly history: ReadonlyMap<Month, Money>;
  readonly seasonality: "auto" | "seasonal" | "irregular";
  /** A figure the family typed for this month. It wins over everything. */
  readonly override?: Money;
  /** A fixed amount from a contract or recurring series. */
  readonly fixedAmount?: Money;
  /** The planned items in the month, for example gifts. Their sum is the estimate, and an empty list means 0. */
  readonly plannedItems?: readonly Money[];
}

/** "Auto" needs a year of history and a spread this wide between the dearest and the cheapest month (13 ÷ 10). */
const SEASONAL_RATIO = { numerator: 13, denominator: 10 } as const;
const MONTHS_IN_YEAR = 12;
const TREND_MONTHS = 3;
const IRREGULAR_MONTHS = 6;
const IRREGULAR_MINIMUM = 3;

/** Whether the job's history follows the seasons. The family's choice wins; "auto" reads the history. */
export function isSeasonal(history: ReadonlyMap<Month, Money>, seasonality: EstimateInput["seasonality"]): boolean {
  if (seasonality !== "auto") return seasonality === "seasonal";
  if (history.size < MONTHS_IN_YEAR) return false;
  const amounts = [...history.values()];
  const highest = Math.max(...amounts);
  const lowest = Math.min(...amounts);
  return highest > 0 && highest * SEASONAL_RATIO.denominator >= lowest * SEASONAL_RATIO.numerator;
}

function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

function averageHalfUp(amounts: readonly number[]): Money {
  return money(divideHalfUp(amounts.reduce((sum, a) => sum + a, 0), amounts.length));
}

function sumOf(history: ReadonlyMap<Month, Money>, months: readonly Month[]): number | null {
  let sum = 0;
  for (const m of months) {
    const amount = history.get(m);
    if (amount === undefined) return null;
    sum += amount;
  }
  return sum;
}

/**
 * The same month a year earlier, scaled by the trend: the last three ended months against the same three
 * a year before them. Without all six months there is no trend and the factor is 1.
 */
function sameMonthLastYear(history: ReadonlyMap<Month, Money>, target: Month, latest: Month): Money | null {
  const reference = history.get(addMonths(target, -MONTHS_IN_YEAR));
  if (reference === undefined) return null;
  const recent = Array.from({ length: TREND_MONTHS }, (_, i) => addMonths(latest, -i));
  const yearBefore = recent.map((m) => addMonths(m, -MONTHS_IN_YEAR));
  const now = sumOf(history, recent);
  const before = sumOf(history, yearBefore);
  if (now === null || before === null || before === 0) return reference;
  const scaled = (2n * BigInt(reference) * BigInt(now) + BigInt(before)) / (2n * BigInt(before));
  return money(Number(scaled));
}

function calendarIndex(m: Month): number {
  return Number(m.slice(5, 7)) - 1;
}

function circularDistance(a: number, b: number): number {
  const gap = Math.abs(a - b) % MONTHS_IN_YEAR;
  return Math.min(gap, MONTHS_IN_YEAR - gap);
}

/**
 * Nearest comparable months, for a seasonal job with no usable same month last year.
 *
 * The seasonal curve is taken to be symmetric around the history's dearest month (its peak, the latest one
 * on a tie). The comparable month for a target is its mirror image across the peak: with a January peak,
 * November mirrors March. A target within one month of the peak is on the steep top of the curve, so the
 * peak itself joins its mirror: December is the average of January and February. When a calendar month has
 * several years of history, its latest year counts. If none of those months has data, the calendar months
 * circularly closest to the mirror stand in (every tie included).
 */
function nearestMonths(history: ReadonlyMap<Month, Money>, target: Month): Money {
  const latestByCalendarMonth = new Map<number, Money>();
  let peak = { index: 0, amount: -1 };
  for (const m of [...history.keys()].sort()) {
    const amount = history.get(m) as Money;
    latestByCalendarMonth.set(calendarIndex(m), amount);
    if (amount >= peak.amount) peak = { index: calendarIndex(m), amount };
  }
  const targetIndex = calendarIndex(target);
  const mirror = (((2 * peak.index - targetIndex) % MONTHS_IN_YEAR) + MONTHS_IN_YEAR) % MONTHS_IN_YEAR;
  const wanted = circularDistance(targetIndex, peak.index) <= 1 ? [mirror, peak.index] : [mirror];
  const found = [...new Set(wanted)].flatMap((i) => latestByCalendarMonth.get(i) ?? []);
  if (found.length > 0) return averageHalfUp(found);
  const closest = Math.min(...[...latestByCalendarMonth.keys()].map((i) => circularDistance(i, mirror)));
  const standIns = [...latestByCalendarMonth].filter(([i]) => circularDistance(i, mirror) === closest).map(([, amount]) => amount);
  return averageHalfUp(standIns);
}

export function estimate(input: EstimateInput): Estimate {
  const { month, history, seasonality } = input;
  const result = (amount: Money, method: EstimateMethod, rough: boolean): Estimate => ({ month, amount, method, rough });

  if (input.override !== undefined) return result(input.override, "enteredByYou", false);
  if (input.fixedAmount !== undefined) return result(input.fixedAmount, "fixed", false);
  if (input.plannedItems !== undefined) {
    return result(money(input.plannedItems.reduce<number>((sum, a) => sum + a, 0)), "plannedItems", false);
  }
  if (history.size === 0) return result(money(0), "average", true);

  const ended = [...history.keys()].sort();
  if (isSeasonal(history, seasonality)) {
    const latest = ended[ended.length - 1] as Month;
    const sameMonth = sameMonthLastYear(history, month, latest);
    if (sameMonth !== null) return result(sameMonth, "sameMonthLastYear", false);
    return result(nearestMonths(history, month), "nearestMonths", true);
  }
  const recent = ended.slice(-IRREGULAR_MONTHS).map((m) => history.get(m) as Money);
  return result(averageHalfUp(recent), "average", recent.length < IRREGULAR_MINIMUM);
}
