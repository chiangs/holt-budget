/**
 * The jobs table, worked out from the facts and the figures: groups in their order, each with its total,
 * and for each job what the month gave it, what it spent and one plain line of status. The status comes from
 * the figures and from the job's own settings, never from a guess, and the switches below name every kind of
 * job and every kind of month result, so a new kind fails to compile until the table says what it shows.
 */

import { type Facts, type Figures, type GroupId, type Job, type JobFigures, type JobId, type JobMonth, type JobStatus, type LocalDate, type Money, type Month, money } from "@holt/core";
import type { PlanMonth } from "./PlanMonth.model.ts";

export type InactiveStatus = Exclude<JobStatus, "active">;

export type PaidOn = { readonly kind: "notYet" } | { readonly kind: "paid"; readonly on: LocalDate | null };

export type StatusLine =
  /** Paused, finished or archived, with what its bucket still holds when it keeps money. */
  | { readonly kind: "inactive"; readonly status: InactiveStatus; readonly bucket: Money | null }
  | { readonly kind: "left"; readonly left: Money }
  | { readonly kind: "over"; readonly over: Money }
  /** An ended month's leftover went back to unassigned. Plan shows the current month, so this is for a month that has already ended. */
  | { readonly kind: "returned"; readonly amount: Money }
  | { readonly kind: "bucket"; readonly balance: Money; readonly target: Money | null; readonly readyBy: Month | null }
  | { readonly kind: "bucketShort"; readonly short: Money }
  | { readonly kind: "bufferGoal"; readonly balance: Money; readonly target: Money; readonly months: number }
  | { readonly kind: "payInto"; readonly accountName: string; readonly paid: PaidOn };

export interface PlanRow {
  readonly jobId: JobId;
  readonly name: string;
  readonly jobKind: Job["kind"];
  readonly status: JobStatus;
  readonly assigned: Money;
  /** The amount is the app's estimate of a bill (a month that isn't open yet), so it is marked ≈. */
  readonly estimated: boolean;
  /** Null for a job that doesn't spend and hasn't, which the table shows as a dash. */
  readonly spent: Money | null;
  readonly line: StatusLine;
  /** How far along the thin bar is, 0 to 100, or null when the row has no bar. */
  readonly progress: number | null;
}

export interface PlanGroup {
  readonly id: GroupId;
  readonly name: string;
  readonly rows: readonly PlanRow[];
  readonly assigned: Money;
  readonly spent: Money;
}

function assertNever(value: never): never {
  throw new Error(`Plan does not know ${JSON.stringify(value)}`);
}

/** A whole percent from 0 to 100, with no float in the amount: only the length of a bar. */
export function percentOf(part: Money, whole: Money): number {
  if (whole <= 0 || part <= 0) return 0;
  return Math.min(100, Math.floor((part * 100) / whole));
}

function paymentOf(facts: Facts, jobId: JobId, month: Month, spent: Money): PaidOn {
  if (spent <= 0) return { kind: "notYet" };
  let latest: LocalDate | null = null;
  for (const t of facts.transactions.values()) {
    if (t.treatment.kind !== "split" || !t.bookingDate.startsWith(month)) continue;
    if (!t.treatment.allocations.some((a) => a.jobId === jobId)) continue;
    if (latest === null || t.bookingDate > latest) latest = t.bookingDate;
  }
  return { kind: "paid", on: latest };
}

interface Status {
  readonly line: StatusLine;
  readonly progress: number | null;
}

function bucketStatus(job: Job, figures: Figures, balance: Money, short: boolean): Status {
  if (short) return { line: { kind: "bucketShort", short: money(-balance) }, progress: null };
  if (job.kind === "saveUp" && figures.buffer.kind === "buffer" && figures.buffer.jobId === job.id && figures.buffer.target > 0) {
    const { target, bufferMonths } = figures.buffer;
    return { line: { kind: "bufferGoal", balance, target, months: bufferMonths }, progress: percentOf(balance, target) };
  }
  if (job.kind === "saveUp" && job.target.kind === "amountByMonth") {
    return { line: { kind: "bucket", balance, target: job.target.amount, readyBy: job.target.readyBy }, progress: percentOf(balance, job.target.amount) };
  }
  return { line: { kind: "bucket", balance, target: null, readyBy: null }, progress: null };
}

