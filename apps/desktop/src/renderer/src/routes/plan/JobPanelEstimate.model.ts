/**
 * "How Holt estimated this" as data: which method gave each month's estimate and which months of history it used,
 * read from core's `explainEstimate` through `jobEstimate`. The page never works an estimate out again. Months that
 * were estimated the same way are one line, so twelve months read as three or four sentences; the sentences are the
 * message file's. The last three months' line comes from the history as core gives it.
 */

import type { EstimateBasis, EstimateMonth, JobEstimate, JobHistory, Money, Month, Trend, UsedMonth } from "@holt/core";

/** One sentence about the estimate of one or more months. */
export type ExplainLine =
  | { readonly kind: "history"; readonly from: Month; readonly to: Month; readonly months: number }
  | { readonly kind: "enteredByYou"; readonly month: Month; readonly amount: Money; readonly appsOwn: Money | null }
  | { readonly kind: "fixed"; readonly from: Month; readonly to: Month }
  | { readonly kind: "plannedItems"; readonly from: Month; readonly to: Month }
  | { readonly kind: "noHistory"; readonly from: Month; readonly to: Month }
  | { readonly kind: "average"; readonly from: Month; readonly to: Month; readonly used: readonly UsedMonth[]; readonly rough: boolean }
  | { readonly kind: "sameMonthLastYear"; readonly from: Month; readonly to: Month; readonly trend: Trend | null; readonly rough: boolean }
  | { readonly kind: "nearestMonths"; readonly month: Month; readonly amount: Money; readonly peak: UsedMonth; readonly comparable: readonly UsedMonth[]; readonly rough: boolean }
  | { readonly kind: "unexplained"; readonly from: Month; readonly to: Month };

/**
 * The sentence for one month of the estimate, which is also what the chart shows when the family picks that month.
 * Every kind of method has its line here, so a new kind fails to compile until it does.
 */
export function lineOf(m: EstimateMonth): ExplainLine {
  const { basis } = m;
  switch (basis.kind) {
    case "enteredByYou":
      return { kind: "enteredByYou", month: m.month, amount: m.estimate.amount, appsOwn: m.appsOwn?.amount ?? null };
    case "fixed":
      return { kind: "fixed", from: m.month, to: m.month };
    case "plannedItems":
      return { kind: "plannedItems", from: m.month, to: m.month };
    case "noHistory":
      return { kind: "noHistory", from: m.month, to: m.month };
    case "average":
      return { kind: "average", from: m.month, to: m.month, used: basis.months, rough: m.estimate.rough };
    case "sameMonthLastYear":
      return { kind: "sameMonthLastYear", from: m.month, to: m.month, trend: basis.trend, rough: m.estimate.rough };
    case "nearestMonths":
      return { kind: "nearestMonths", month: m.month, amount: m.estimate.amount, peak: basis.peak, comparable: basis.comparable, rough: m.estimate.rough };
    case "unexplained":
      return { kind: "unexplained", from: m.month, to: m.month };
  }
}

const sameTrend = (a: Trend | null, b: Trend | null): boolean => (a === null || b === null ? a === b : a.recentTotal === b.recentTotal && a.yearBeforeTotal === b.yearBeforeTotal);

const sameUsed = (a: readonly UsedMonth[], b: readonly UsedMonth[]): boolean => a.length === b.length && a.every((u, i) => u.month === b[i]?.month && u.amount === b[i]?.amount);

/** Whether the next month's line says the same thing, so the two can be one line over a run of months. */
function joins(a: ExplainLine, b: ExplainLine): ExplainLine | null {
  switch (a.kind) {
    case "fixed":
    case "plannedItems":
    case "noHistory":
    case "unexplained":
      return b.kind === a.kind ? { ...a, to: b.to } : null;
    case "average":
      return b.kind === "average" && b.rough === a.rough && sameUsed(a.used, b.used) ? { ...a, to: b.to } : null;
    case "sameMonthLastYear":
      return b.kind === "sameMonthLastYear" && b.rough === a.rough && sameTrend(a.trend, b.trend) ? { ...a, to: b.to } : null;
    case "history":
    case "enteredByYou":
    case "nearestMonths":
      return null;
  }
}

export interface Working {
  readonly lines: readonly ExplainLine[];
}

/** The history the estimates are made from, then one line for each run of months estimated the same way. */
export function workingOf(history: JobHistory, estimate: JobEstimate): Working {
  const lines: ExplainLine[] = [];
  const { ended } = history;
  if (ended.from !== null && ended.to !== null) lines.push({ kind: "history", from: ended.from, to: ended.to, months: ended.months });
  let open: ExplainLine | null = null;
  for (const month of estimate.months) {
    const line = lineOf(month);
    const merged: ExplainLine | null = open === null ? null : joins(open, line);
    if (merged !== null) {
      open = merged;
      continue;
    }
    if (open !== null) lines.push(open);
    open = line;
  }
  if (open !== null) lines.push(open);
  return { lines };
}

// ── The last three months ──────────────────────────────────────────────────────

/** "You planned 2,900 each month and paid 2,760, 2,910 and 2,846. That is 184 kr under in total." */
export interface RecentLine {
  /** How many months the line covers, 1 to 3. */
  readonly months: number;
  /** What the plan gave: the same amount each month, a different one each month, or nothing for a month before the plan started. */
  readonly planned: { readonly kind: "same"; readonly amount: Money } | { readonly kind: "each"; readonly amounts: readonly Money[] } | { readonly kind: "none" };
  readonly paid: readonly Money[];
  /** What was planned less what was paid: positive is under, negative is over. Null when a month had no plan to compare with. */
  readonly underBy: Money | null;
}

export function recentLineOf(history: JobHistory): RecentLine | null {
  const { months, underBy } = history.recent;
  if (months.length === 0) return null;
  const planned = months.map((m) => m.planned);
  const known = planned.filter((p): p is Money => p !== null);
  const [first] = known;
  const allKnown = known.length === months.length;
  return {
    months: months.length,
    planned: !allKnown || first === undefined ? { kind: "none" } : known.every((p) => p === first) ? { kind: "same", amount: first } : { kind: "each", amounts: known },
    paid: months.map((m) => m.paid),
    underBy: allKnown ? underBy : null,
  };
}
