/**
 * What a change would do, before the family makes it (decision record 0048, "The effects of a command").
 * `previewEffects` applies a command to the facts it is given, works out the figures before and after, and
 * reports what moved in the current month: the money with no job, each job's assigned amount, the savings
 * rate, each goal's date and the buffer's runway. It writes nothing and changes nothing it was given. The
 * result is plain data, so a screen can hold it or send it across the bridge as it is.
 */

import { type Command, apply } from "./commands/apply.ts";
import type { Refusal } from "./commands/refusal.ts";
import type { LocalDate, Month } from "./dates.ts";
import type { Facts } from "./facts.ts";
import { type BufferFigures, type Figures, type Unassigned, computeFigures } from "./figures/index.ts";
import { type Goal, goalsFrom } from "./figures/goals.ts";
import { type ExpectedIncome, savingsRatesFrom } from "./figures/savings-rate.ts";
import type { JobId } from "./ids.ts";
import { compareIds } from "./import/matching.ts";
import { type Money, money } from "./money.ts";

export interface EffectsOptions {
  /** Today, from the caller. */
  readonly asOf: LocalDate;
  /** Counted into the savings rate's money in, from the facts before and the facts after. */
  readonly expectedIncome?: ExpectedIncome;
}

/** A job whose assigned amount changes in the current month. A job the command adds has 0 before, and one it removes has 0 after. */
export interface JobEffect {
  readonly jobId: JobId;
  /** From the facts after the command, or before it for a job the command removes. */
  readonly name: string;
  readonly before: Money;
  readonly after: Money;
}

/** A save-up job whose months to go or ready month change. Null before for a job the command adds, null after for one it removes. */
export interface GoalEffect {
  readonly jobId: JobId;
  readonly name: string;
  readonly before: Goal | null;
  readonly after: Goal | null;
}

export interface Effects {
  /** The month these effects are for: the month of `asOf`. */
  readonly month: Month;
  readonly unassigned: { readonly before: Unassigned; readonly after: Unassigned };
  /** Ordered by job ID. */
  readonly jobs: readonly JobEffect[];
  /** In tenths of a percent, or null when no money is in. */
  readonly savingsRate: { readonly before: number | null; readonly after: number | null };
  /** Ordered by job ID. */
  readonly goals: readonly GoalEffect[];
  readonly buffer: { readonly before: BufferFigures; readonly after: BufferFigures };
}

export type EffectsPreview = { readonly ok: true; readonly effects: Effects } | { readonly ok: false; readonly refusal: Refusal };

/** Only the current month matters here, so a pass covers the plan up to it and no further. */
const horizon = { horizonMonths: 0 } as const;

function assignedByJob(figures: Figures): ReadonlyMap<JobId, Money> {
  const assigned = new Map<JobId, Money>();
  for (const [jobId, jobMonth] of figures.months.get(figures.current)?.jobs ?? []) assigned.set(jobId, jobMonth.assigned.amount);
  return assigned;
}

function unassignedOf(figures: Figures): Unassigned {
  return figures.months.get(figures.current)?.unassigned ?? { kind: "unassigned", amount: money(0) };
}

function rateOf(facts: Facts, figures: Figures, expectedIncome: ExpectedIncome | undefined): number | null {
  return savingsRatesFrom(facts, figures, expectedIncome === undefined ? {} : { expectedIncome })[0]?.tenths ?? null;
}

function jobEffects(before: Facts, after: Facts, figuresBefore: Figures, figuresAfter: Figures): JobEffect[] {
  const was = assignedByJob(figuresBefore);
  const now = assignedByJob(figuresAfter);
  const effects: JobEffect[] = [];
  for (const jobId of new Set([...was.keys(), ...now.keys()])) {
    const [b, a] = [was.get(jobId) ?? money(0), now.get(jobId) ?? money(0)];
    const name = (after.jobs.get(jobId) ?? before.jobs.get(jobId))?.name;
    if (b !== a && name !== undefined) effects.push({ jobId, name, before: b, after: a });
  }
  return effects.sort((x, y) => compareIds(x.jobId, y.jobId));
}

function goalEffects(before: Facts, after: Facts, figuresBefore: Figures, figuresAfter: Figures): GoalEffect[] {
  const was = goalsFrom(figuresBefore);
  const now = goalsFrom(figuresAfter);
  const effects: GoalEffect[] = [];
  for (const jobId of new Set([...was.keys(), ...now.keys()])) {
    const [b, a] = [was.get(jobId) ?? null, now.get(jobId) ?? null];
    const name = (after.jobs.get(jobId) ?? before.jobs.get(jobId))?.name;
    const moved = b === null || a === null || b.monthsToGo !== a.monthsToGo || b.readyMonth !== a.readyMonth;
    if (moved && name !== undefined) effects.push({ jobId, name, before: b, after: a });
  }
  return effects.sort((x, y) => compareIds(x.jobId, y.jobId));
}

/**
 * Applies `command` to `facts` (a batch too) without keeping the result, and reports what it would change in the
 * current month. A refusal comes back as `apply` gives it.
 */
export function previewEffects(facts: Facts, command: Command, { asOf, expectedIncome }: EffectsOptions): EffectsPreview {
  const result = apply(facts, command, { asOf });
  if (!result.ok) return result;
  const figuresBefore = computeFigures(facts, asOf, horizon);
  const figuresAfter = computeFigures(result.facts, asOf, horizon);
  return {
    ok: true,
    effects: {
      month: figuresBefore.current,
      unassigned: { before: unassignedOf(figuresBefore), after: unassignedOf(figuresAfter) },
      jobs: jobEffects(facts, result.facts, figuresBefore, figuresAfter),
      savingsRate: { before: rateOf(facts, figuresBefore, expectedIncome), after: rateOf(result.facts, figuresAfter, expectedIncome) },
      goals: goalEffects(facts, result.facts, figuresBefore, figuresAfter),
      buffer: { before: figuresBefore.buffer, after: figuresAfter.buffer },
    },
  };
}
