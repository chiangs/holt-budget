/**
 * Budget months and their assignments (domain model, "Budget month" and "Assignment"; decisions 3, 12 and 13).
 * Months open one after another from the plan start. Opening a month turns its projections into assignments,
 * and from then on only the family changes them: no command here touches an assignment it doesn't name, so
 * nothing covers an overspend by itself. An assignment of zero is no row, as the figures read it.
 */

import { type Month, addMonths, monthOf, monthsBetween } from "../dates.ts";
import { type Facts, assignmentKey, householdOf } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { type FactsEditor, editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { patched, refuse } from "./refusal.ts";

export type MonthCommand =
  | { readonly kind: "openMonth"; readonly month: Month }
  | { readonly kind: "closeMonth"; readonly month: Month }
  | { readonly kind: "reopenMonth"; readonly month: Month }
  /** Set one job's assignment in one month. */
  | { readonly kind: "assign"; readonly month: Month; readonly jobId: JobId; readonly amount: Money }
  /** Move money from one job's assignment to another's in the same month, as one change. */
  | { readonly kind: "moveAssignment"; readonly month: Month; readonly from: JobId; readonly to: JobId; readonly amount: Money };

/** The plan start, or the month after the last one opened. */
export function nextMonthToOpen(facts: Facts): Month {
  let last: Month | undefined;
  for (const m of facts.budgetMonths.keys()) if (last === undefined || m > last) last = m;
  return last === undefined ? householdOf(facts).planStart : addMonths(last, 1);
}

function takesAssignments(facts: Facts, m: Month): boolean {
  const state = facts.budgetMonths.get(m)?.state;
  return state === "open" || state === "reopened";
}

function setAssignment(editor: FactsEditor, m: Month, jobId: JobId, amount: Money): FactsEditor {
  return amount === 0 ? editor.remove("assignments", assignmentKey(m, jobId)) : editor.put("assignments", { month: m, jobId, amount });
}

function assigned(facts: Facts, m: Month, jobId: JobId): Money {
  return facts.assignments.get(assignmentKey(m, jobId))?.amount ?? money(0);
}

export const monthHandlers: Handlers<MonthCommand> = {
  openMonth(facts, { month: m }, { asOf }) {
    if (m !== nextMonthToOpen(facts)) return refuse("monthNotNext");
    const figures = computeFigures(facts, asOf, { horizonMonths: Math.max(0, monthsBetween(monthOf(asOf), m)) });
    const editor = editFacts(facts).put("budgetMonths", { month: m, state: "open" });
    for (const [jobId, jobMonth] of figures.months.get(m)?.jobs ?? []) setAssignment(editor, m, jobId, jobMonth.assigned.amount);
    return patched(editor);
  },

  closeMonth(facts, { month: m }) {
    if (!takesAssignments(facts, m)) return refuse("monthNotOpen");
    return patched(editFacts(facts).put("budgetMonths", { month: m, state: "closed" }));
  },

  reopenMonth(facts, { month: m }) {
    if (facts.budgetMonths.get(m)?.state !== "closed") return refuse("monthNotClosed");
    return patched(editFacts(facts).put("budgetMonths", { month: m, state: "reopened" }));
  },

  assign(facts, { month: m, jobId, amount }) {
    if (!facts.jobs.has(jobId)) return refuse("jobNotFound");
    if (!takesAssignments(facts, m)) return refuse("monthNotOpen");
    if (amount < 0) return refuse("negativeAmount");
    return patched(setAssignment(editFacts(facts), m, jobId, amount));
  },

  moveAssignment(facts, { month: m, from, to, amount }) {
    if (!facts.jobs.has(from) || !facts.jobs.has(to)) return refuse("jobNotFound");
    if (!takesAssignments(facts, m)) return refuse("monthNotOpen");
    if (from === to) return refuse("sameJob");
    if (amount <= 0) return refuse("amountNotPositive");
    const source = assigned(facts, m, from);
    if (amount > source) return refuse("moveExceedsAssignment");
    const editor = setAssignment(editFacts(facts), m, from, money(source - amount));
    return patched(setAssignment(editor, m, to, money(assigned(facts, m, to) + amount)));
  },
};