function activeStatus(facts: Facts, figures: Figures, job: Job, jobMonth: JobMonth, month: Month): Status {
  switch (job.kind) {
    case "payInto":
      return {
        line: { kind: "payInto", accountName: facts.accounts.get(job.payInto)?.name ?? "", paid: paymentOf(facts, job.id, month, jobMonth.spent) },
        progress: null,
      };
    case "spend":
    case "saveUp": {
      const result = jobMonth.money;
      switch (result.kind) {
        case "left":
          return { line: { kind: "left", left: result.amount }, progress: jobMonth.spent > 0 ? percentOf(jobMonth.spent, jobMonth.assigned.amount) : null };
        case "over":
          return { line: { kind: "over", over: result.amount }, progress: 100 };
        case "returned":
          return { line: { kind: "returned", amount: result.amount }, progress: null };
        case "bucket":
          return bucketStatus(job, figures, result.end, false);
        case "short":
          return bucketStatus(job, figures, result.end, true);
        default:
          return assertNever(result);
      }
    }
    default:
      return assertNever(job);
  }
}

/** What the table says about one job in the month. A job that isn't active says so, whatever it spent. */
export function statusOf(facts: Facts, figures: Figures, jobFigures: JobFigures, jobMonth: JobMonth, month: Month): Status {
  const { job } = jobFigures;
  if (job.status !== "active") {
    const bucket = jobFigures.bucket.kind === "kept" && jobFigures.bucket.balance !== 0 ? jobFigures.bucket.balance : null;
    return { line: { kind: "inactive", status: job.status, bucket }, progress: null };
  }
  return activeStatus(facts, figures, job, jobMonth, month);
}

const statusOrder: Record<JobStatus, number> = { active: 0, paused: 1, finished: 2, archived: 3 };

function rowOf(facts: Facts, figures: Figures, jobFigures: JobFigures, month: Month): PlanRow | null {
  const { job } = jobFigures;
  const jobMonth = jobFigures.months.get(month);
  if (jobMonth === undefined) return null;
  const { line, progress } = statusOf(facts, figures, jobFigures, jobMonth, month);
  const spends = job.kind === "spend" || jobMonth.spent !== 0;
  return {
    jobId: job.id,
    name: job.name,
    jobKind: job.kind,
    status: job.status,
    assigned: jobMonth.assigned.amount,
    estimated: jobMonth.assigned.kind === "estimate",
    spent: spends ? jobMonth.spent : null,
    line,
    progress,
  };
}

/** Groups in their order, each with its jobs (live jobs first, then paused, finished and archived, each in the order the family made them) and its totals. */
export function planGroups(facts: Facts, figures: Figures, month: PlanMonth): PlanGroup[] {
  const groups = [...facts.groups.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return groups.map((group) => {
    const rows = [...facts.jobs.values()]
      .filter((job) => job.groupId === group.id)
      .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.id.localeCompare(b.id))
      .flatMap((job) => {
        const jobFigures = figures.jobs.get(job.id);
        const row = jobFigures === undefined ? null : rowOf(facts, figures, jobFigures, month.month);
        return row === null ? [] : [row];
      });
    const assigned = money(rows.reduce((sum, row) => sum + row.assigned, 0));
    const spent = money(rows.reduce((sum, row) => sum + (row.spent ?? 0), 0));
    return { id: group.id, name: group.name, rows, assigned, spent };
  });
}

/** Every row in the order the table shows them, for moving through them with the keyboard. */
export function rowsOf(groups: readonly PlanGroup[]): readonly PlanRow[] {
  return groups.flatMap((group) => group.rows);
}
