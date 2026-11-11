/**
 * Where the money for a new job could come from (decision record 0048, "Where to take money from"). Every
 * krone already has a job, so a new job is paid first from the money with no job yet and then from other jobs'
 * assignments. Those are offered as one split across the jobs that can give and as one option for each job that
 * can cover the rest alone. An essential job is never offered, because giving up its money would put a bill at risk.
 * The options are plain data, and `fundingCommands` turns one into the commands that make it so.
 */

import { type LocalDate, type Month, monthOf, monthsBetween } from "./dates.ts";
import type { Command } from "./commands/apply.ts";
import { type Figures, computeFigures } from "./figures/index.ts";
import type { JobId } from "./ids.ts";
import { compareIds } from "./import/matching.ts";
import { type Money, money } from "./money.ts";
import type { Facts } from "./facts.ts";

/** This much comes out of this job's assignment for the month. */
export interface FundingMove {
  readonly from: JobId;
  readonly amount: Money;
}

export interface FundingOption {
  /** `unassigned` when the money with no job covers the amount, so no job gives up anything. */
  readonly kind: "unassigned" | "split" | "single";
  /** How much of the amount comes from money with no job yet. The moves cover the rest. */
  readonly fromUnassigned: Money;
  readonly moves: readonly FundingMove[];
}

export interface FundingRequest {
  /** The month the new job is paid in. It must be open or reopened for the commands to be accepted. */
  readonly month: Month;
  readonly amount: Money;
  /** Jobs the family doesn't want to take from, or the job being paid. */
  readonly exclude?: readonly JobId[];
}

export interface FundingOptions {
  readonly month: Month;
  readonly amount: Money;
  /** What the month has with no job. Zero when it is over-assigned. */
  readonly unassigned: Money;
  /** The most the jobs that could give would give together. */
  readonly givable: Money;
  /** What no option covers. Zero whenever there is an option, and otherwise `amount` less `unassigned` and `givable`. */
  readonly shortfall: Money;
  /** One split, when two or more jobs can share it, then one option for each job that covers the rest alone, largest assignment first. Empty when there is a shortfall. */
  readonly options: readonly FundingOption[];
}

interface Giver {
  readonly jobId: JobId;
  readonly assigned: Money;
}

/**
 * `total` in even shares across `capacities`, the remainder to the first, no share above its capacity. A job that
 * cannot take its share gives all it has and the others take the difference. The capacities must add up to at least `total`.
 */
function evenShares(total: number, capacities: readonly number[]): number[] {
  const shares = capacities.map(() => 0);
  let open = capacities.map((_, i) => i);
  let left = total;
  while (open.length > 0) {
    const base = Math.floor(left / open.length);
    const wanted = open.map((_, position) => base + (position === 0 ? left - base * open.length : 0));
    const tooSmall = open.filter((i, position) => (wanted[position] as number) > (capacities[i] as number));
    if (tooSmall.length === 0) {
      open.forEach((i, position) => (shares[i] = wanted[position] as number));
      break;
    }
    for (const i of tooSmall) {
      shares[i] = capacities[i] as number;
      left -= capacities[i] as number;
    }
    open = open.filter((i) => !tooSmall.includes(i));
  }
  return shares;
}

export function fundingOptionsFrom(figures: Figures, { month, amount, exclude = [] }: FundingRequest): FundingOptions {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`The amount must be a whole number of minor units, 0 or more: ${amount}`);
  const monthFigures = figures.months.get(month);
  const free = monthFigures?.unassigned.kind === "unassigned" ? monthFigures.unassigned.amount : money(0);
  const fromUnassigned = money(Math.min(amount, free));
  const rest = amount - fromUnassigned;

  const givers: Giver[] = [];
  for (const [jobId, jobMonth] of monthFigures?.jobs ?? []) {
    const job = figures.jobs.get(jobId)?.job;
    if (job === undefined || job.status !== "active" || job.essential || exclude.includes(jobId) || jobMonth.assigned.amount <= 0) continue;
    givers.push({ jobId, assigned: jobMonth.assigned.amount });
  }
  givers.sort((a, b) => b.assigned - a.assigned || compareIds(a.jobId, b.jobId));
  const givable = money(givers.reduce((sum, g) => sum + g.assigned, 0));
  const result = (shortfall: number, options: readonly FundingOption[]): FundingOptions => ({ month, amount, unassigned: free, givable, shortfall: money(shortfall), options });

  if (rest === 0) return result(0, [{ kind: "unassigned", fromUnassigned, moves: [] }]);
  if (givable < rest) return result(rest - givable, []);

  const options: FundingOption[] = [];
  const shares = evenShares(rest, givers.map((g) => g.assigned));
  const split = givers.flatMap((g, i): FundingMove[] => ((shares[i] as number) > 0 ? [{ from: g.jobId, amount: money(shares[i] as number) }] : []));
  if (split.length >= 2) options.push({ kind: "split", fromUnassigned, moves: split });
  for (const g of givers) if (g.assigned >= rest) options.push({ kind: "single", fromUnassigned, moves: [{ from: g.jobId, amount: money(rest) }] });
  return result(0, options);
}

/** The options for paying `amount` in a month, as of `asOf`. */
export function fundingOptions(facts: Facts, request: FundingRequest, asOf: LocalDate): FundingOptions {
  return fundingOptionsFrom(computeFigures(facts, asOf, { horizonMonths: Math.max(0, monthsBetween(monthOf(asOf), request.month)) }), request);
}

/**
 * The commands that give job `to` what the option says: the money with no job first, then each move out of another
 * job's assignment. `to` must exist already (the caller's `addJob` comes first) and its month must be open. `alreadyAssigned` is what
 * `to` has in the month, because `assign` sets an amount and does not add to it.
 */
export function fundingCommands(option: FundingOption, to: JobId, month: Month, alreadyAssigned: Money = money(0)): Command[] {
  return [
    ...(option.fromUnassigned > 0 ? [{ kind: "assign", month, jobId: to, amount: money(alreadyAssigned + option.fromUnassigned) } satisfies Command] : []),
    ...option.moves.map((move): Command => ({ kind: "moveAssignment", month, from: move.from, to, amount: move.amount })),
  ];
}
