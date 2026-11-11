/**
 * A valid New job as the one batch that Add job runs, and the plain facts the confirmation after it says.
 * The batch holds, in this order: the new group, the new account with the balance the family typed for it, the
 * job, and the commands that give the job its first month's money (the money with no job first, then each
 * move out of another job). One batch is one change and one undo, so an Undo takes all of it back.
 */

import {
  type AccountId,
  type EnteredValueId,
  type Facts,
  type FamilyCommand,
  type Figures,
  type FundingOption,
  type GroupId,
  type JobId,
  type Job,
  type Money,
  type Month,
  type Command,
  familyCommandKinds,
  fundingCommands,
  money,
} from "@holt/core";
import {
  type Draft,
  type Funding,
  type NewJob,
  type NewJobContext,
  type Problem,
  firstMonthOf,
  firstOf,
  fundingForAmount,
  fundingOf,
  readDraft,
} from "./NewJob.model.ts";

export interface NewJobIds {
  readonly job: JobId;
  readonly group: GroupId;
  /** The new account, whether the family asked for it or the job's own account needs one. A job never needs both. */
  readonly account: AccountId;
  readonly balance: EnteredValueId;
}

function familyOnly(commands: readonly Command[]): FamilyCommand[] {
  return commands.map((command) => {
    if (!familyCommandKinds.includes(command.kind as FamilyCommand["kind"])) throw new Error(`The page may not send ${command.kind}.`);
    return command as FamilyCommand;
  });
}

/** The account the job's money sits in, or leaves from: an existing one, or the one the batch adds. */
function accountOfJob(job: NewJob, ids: NewJobIds): AccountId {
  switch (job.kind) {
    case "payInto":
      return job.paidFrom;
    case "spend":
    case "saveUp":
      return job.where.kind === "account" ? job.where.accountId : ids.account;
  }
}

function jobOf(job: NewJob, ids: NewJobIds, groupId: GroupId): Job {
  const base = { id: ids.job, name: job.name, groupId, status: "active", accountId: accountOfJob(job, ids), opening: money(0) } as const;
  switch (job.kind) {
    case "spend":
      return { ...base, kind: "spend", essential: job.essential, keepsMoney: job.keepsMoney, plan: { mode: "setAmount", amount: job.amount }, seasonality: "auto" };
    case "saveUp":
      return { ...base, kind: "saveUp", essential: false, role: "ordinary", target: job.target };
    case "payInto":
      return {
        ...base,
        kind: "payInto",
        essential: false,
        monthly: job.amount,
        payInto: job.account.kind === "existing" ? job.account.accountId : ids.account,
      };
  }
}

function groupCommands(facts: Facts, job: NewJob, ids: NewJobIds): { readonly groupId: GroupId; readonly commands: FamilyCommand[] } {
  if (job.group.kind === "existing") return { groupId: job.group.groupId, commands: [] };
  const order = Math.max(-1, ...[...facts.groups.values()].map((group) => group.order)) + 1;
  return { groupId: ids.group, commands: [{ kind: "addGroup", group: { id: ids.group, name: job.group.name, order, countsTowardsSavingsRate: job.group.counts } }] };
}

function accountCommands(job: NewJob, ids: NewJobIds, context: NewJobContext): FamilyCommand[] {
  if (job.kind === "payInto") {
    if (job.account.kind === "existing") return [];
    const { name, balance, date, number } = job.account;
    return [
      { kind: "addAccount", account: { id: ids.account, name, kind: "savings", scope: "paidInto", openingBalance: balance, openingDate: date, ...(number === null ? {} : { number }) } },
      { kind: "enterValue", value: { id: ids.balance, kind: "accountBalance", subject: ids.account, value: balance, unit: "money", asOf: date, source: "entered by you" } },
    ];
  }
  if (job.where.kind === "account") return [];
  return [{ kind: "addAccount", account: { id: ids.account, name: job.name, kind: "savings", scope: "shared", openingBalance: money(0), openingDate: context.today } }];
}

/**
 * Add job as one batch. `option` is where the money for the first month comes from, and it is used only when
 * the family can give that month money: a month that is not open yet, or is closed, has no assignments to make.
 */
