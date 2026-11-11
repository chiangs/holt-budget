/**
 * What the change would do, as the tiles under "Where does the money come from?". Core's `previewEffects`
 * says what moves in the current month; this keeps what a family can read: the jobs that give money up, the
 * money with no job, the savings rate, the goals that finish later and the buffer's runway. A part that does
 * not change has no tile, and the job the flow adds has none either, because the form already says what it gets.
 * The sentences, with their months and percentages, are the message file's. Nothing here is worked out twice:
 * a goal's months to go and the rate in tenths come from core as they are.
 */

import {
  type Effects,
  type Facts,
  type FamilyCommand,
  type JobId,
  type LocalDate,
  type Money,
  type Month,
  type Refusal,
  type Runway,
  type Unassigned,
  expectedIncome,
  money,
  monthOf,
  monthsBetween,
  previewEffects,
} from "@holt/core";

export interface JobTile {
  readonly jobId: JobId;
  readonly name: string;
  readonly before: Money;
  readonly after: Money;
}

export interface RateTile {
  /** In tenths of a percent: 99 is 9.9%. Null when no money is in. */
  readonly before: number | null;
  readonly after: number | null;
}

export interface UnassignedTile {
  readonly before: Unassigned;
  readonly after: Unassigned;
}

export interface RunwayTile {
  readonly before: Runway;
  readonly after: Runway;
}

/** A goal that finishes at another time. `buffer` is set for the buffer, whose target is months of essential spending. */
export type GoalNote =
  | { readonly kind: "later"; readonly jobId: JobId; readonly name: string; readonly months: number; readonly ready: Month; readonly buffer: number | null }
  | { readonly kind: "earlier"; readonly jobId: JobId; readonly name: string; readonly months: number; readonly ready: Month; readonly buffer: number | null }
  /** It had no date to be ready by and now has one. */
  | { readonly kind: "gainsDate"; readonly jobId: JobId; readonly name: string; readonly ready: Month; readonly buffer: number | null }
  /** It had a date and is given nothing now, so it has none. */
  | { readonly kind: "losesDate"; readonly jobId: JobId; readonly name: string; readonly buffer: number | null };

export interface EffectTiles {
  readonly month: Month;
  readonly unassigned: UnassignedTile | null;
  readonly jobs: readonly JobTile[];
  readonly savingsRate: RateTile | null;
  readonly goals: readonly GoalNote[];
  readonly runway: RunwayTile | null;
}

/** Which part of the tiles shows each part of the effects. A new part of `Effects` fails to compile here until it is shown or left out on purpose. */
export const shownAs: Record<keyof Effects, keyof EffectTiles> = {
  month: "month",
  unassigned: "unassigned",
  jobs: "jobs",
  savingsRate: "savingsRate",
  goals: "goals",
  buffer: "runway",
};

const sameRunway = (a: Runway, b: Runway): boolean => (a.kind === "noEssentials" ? b.kind === "noEssentials" : b.kind === "tenthsOfAMonth" && a.tenths === b.tenths);

function goalNote(effect: Effects["goals"][number], bufferMonths: (jobId: JobId) => number | null): GoalNote | null {
  const { before, after, jobId, name } = effect;
  if (before === null || after === null) return null;
  const buffer = bufferMonths(jobId);
  const was = before.monthsToGo;
  const now = after.monthsToGo;
  if (was !== null && now !== null) {
    if (now === was || after.readyMonth === null) return null;
    return { kind: now > was ? "later" : "earlier", jobId, name, months: Math.abs(now - was), ready: after.readyMonth, buffer };
  }
  if (was === null && now !== null && after.readyMonth !== null) return { kind: "gainsDate", jobId, name, ready: after.readyMonth, buffer };
  if (was !== null && now === null) return { kind: "losesDate", jobId, name, buffer };
  return null;
}

/** The tiles for what a change would do. `except` is the job the change adds, which gets no tile of its own. */
export function effectTiles(effects: Effects, except: JobId): EffectTiles {
  const bufferJob = effects.buffer.after.kind === "buffer" ? effects.buffer.after.jobId : null;
  const bufferMonths = (jobId: JobId): number | null => (jobId === bufferJob && effects.buffer.after.kind === "buffer" ? effects.buffer.after.bufferMonths : null);
  const { before, after } = effects.unassigned;
  return {
    month: effects.month,
    unassigned: before.kind === after.kind && before.amount === after.amount ? null : { before, after },
    jobs: effects.jobs.filter((job) => job.jobId !== except),
    savingsRate: effects.savingsRate.before === effects.savingsRate.after ? null : effects.savingsRate,
    goals: effects.goals.filter((goal) => goal.jobId !== except).flatMap((goal) => goalNote(goal, bufferMonths) ?? []),
    runway: effects.buffer.before.kind === "buffer" && effects.buffer.after.kind === "buffer" && !sameRunway(effects.buffer.before.runway, effects.buffer.after.runway) ? { before: effects.buffer.before.runway, after: effects.buffer.after.runway } : null,
  };
}

/** Whether there is anything to say about what the change does. */
export function changesNothing(tiles: EffectTiles): boolean {
  return tiles.unassigned === null && tiles.jobs.length === 0 && tiles.savingsRate === null && tiles.goals.length === 0 && tiles.runway === null;
}

/** A rate in tenths of a percent as text: 99 is "9.9", and no float stands for it. */
export function tenthsText(tenths: number, decimalSeparator: "," | "."): string {
  const sign = tenths < 0 ? "-" : "";
  const absolute = Math.abs(tenths);
  return `${sign}${Math.floor(absolute / 10)}${decimalSeparator}${absolute % 10}`;
}

/** The contributions the agreements still wait for in a month, for the savings rate's money in, worked out for the facts it is given. */
export function expectedIncomeAt(asOf: LocalDate): (facts: Facts, month: Month) => Money {
  return (facts, month) => {
    const months = monthsBetween(monthOf(asOf), month);
    return months < 0 ? money(0) : (expectedIncome(facts, asOf, months).find((entry) => entry.month === month)?.amount ?? money(0));
  };
}

export type PreviewedTiles = { readonly ok: true; readonly tiles: EffectTiles } | { readonly ok: false; readonly refusal: Refusal };

/**
 * What `command` would do to the current month, as tiles. `command` is the exact batch that Add job would run,
 * applied to the facts before it, so the preview and the change cannot disagree. A refusal comes back as core gives it.
 */
export function previewOf(facts: Facts, command: FamilyCommand, asOf: LocalDate, except: JobId): PreviewedTiles {
  const preview = previewEffects(facts, command, { asOf, expectedIncome: expectedIncomeAt(asOf) });
  return preview.ok ? { ok: true, tiles: effectTiles(preview.effects, except) } : { ok: false, refusal: preview.refusal };
}
