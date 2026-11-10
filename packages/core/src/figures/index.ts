/**
 * The one pure function that works out every figure from the facts (domain model, "Facts and figures";
 * decision record 0046). It never reads a clock: `asOf` is today, given by the caller. Every figure is
 * typed data a screen reads as it is, without working anything out again.
 */

import { type LocalDate, type Month, addMonths, monthOf, monthRange } from "../dates.ts";
import { estimate as defaultEstimate } from "../estimate.ts";
import { type Facts, householdOf } from "../facts.ts";
import type { AccountId, JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { type AccountFigures, accountFigures } from "./accounts.ts";
import { type BufferFigures, bufferFigures } from "./buffer.ts";
import { type StaleEnteredValue, latestEnteredValues, staleEnteredValues } from "./entered-values.ts";
import { type EstimateFunction, estimatesFor } from "./estimates.ts";
import { type ImportStatusFigures, importStatuses } from "./import-status.ts";
import type { JobFigures } from "./jobs.ts";
import { type MonthFigures, planFigures } from "./months.ts";
import { type NeedsYouItem, needsYouItems } from "./needs-you.ts";
import { indexTransactions } from "./transactions.ts";

export type { AccountBalance, AccountFigures, BucketInAccount, MonthlyMove, Remainder } from "./accounts.ts";
export type { BufferFigures, Runway } from "./buffer.ts";
export type { StaleEnteredValue } from "./entered-values.ts";
export type { EstimateFunction } from "./estimates.ts";
export type { ImportState, ImportStatus, ImportStatusFigures, LastImport } from "./import-status.ts";
export type { Assigned, Cost, JobBucket, JobFigures, JobMonth, JobMonthMoney } from "./jobs.ts";
export { keepsMoney } from "./jobs.ts";
export type { MonthFigures, MonthState, MonthTiming, Unassigned } from "./months.ts";
export type { NeedsYouItem, NeedsYouSuggestion } from "./needs-you.ts";
export { needsYouItems } from "./needs-you.ts";
export { importStatuses } from "./import-status.ts";

/** Money that has arrived for next month (decision 1). It is never part of a bucket, the buffer or the runway (rule 11). */
export interface NextMonthsMoney {
  readonly month: Month;
  readonly amount: Money;
}

export interface Figures {
  readonly asOf: LocalDate;
  /** The month of `asOf`. Months before it have ended. */
  readonly current: Month;
  /** Every plan month from the plan start to the horizon, in order. */
  readonly months: ReadonlyMap<Month, MonthFigures>;
  readonly jobs: ReadonlyMap<JobId, JobFigures>;
  readonly accounts: ReadonlyMap<AccountId, AccountFigures>;
  readonly buffer: BufferFigures;
  readonly nextMonthsMoney: NextMonthsMoney;
  /** Entered values more than twelve months old, for the family to check (rule 10). */
  readonly staleEnteredValues: readonly StaleEnteredValue[];
  /**
   * Every transaction waiting for the family, newest first, each with what the app suggests (decision 0047).
   * Worked out when first read, so a pass nobody asks it of (a balance check, closing a month) doesn't pay for it.
   */
  readonly needsYou: readonly NeedsYouItem[];
  /** Whether each shared account's data is up to date, and how many are due. Worked out when first read. */
  readonly importStatus: ImportStatusFigures;
}

export interface FiguresOptions {
  /** How many months after the current one the figures cover. 12 by default. */
  readonly horizonMonths?: number;
  /** The estimate method. Tests pass their own. */
  readonly estimate?: EstimateFunction;
}

export function computeFigures(facts: Facts, asOf: LocalDate, options: FiguresOptions = {}): Figures {
  const horizonMonths = options.horizonMonths ?? 12;
  if (!Number.isInteger(horizonMonths) || horizonMonths < 0) throw new RangeError(`The horizon must be a whole number of months, 0 or more: ${horizonMonths}`);

  const current = monthOf(asOf);
  const next = addMonths(current, 1);
  const index = indexTransactions(facts, asOf);
  const latest = latestEnteredValues(facts, asOf);
  const estimateFor = estimatesFor(index, latest, current, options.estimate ?? defaultEstimate);
  const plan = planFigures(facts, monthRange(householdOf(facts).planStart, addMonths(current, horizonMonths)), current, index, estimateFor);

  let needsYou: readonly NeedsYouItem[] | undefined;
  let importStatus: ImportStatusFigures | undefined;
  return {
    asOf,
    current,
    months: plan.months,
    jobs: plan.jobs,
    accounts: accountFigures(facts, plan, index, latest, current),
    buffer: bufferFigures(facts, plan, current, latest),
    nextMonthsMoney: { month: next, amount: index.income.get(next) ?? money(0) },
    staleEnteredValues: staleEnteredValues(latest, asOf),
    get needsYou() {
      return (needsYou ??= needsYouItems(facts));
    },
    get importStatus() {
      return (importStatus ??= importStatuses(facts, asOf));
    },
  };
}