export function batchOf(job: NewJob, facts: Facts, ids: NewJobIds, context: NewJobContext, option: FundingOption | null): FamilyCommand {
  const group = groupCommands(facts, job, ids);
  const funding = option !== null && context.access === "editable" ? familyOnly(fundingCommands(option, ids.job, context.month)) : [];
  return { kind: "batch", commands: [...group.commands, ...accountCommands(job, ids, context), { kind: "addJob", job: jobOf(job, ids, group.groupId) }, ...funding] };
}

export type NewJobPlan =
  /** The form is not valid yet. `funding` is there as soon as the amount can be read, so the family sees where it would come from. */
  | { readonly kind: "problems"; readonly problems: readonly Problem[]; readonly funding: Funding | null }
  /** The job is valid, and no option covers its first month. */
  | { readonly kind: "shortfall"; readonly job: NewJob; readonly funding: Extract<Funding, { kind: "options" }> }
  | { readonly kind: "ready"; readonly job: NewJob; readonly funding: Funding; readonly command: FamilyCommand };

/** Everything the screen says about the form as it stands, worked out in one place: what is wrong, or what would be done and where the money comes from. */
export function planOf(draft: Draft, context: NewJobContext, figures: Figures, ids: NewJobIds): NewJobPlan {
  const read = readDraft(draft, context);
  if (!read.ok) {
    const first = firstOf(draft, context);
    return { kind: "problems", problems: read.problems, funding: first === null ? null : fundingForAmount(first, context, figures, draft.funding) };
  }
  const funding = fundingOf(read.job, context, figures, draft.funding);
  if (funding.kind === "options" && funding.chosen === null) return { kind: "shortfall", job: read.job, funding };
  const option = funding.kind === "options" ? funding.chosen : null;
  return { kind: "ready", job: read.job, funding, command: batchOf(read.job, context.facts, ids, context, option) };
}

export type Place =
  | { readonly kind: "bucket"; readonly account: string }
  | { readonly kind: "ownAccount"; readonly account: string }
  | { readonly kind: "paidFrom"; readonly account: string }
  | { readonly kind: "paysInto"; readonly account: string; readonly added: boolean };

/** What the confirmation says. The words are in the message file, and every figure here is one the family has seen. */
export interface Added {
  readonly name: string;
  readonly first: Money;
  /** The month the job is first given money in. */
  readonly from: Month;
  /** `now` when this month's money is given, `whenOpen` when the month isn't open yet, `nextMonth` when it is closed. */
  readonly start: "now" | "whenOpen" | "nextMonth";
  readonly target: { readonly amount: Money; readonly by: Month } | null;
  readonly place: Place;
  /** The jobs the rest of the money came from, and whether it came from them in even shares. */
  readonly took: { readonly jobs: readonly string[]; readonly equally: boolean } | null;
}

function placeOf(job: NewJob, facts: Facts): Place {
  const nameOf = (id: AccountId) => facts.accounts.get(id)?.name ?? "";
  switch (job.kind) {
    case "payInto":
      return job.account.kind === "existing" ? { kind: "paysInto", account: nameOf(job.account.accountId), added: false } : { kind: "paysInto", account: job.account.name, added: true };
    case "spend":
    case "saveUp":
      if (job.where.kind === "own") return { kind: "ownAccount", account: job.name };
      return job.kind === "spend" && !job.keepsMoney ? { kind: "paidFrom", account: nameOf(job.where.accountId) } : { kind: "bucket", account: nameOf(job.where.accountId) };
  }
}

export function addedOf(job: NewJob, context: NewJobContext, option: FundingOption | null): Added {
  const jobs = option === null ? [] : option.moves.map((move) => context.facts.jobs.get(move.from)?.name ?? "");
  return {
    name: job.name,
    first: job.first,
    from: firstMonthOf(context),
    start: context.access === "editable" ? "now" : context.access === "projection" ? "whenOpen" : "nextMonth",
    target: job.kind === "saveUp" && job.target.kind === "amountByMonth" ? { amount: job.target.amount, by: job.target.readyBy } : null,
    place: placeOf(job, context.facts),
    took: jobs.length === 0 ? null : { jobs, equally: option?.kind === "split" },
  };
}
