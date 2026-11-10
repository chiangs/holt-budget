/**
 * Jobs (domain model, "Job" and "The buffer"). A job's kind and the buffer's role never change. An evened-out
 * spend job always keeps its money. The buffer can't be deleted or stop being active. Any other job can be
 * deleted only while nothing refers to it and its bucket is empty; otherwise the family archives it.
 */

import type { Facts, Job, JobStatus, SaveUpTarget, SpendJob, SpendPlan } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import type { AccountId, GroupId, JobId } from "../ids.ts";
import type { Money } from "../money.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { type Outcome, type RefusalCode, patched, refuse } from "./refusal.ts";

export interface SpendJobChanges {
  readonly kind: "spend";
  readonly plan?: SpendPlan;
  readonly keepsMoney?: boolean;
  readonly seasonality?: SpendJob["seasonality"];
}

export interface SaveUpJobChanges {
  readonly kind: "saveUp";
  readonly target?: SaveUpTarget;
}

export interface PayIntoJobChanges {
  readonly kind: "payInto";
  readonly monthly?: Money;
  readonly payInto?: AccountId;
}

export interface JobChanges {
  readonly name?: string;
  readonly groupId?: GroupId;
  readonly essential?: boolean;
  readonly status?: JobStatus;
  /** Changes that fit only one kind of job, tagged with that kind. They must match the job's kind, which never changes. */
  readonly ofKind?: SpendJobChanges | SaveUpJobChanges | PayIntoJobChanges;
}

export type JobCommand =
  | { readonly kind: "addJob"; readonly job: Job }
  | { readonly kind: "changeJob"; readonly jobId: JobId; readonly changes: JobChanges }
  | { readonly kind: "deleteJob"; readonly jobId: JobId };

/** Every amount in a job's plan, by field, with its opening bucket. */
export function jobAmounts(job: Job): readonly (readonly [string, Money])[] {
  const amounts: [string, Money][] = [["opening", job.opening]];
  switch (job.kind) {
    case "spend":
      if (job.plan.mode === "setAmount") amounts.push(["plan.amount", job.plan.amount]);
      if (job.plan.mode === "evenOut") amounts.push(["plan.monthly", job.plan.monthly]);
      break;
    case "saveUp":
      amounts.push(["target", job.target.kind === "bufferMonths" ? job.target.monthly : job.target.amount]);
      break;
    case "payInto":
      amounts.push(["monthly", job.monthly]);
      break;
  }
  return amounts;
}

function isBuffer(job: Job): boolean {
  return job.kind === "saveUp" && job.role === "buffer";
}

/** An evened-out job always keeps its money, whatever the command said (decision 6). */
function settled(job: Job): Job {
  return job.kind === "spend" && job.plan.mode === "evenOut" && !job.keepsMoney ? { ...job, keepsMoney: true } : job;
}

function fault(job: Job): Exclude<RefusalCode, "breaksFacts"> | null {
  if (job.name.trim() === "") return "nameMissing";
  if (jobAmounts(job).some(([, amount]) => amount < 0)) return "negativeAmount";
  if (isBuffer(job) && job.status !== "active") return "bufferStaysActive";
  return null;
}

function put(facts: Facts, job: Job): Outcome {
  const problem = fault(job);
  return problem === null ? patched(editFacts(facts).put("jobs", settled(job))) : refuse(problem);
}

function withChanges(job: Job, { ofKind, ...common }: JobChanges): Job | null {
  const merged: Job = { ...job, ...common };
  if (ofKind === undefined) return merged;
  if (ofKind.kind !== merged.kind) return null;
  // The tag equals the job's kind, so spreading it keeps the job's kind and only its own fields change.
  return { ...merged, ...ofKind } as Job;
}

function referenced(facts: Facts, jobId: JobId): boolean {
  for (const assignment of facts.assignments.values()) if (assignment.jobId === jobId) return true;
  for (const { treatment } of facts.transactions.values()) {
    if (treatment.kind === "split" && treatment.allocations.some((a) => a.jobId === jobId)) return true;
    if (treatment.kind === "history" && treatment.jobId === jobId) return true;
  }
  for (const { result } of facts.rules.values()) {
    if (result.kind === "job" ? result.jobId === jobId : result.shares.some((share) => share.jobId === jobId)) return true;
  }
  return false;
}

export const jobHandlers: Handlers<JobCommand> = {
  addJob(facts, { job }) {
    if (facts.jobs.has(job.id)) return refuse("idTaken");
    return put(facts, job);
  },

  changeJob(facts, { jobId, changes }) {
    const job = facts.jobs.get(jobId);
    if (job === undefined) return refuse("jobNotFound");
    const next = withChanges(job, changes);
    if (next === null) return refuse("jobKindFixed");
    return put(facts, next);
  },

  deleteJob(facts, { jobId }, { asOf }) {
    const job = facts.jobs.get(jobId);
    if (job === undefined) return refuse("jobNotFound");
    if (isBuffer(job)) return refuse("bufferCannotBeDeleted");
    const bucket = computeFigures(facts, asOf, { horizonMonths: 0 }).jobs.get(jobId)?.bucket;
    if (bucket?.kind === "kept" && bucket.balance !== 0) return refuse("bucketHoldsMoney");
    if (referenced(facts, jobId)) return refuse("jobInUse");
    return patched(editFacts(facts).remove("jobs", jobId));
  },
};
