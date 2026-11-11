/**
 * What the banner at the top of Plan says about the month: whether the family can change it, and whether
 * every unit of money has a job (rule 4). Money with no job can go to the jobs that keep money in one click,
 * and the choices are worked out here so the screen only draws them.
 */

import { type FamilyCommand, type Facts, type Figures, type Job, type JobId, type Money, type Month, money, nextMonthToOpen } from "@holt/core";
import type { PlanMonth } from "./PlanMonth.model.ts";

/** One click that gives all the unassigned money to a job that keeps money. */
export interface QuickAdd {
  readonly jobId: JobId;
  readonly name: string;
  /** What the job has assigned now plus everything that is unassigned. */
  readonly assignTo: Money;
}

export type Banner =
  /** The month has no budget row yet, so its amounts are projections. `toOpen` is the month the family can open next, which is this one only when no earlier month waits. */
  | { readonly kind: "notOpen"; readonly month: Month; readonly toOpen: Month }
  | { readonly kind: "closed"; readonly month: Month }
  | { readonly kind: "overAssigned"; readonly amount: Money }
  | { readonly kind: "unassigned"; readonly amount: Money; readonly quickAdds: readonly QuickAdd[] }
  | { readonly kind: "none" };

const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function bucketOf(figures: Figures, jobId: JobId): Money {
  const bucket = figures.jobs.get(jobId)?.bucket;
  return bucket?.kind === "kept" ? bucket.balance : money(0);
}

/**
 * The jobs the unassigned money can go to in one click, at most two: the buffer, then the ordinary save-up job
 * with the largest target that its bucket hasn't reached. A job that is paused, finished or archived is left
 * out, and so is a save-up job with no target to reach.
 */
export function quickAddJobs(facts: Facts, figures: Figures): readonly Job[] {
  const chosen: Job[] = [];
  if (figures.buffer.kind === "buffer") {
    const buffer = facts.jobs.get(figures.buffer.jobId);
    if (buffer?.status === "active") chosen.push(buffer);
  }
  const goals = [...facts.jobs.values()].flatMap((job) => {
    if (job.kind !== "saveUp" || job.role !== "ordinary" || job.status !== "active" || job.target.kind !== "amountByMonth") return [];
    const target = job.target.amount;
    return bucketOf(figures, job.id) < target ? [{ job, target }] : [];
  });
  goals.sort((a, b) => b.target - a.target || byName.compare(a.job.name, b.job.name) || a.job.id.localeCompare(b.job.id));
  return [...chosen, ...goals.map(({ job }) => job)].slice(0, 2);
}

export function bannerOf(facts: Facts, figures: Figures, month: PlanMonth): Banner {
  switch (month.access) {
    case "projection":
      return { kind: "notOpen", month: month.month, toOpen: nextMonthToOpen(facts) };
    case "closed":
      return { kind: "closed", month: month.month };
    case "editable": {
      const { unassigned } = month.figures;
      if (unassigned.kind === "overAssigned") return { kind: "overAssigned", amount: unassigned.amount };
      if (unassigned.amount === 0) return { kind: "none" };
      const quickAdds = quickAddJobs(facts, figures).map((job) => ({
        jobId: job.id,
        name: job.name,
        assignTo: money((month.figures.jobs.get(job.id)?.assigned.amount ?? 0) + unassigned.amount),
      }));
      return { kind: "unassigned", amount: unassigned.amount, quickAdds };
    }
  }
}

export function quickAddCommand(month: Month, add: QuickAdd): FamilyCommand {
  return { kind: "assign", month, jobId: add.jobId, amount: add.assignTo };
}
