/**
 * What each kind of job means for its figures (decision record 0046; decisions 2, 6, 12 and 13): which
 * jobs keep their money, what a planned month projects, and whether a month ends with money in the
 * bucket, money left, money returned to unassigned, or the job over.
 */

import { type Month, monthsBetween } from "../dates.ts";
import type { Estimate } from "../estimate.ts";
import type { Job } from "../facts.ts";
import { type Money, divideUp, money } from "../money.ts";
import type { EstimateFor } from "./estimates.ts";

/** What a job is given in a month, and where that figure comes from. */
export type Assigned =
  /** An open, closed or reopened month: the family's assignment, or 0 when there is none. */
  | { readonly kind: "assignment"; readonly amount: Money }
  /** A planned month: the amount the job's plan projects. */
  | { readonly kind: "projection"; readonly amount: Money }
  /** A planned month of a job that follows the bills: the estimate, shown with ≈ and its method. */
  | { readonly kind: "estimate"; readonly amount: Money; readonly estimate: Estimate };

/** Where a job's money stands at the end of a month. */
export type JobMonthMoney =
  /** A job that keeps its money, with its bucket at the start and end of the month. */
  | { readonly kind: "bucket"; readonly start: Money; readonly end: Money }
  /** A bucket that ended the month below zero. `end` is negative. */
  | { readonly kind: "short"; readonly start: Money; readonly end: Money }
  /** A job that doesn't keep its money, with this much left in a month that hasn't ended. */
  | { readonly kind: "left"; readonly amount: Money }
  /** An ended month's leftover, returned to unassigned (decision 2). */
  | { readonly kind: "returned"; readonly amount: Money }
  /** Spent this much more than assigned. It stays until the family changes the month's assignments and never reduces the next month (decision 13). */
  | { readonly kind: "over"; readonly amount: Money };

/** What the job costs in the month (rule 12). Once a month has ended, the actual spending replaces the estimate. */
export type Cost =
  | { readonly kind: "actual"; readonly amount: Money }
  | { readonly kind: "estimate"; readonly estimate: Estimate }
  /** A save-up or pay-into job in a month that hasn't ended: it has no bills to estimate. */
  | { readonly kind: "notEstimated" };

export interface JobMonth {
  readonly month: Month;
  readonly assigned: Assigned;
  /** Minus the allocations to the job in the month, so a refund reduces it. */
  readonly spent: Money;
  readonly money: JobMonthMoney;
  readonly cost: Cost;
}

/** The money a job keeps, at the end of the current month. */
export type JobBucket = { readonly kind: "kept"; readonly balance: Money } | { readonly kind: "absent" };

export interface JobFigures {
  readonly job: Job;
  /** The job in each plan month, in order. */
  readonly months: ReadonlyMap<Month, JobMonth>;
  readonly bucket: JobBucket;
}

/** Save-up jobs, the buffer, pay-into jobs and evened-out spend jobs always keep their money. Other spend jobs keep it when they carry over. */
export function keepsMoney(job: Job): boolean {
  switch (job.kind) {
    case "spend":
      return job.keepsMoney || job.plan.mode === "evenOut";
    case "saveUp":
    case "payInto":
      return true;
  }
}

function projected(amount: Money): Assigned {
  return { kind: "projection", amount };
}

function estimated(estimate: Estimate): Assigned {
  return { kind: "estimate", amount: estimate.amount, estimate };
}

/** A planned month's assigned amount, from the job's plan. `bucketBefore` is the bucket at the end of the month before. */
export function projection(job: Job, m: Month, bucketBefore: Money, estimateFor: EstimateFor): Assigned {
  if (job.status !== "active") return projected(money(0));
  switch (job.kind) {
    case "spend": {
      const plan = job.plan;
      switch (plan.mode) {
        case "setAmount":
          return projected(plan.amount);
        case "followBills":
          return estimated(estimateFor(job, m));
        case "evenOut":
          return m >= plan.startMonth ? projected(plan.monthly) : estimated(estimateFor(job, m));
      }
    }
    case "saveUp": {
      const target = job.target;
      switch (target.kind) {
        case "amountByMonth": {
          if (m > target.readyBy) return projected(money(0));
          const stillNeeded = money(Math.max(0, target.amount - bucketBefore));
          return projected(divideUp(stillNeeded, monthsBetween(m, target.readyBy) + 1));
        }
        case "monthly":
          return projected(target.amount);
        case "bufferMonths":
          return projected(target.monthly);
      }
    }
    case "payInto":
      return projected(job.monthly);
  }
}

/** Where the job's money stands at the end of the month. `start` is the bucket before the month, for a job that keeps its money. */
export function monthMoney(keeps: boolean, start: Money, assigned: Money, spent: Money, ended: boolean): JobMonthMoney {
  if (keeps) {
    const end = money(start + assigned - spent);
    return end < 0 ? { kind: "short", start, end } : { kind: "bucket", start, end };
  }
  const leftover = assigned - spent;
  if (leftover < 0) return { kind: "over", amount: money(-leftover) };
  return { kind: ended ? "returned" : "left", amount: money(leftover) };
}

export function costOf(job: Job, m: Month, spent: Money, ended: boolean, estimateFor: EstimateFor): Cost {
  if (ended) return { kind: "actual", amount: spent };
  return job.kind === "spend" ? { kind: "estimate", estimate: estimateFor(job, m) } : { kind: "notEstimated" };
}
