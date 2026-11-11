/**
 * Which month Plan shows and what the family can do to it. Plan shows the current month of the plan (or the
 * plan start while the plan hasn't started). A month with no row is only projected, an open or reopened month
 * takes assignments, and a closed month takes none until it is reopened (core's `assign` refuses it).
 */

import { type Facts, type Figures, type LocalDate, type Money, type Month, type MonthFigures, type MonthState, householdOf } from "@holt/core";

export type MonthAccess = "editable" | "projection" | "closed";

export interface PlanMonth {
  readonly month: Month;
  readonly figures: MonthFigures;
  readonly access: MonthAccess;
}

export function accessOf(state: MonthState): MonthAccess {
  switch (state) {
    case "open":
    case "reopened":
      return "editable";
    case "planned":
      return "projection";
    case "closed":
      return "closed";
  }
}

export function planMonthOf(facts: Facts, figures: Figures): PlanMonth | null {
  const { planStart } = householdOf(facts);
  const month = figures.current < planStart ? planStart : figures.current;
  const found = figures.months.get(month);
  return found === undefined ? null : { month, figures: found, access: accessOf(found.state) };
}

/** The fact beside Plan in the sidebar: money with no job, or more given out than there is. Nothing when every unit has a job, or when the month can't be assigned. */
export type PlanBadge = { readonly kind: "unassigned" | "overAssigned"; readonly amount: Money };

export function planBadge(facts: Facts, figures: Figures): PlanBadge | null {
  const month = planMonthOf(facts, figures);
  if (month === null || month.access !== "editable") return null;
  const { kind, amount } = month.figures.unassigned;
  return amount === 0 ? null : { kind, amount };
}

/**
 * The date every shared account's imported data reaches, which is the earliest of the accounts' "covers to"
 * dates. Null while any shared account has no booked row yet, because then nothing can be said about how far
 * the spending reaches.
 */
export function dataReachesTo(figures: Figures): LocalDate | null {
  let earliest: LocalDate | null = null;
  for (const status of figures.importStatus.accounts.values()) {
    if (status.coversTo === null) return null;
    if (earliest === null || status.coversTo < earliest) earliest = status.coversTo;
  }
  return earliest;
}
