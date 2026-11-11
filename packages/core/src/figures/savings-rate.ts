/**
 * The savings rate (decision record 0048, "Savings rate"): what the month's plan saves, as a share of the
 * money coming in. Saving is the month's assigned amount for every job in a group that counts towards the
 * savings rate and for every pay-into job. Money in is the income that funds the month plus the income still
 * expected, which only the caller can work out (contributions are built apart from the figures).
 */

import type { LocalDate, Month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { type Money, money } from "../money.ts";
import { type Figures, computeFigures } from "./index.ts";

/** Income still expected to arrive for a month, worked out from `facts`, which may be the facts after a change. */
export type ExpectedIncome = (facts: Facts, month: Month) => Money;

export interface SavingsRateOptions {
  /** Without it, money in is the income that has arrived. */
  readonly expectedIncome?: ExpectedIncome;
}

export interface SavingsRateMonth {
  readonly month: Month;
  readonly saving: Money;
  readonly moneyIn: Money;
  /** In tenths of a percent, rounded to the nearest, so 9.9% is 99. Null when no money is in. It can pass 1000 when more is saved than comes in. */
  readonly tenths: number | null;
}

/** `saving` as a share of `moneyIn` in tenths of a percent, by integer arithmetic so that no float enters a figure. */
function tenthsOfAPercent(saving: Money, moneyIn: Money): number | null {
  return moneyIn > 0 ? Math.floor((saving * 2000 + moneyIn) / (2 * moneyIn)) : null;
}

/** The rate for each month from the current one to the end of these figures, in order. */
export function savingsRatesFrom(facts: Facts, figures: Figures, options: SavingsRateOptions = {}): readonly SavingsRateMonth[] {
  const counts = new Set<string>();
  for (const { job } of figures.jobs.values()) {
    if (job.kind === "payInto" || facts.groups.get(job.groupId)?.countsTowardsSavingsRate === true) counts.add(job.id);
  }
  const rates: SavingsRateMonth[] = [];
  for (const [m, monthFigures] of figures.months) {
    if (m < figures.current) continue;
    let saving = 0;
    for (const [jobId, jobMonth] of monthFigures.jobs) if (counts.has(jobId)) saving += jobMonth.assigned.amount;
    const moneyIn = money(monthFigures.income + (options.expectedIncome?.(facts, m) ?? 0));
    rates.push({ month: m, saving: money(saving), moneyIn, tenths: tenthsOfAPercent(money(saving), moneyIn) });
  }
  return rates;
}

/** The savings rate for each month from the current one to the horizon, as of `asOf`. */
export function savingsRate(facts: Facts, asOf: LocalDate, options: SavingsRateOptions = {}): readonly SavingsRateMonth[] {
  return savingsRatesFrom(facts, computeFigures(facts, asOf), options);
}
