/**
 * Evening out a variable cost (decision 6 in the domain model).
 *
 * The family pays the real bills. When a job is evened out, the same amount is
 * assigned every month and a bucket absorbs the difference: it fills in cheap
 * months and pays out in expensive ones. These functions are pure and work on
 * a list of monthly estimates (or actuals) in øre.
 */

import { type Ore, ore, divideUp, roundUpTo, fromKroner, add } from "./money.ts";

/** The default rounding step for an evened-out monthly amount: 50 kr. */
export const EVEN_OUT_STEP: Ore = fromKroner(50);

/** The monthly amount: the 12-month estimate ÷ 12, rounded up to the step. */
export function evenedMonthlyAmount(monthlyBills: readonly Ore[], step: Ore = EVEN_OUT_STEP): Ore {
  if (monthlyBills.length === 0) return ore(0);
  return roundUpTo(divideUp(add(...monthlyBills), monthlyBills.length), step);
}

export interface BucketPathInput {
  /** Estimated (or actual) bill for each month, in order. */
  readonly bills: readonly Ore[];
  /** The fixed amount assigned each month once evening out has started. */
  readonly monthly: Ore;
  /** Money moved into the bucket before the first month (for example from Buffer). */
  readonly seed?: Ore;
  /** Index of the first evened-out month. Earlier months follow the bills and leave the bucket alone. */
  readonly startIndex?: number;
}

export interface BucketMonth {
  readonly index: number;
  readonly bill: Ore;
  /** What the plan assigns this month: the bill before the start, the fixed amount after. */
  readonly planned: Ore;
  /** The bucket's balance at the end of the month, or null before evening out starts. */
  readonly bucketEnd: Ore | null;
}

/** The bucket's balance month by month. */
export function bucketPath({ bills, monthly, seed = ore(0), startIndex = 0 }: BucketPathInput): BucketMonth[] {
  let balance: number = seed;
  return bills.map((bill, index) => {
    if (index < startIndex) {
      return { index, bill, planned: bill, bucketEnd: null };
    }
    balance += monthly - bill;
    return { index, bill, planned: monthly, bucketEnd: ore(balance) };
  });
}

/**
 * The smallest starting amount that keeps the bucket at or above zero,
 * plus an optional margin, rounded up to the step. Zero if no seed is needed.
 */
export function minimumSeed(
  bills: readonly Ore[],
  monthly: Ore,
  options: { margin?: Ore; step?: Ore; startIndex?: number } = {},
): Ore {
  const { margin = ore(0), step = EVEN_OUT_STEP, startIndex = 0 } = options;
  const path = bucketPath({ bills, monthly, startIndex });
  const lowest = Math.min(0, ...path.map((m) => m.bucketEnd ?? 0));
  if (lowest === 0) return ore(0);
  return roundUpTo(ore(-lowest + margin), step);
}
