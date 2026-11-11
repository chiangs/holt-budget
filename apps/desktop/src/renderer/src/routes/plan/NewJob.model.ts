/**
 * The New job form as data: what the family has typed (`Draft`), what that means once it is valid (`NewJob`),
 * and the reasons it is not valid yet (`Problem`). Nothing here knows about React. The money and the months
 * come out of the text through core's own readers, the sentence "3,000 kr a month for 7 months" through core's
 * `monthlyToReach`, and where the money can come from through core's `fundingOptionsFrom`, so no figure is
 * worked out twice. `NewJobBatch.model.ts` turns a valid job into the one batch that Add job runs.
 */

import {
  type AccountId,
  type AccountNumber,
  type Currency,
  type Facts,
  type Figures,
  type FundingOption,
  type FundingOptions,
  type GroupId,
  type LocalDate,
  type Money,
  type MonthlyToReach,
  type Month,
  type SaveUpTarget,
  addMonths,
  fundingOptionsFrom,
  localDate,
  money,
  monthlyToReach,
  month as readMonth,
  parseAccountNumber,
} from "@holt/core";
import { parseAmountText } from "../transactions/SplitEditor.model.ts";
import type { MonthAccess, PlanMonth } from "./PlanMonth.model.ts";

export type JobKind = "spend" | "saveUp" | "payInto";

export const jobKinds: readonly JobKind[] = ["spend", "saveUp", "payInto"];

export type GroupChoice =
  | { readonly kind: "existing"; readonly groupId: GroupId | null }
  /** "A new group…": the flow adds the group in the same batch. */
  | { readonly kind: "new"; readonly name: string; readonly counts: boolean };

/** Where a job's bucket sits. Null while nothing is chosen. */
export type SitsChoice = { readonly kind: "account"; readonly accountId: AccountId | null } | { readonly kind: "own" };

export interface NewAccountDraft {
  readonly name: string;
  /** The bank, as text. An account has no field for it, so it follows the name: "Youngest's savings · Bulder". */
  readonly bank: string;
  readonly balance: string;
  /** The day the balance is for, as a date input gives it. */
  readonly date: string;
  /** "Also import this account's statements": the account then carries its number, so a statement finds it. */
  readonly importStatements: boolean;
  readonly number: string;
}

export type PaidIntoChoice =
  | { readonly kind: "existing"; readonly accountId: AccountId | null }
  | { readonly kind: "new"; readonly account: NewAccountDraft };

export interface Draft {
  readonly kind: JobKind;
  readonly name: string;
  readonly group: GroupChoice;
  /** Each month, for a spend job and a pay-into job, and for a save-up job set by a monthly amount. */
  readonly amount: string;
  readonly essential: boolean;
  readonly keepsMoney: boolean;
  /** The account a spend job's bills, or a pay-into job's money, leave from. */
  readonly paidFrom: AccountId | null;
  /** A save-up job: a target and a date, or a monthly amount instead. */
  readonly targetMode: "byMonth" | "monthly";
  readonly target: string;
  /** "2027-06", as a month input gives it. */
  readonly readyBy: string;
  readonly sits: SitsChoice;
  readonly payInto: PaidIntoChoice;
  /** The funding option the family chose, by `fundingKey`. Null picks the first. */
  readonly funding: string | null;
}

export type Field =
  | "name"
  | "group"
  | "groupName"
  | "amount"
  | "target"
  | "readyBy"
  | "paidFrom"
  | "sits"
  | "payInto"
  | "accountName"
  | "balance"
  | "balanceDate"
  | "number";

export type ProblemCode =
  | "nameMissing"
  | "groupMissing"
  | "groupNameMissing"
  | "notAnAmount"
  | "notAbove"
  | "readyByMissing"
  | "readyByTooEarly"
  | "accountMissing"
  | "balanceNotAnAmount"
  | "balanceDateMissing"
  | "numberBad"
  | "numberTaken";

export interface Problem {
  readonly field: Field;
  readonly code: ProblemCode;
}

export interface NewJobContext {
  readonly facts: Facts;
  readonly currency: Currency;
  /** The month Plan shows. */
  readonly month: Month;
  /** Whether the family can give the job money in that month. */
  readonly access: MonthAccess;
  readonly today: LocalDate;
}

export function contextOf(facts: Facts, figures: Figures, shown: PlanMonth, currency: Currency): NewJobContext {
  return { facts, currency, month: shown.month, access: shown.access, today: figures.asOf };
}

/** The first month the job is funded: the month Plan shows, or the one after it when that month is closed. */
export function firstMonthOf(context: Pick<NewJobContext, "month" | "access">): Month {
  return context.access === "closed" ? addMonths(context.month, 1) : context.month;
}

export type GroupPlan = { readonly kind: "existing"; readonly groupId: GroupId } | { readonly kind: "new"; readonly name: string; readonly counts: boolean };

export type Where = { readonly kind: "account"; readonly accountId: AccountId } | { readonly kind: "own" };

export type PaidIntoPlan =
  | { readonly kind: "existing"; readonly accountId: AccountId }
  | { readonly kind: "new"; readonly name: string; readonly balance: Money; readonly date: LocalDate; readonly number: AccountNumber | null };

/** What a valid job is in the types the commands need, kind by kind. `first` is what the job is given in its first month. */
export type JobPlan =
  | { readonly kind: "spend"; readonly first: Money; readonly amount: Money; readonly essential: boolean; readonly keepsMoney: boolean; readonly where: Where }
  | { readonly kind: "saveUp"; readonly first: Money; readonly target: Extract<SaveUpTarget, { kind: "amountByMonth" | "monthly" }>; readonly reach: MonthlyToReach | null; readonly where: Where }
  | { readonly kind: "payInto"; readonly first: Money; readonly amount: Money; readonly account: PaidIntoPlan; readonly paidFrom: AccountId };

export type NewJob = { readonly name: string; readonly group: GroupPlan } & JobPlan;

/** What a typed text means as money: an amount above zero, or why not. Zero is refused because a job with nothing to give is no job. */
export function amountOf(text: string, currency: Currency): { readonly ok: true; readonly amount: Money } | { readonly ok: false; readonly code: "notAnAmount" | "notAbove" } {
  const amount = parseAmountText(text, currency);
  if (amount === null) return { ok: false, code: "notAnAmount" };
  if (amount <= 0) return { ok: false, code: "notAbove" };
  return { ok: true, amount };
}

const monthText = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month input's text as a month, or null. */
export function monthOfText(text: string): Month | null {
  return monthText.test(text.trim()) ? readMonth(text.trim()) : null;
}

function dateOfText(text: string): LocalDate | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (found === null) return null;
  try {
    return localDate(text.trim());
  } catch {
    return null;
  }
}

export type Reach =
  /** The target or the date is not there yet, so there is no sentence to say. */
  | { readonly kind: "waiting" }
  /** The date is before the first month the job is funded. */
  | { readonly kind: "tooEarly"; readonly from: Month }
  | { readonly kind: "reach"; readonly reach: MonthlyToReach };

/**
 * The sentence "That is 2,625 kr a month for 8 months, November to June", from what the form holds. The job is
 * new, so it has saved nothing, and it is given money from its first month to the month it is ready by.
 */
export function reachOf(draft: Draft, context: Pick<NewJobContext, "currency" | "month" | "access">): Reach {
  const target = amountOf(draft.target, context.currency);
  const readyBy = monthOfText(draft.readyBy);
  if (!target.ok || readyBy === null) return { kind: "waiting" };
  const from = firstMonthOf(context);
  const reach = monthlyToReach({ target: target.amount, saved: money(0), from, readyBy });
  return reach === null ? { kind: "tooEarly", from } : { kind: "reach", reach };
}

/** The shared accounts, in the order the family made them. */
export function sharedAccounts(facts: Facts): readonly { readonly id: AccountId; readonly name: string }[] {
  return [...facts.accounts.values()]
    .filter((account) => account.scope === "shared")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, name }) => ({ id, name }));
}

/** The accounts the household pays into, in the order the family made them. */
export function paidIntoAccounts(facts: Facts): readonly { readonly id: AccountId; readonly name: string }[] {
  return [...facts.accounts.values()]
    .filter((account) => account.scope === "paidInto")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, name }) => ({ id, name }));
}

export interface SitsOptions {
  /** The account the mockup's first choice names: the buffer's, or the one with most buckets. Null when the household has no shared account. */
  readonly preferred: { readonly accountId: AccountId; readonly name: string; readonly neighbours: readonly string[] } | null;
  /** Every other shared account. */
  readonly others: readonly { readonly id: AccountId; readonly name: string }[];
}

/** "As a bucket in the Buffer account, next to Christmas and Konfirmasjon", "as a bucket in another account", or "in an account of its own". */
export function sitsOptions(facts: Facts, figures: Figures): SitsOptions {
  const shared = sharedAccounts(facts);
  const bucketsOf = (id: AccountId) => figures.accounts.get(id)?.buckets ?? [];
  const bufferJob = figures.buffer.kind === "buffer" ? figures.buffer.jobId : null;
  const bufferAccount = bufferJob === null ? null : (facts.jobs.get(bufferJob)?.accountId ?? null);

  let chosen = shared.find((account) => account.id === bufferAccount) ?? null;
  if (chosen === null) {
    for (const account of shared) if (chosen === null || bucketsOf(account.id).length > bucketsOf(chosen.id).length) chosen = account;
  }
  if (chosen === null) return { preferred: null, others: [] };

  const neighbours = bucketsOf(chosen.id)
    .filter((bucket) => bucket.jobId !== bufferJob)
    .sort((a, b) => b.amount - a.amount || a.jobId.localeCompare(b.jobId))
    .slice(0, 2)
    .map((bucket) => facts.jobs.get(bucket.jobId)?.name ?? "");
  const { id } = chosen;
  return { preferred: { accountId: id, name: chosen.name, neighbours }, others: shared.filter((account) => account.id !== id) };
}

/** The account the adults' contributions land in, which is where the bills are usually paid from. Failing that, the first shared account. */
export function defaultPaidFrom(facts: Facts): AccountId | null {
  const landed = new Map<AccountId, number>();
  for (const agreement of facts.contributionAgreements.values()) landed.set(agreement.accountId, (landed.get(agreement.accountId) ?? 0) + 1);
  const shared = sharedAccounts(facts);
  let best: AccountId | null = null;
  for (const { id } of shared) if (landed.has(id) && (best === null || (landed.get(id) ?? 0) > (landed.get(best) ?? 0))) best = id;
  return best ?? shared[0]?.id ?? null;
}

/** The kind a "+ Add a line to <group>" starts with: the kind most of that group's jobs are, and a spend job for a group with none. */
export function kindForGroup(facts: Facts, groupId: GroupId): JobKind {
  const counts = new Map<JobKind, number>();
  for (const job of facts.jobs.values()) if (job.groupId === groupId && job.status === "active") counts.set(job.kind, (counts.get(job.kind) ?? 0) + 1);
  let best: JobKind = "spend";
  for (const kind of jobKinds) if ((counts.get(kind) ?? 0) > (counts.get(best) ?? 0)) best = kind;
  return best;
}

/** The groups in the order the family put them. */
export function groupsInOrder(facts: Facts): readonly { readonly id: GroupId; readonly name: string; readonly counts: boolean }[] {
  return [...facts.groups.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((group) => ({ id: group.id, name: group.name, counts: group.countsTowardsSavingsRate }));
}

/** The first group that suits the kind: one that counts towards the savings rate for saving, and one that does not for spending. */
export function defaultGroup(facts: Facts, kind: JobKind): GroupId | null {
  const groups = groupsInOrder(facts);
  const wantsSaving = kind !== "spend";
  return (groups.find((group) => group.counts === wantsSaving) ?? groups[0])?.id ?? null;
}

export interface Start {
  readonly kind?: JobKind;
  readonly groupId?: GroupId;
  /** Start on a pay-into job with "Add an account…" already chosen. */
  readonly newAccount?: boolean;
}

export function emptyAccount(today: LocalDate): NewAccountDraft {
  return { name: "", bank: "", balance: "", date: today, importStatements: false, number: "" };
}

export function startingDraft(facts: Facts, figures: Figures, today: LocalDate, start: Start = {}): Draft {
  const kind = start.kind ?? (start.groupId === undefined ? "saveUp" : kindForGroup(facts, start.groupId));
  const sits = sitsOptions(facts, figures);
  const firstPaidInto = paidIntoAccounts(facts)[0]?.id ?? null;
  const startsNew = start.newAccount === true || firstPaidInto === null;
  return {
    kind,
    name: "",
    group: { kind: "existing", groupId: start.groupId ?? defaultGroup(facts, kind) },
    amount: "",
    essential: false,
    keepsMoney: false,
    paidFrom: defaultPaidFrom(facts),
    targetMode: "byMonth",
    target: "",
    readyBy: "",
    sits: sits.preferred === null ? { kind: "own" } : { kind: "account", accountId: sits.preferred.accountId },
    payInto: startsNew ? { kind: "new", account: emptyAccount(today) } : { kind: "existing", accountId: firstPaidInto },
    funding: null,
  };
}

/** Another kind keeps what the family typed. The group follows the kind only while it is still the one the old kind started in. */
export function changeKind(draft: Draft, kind: JobKind, facts: Facts): Draft {
  if (kind === draft.kind) return draft;
  const following = draft.group.kind === "existing" && draft.group.groupId === defaultGroup(facts, draft.kind);
  return { ...draft, kind, group: following ? { kind: "existing", groupId: defaultGroup(facts, kind) } : draft.group };
}

/** "A new group…" starts as one that counts towards the savings rate for saving, and as one that does not for spending. */
export function newGroupChoice(kind: JobKind): GroupChoice {
  return { kind: "new", name: "", counts: kind !== "spend" };
}

/** The word on the account that the family sees in lists: the name, then the bank after a dot. */
export function accountNameOf(account: Pick<NewAccountDraft, "name" | "bank">): string {
  const name = account.name.trim();
  const bank = account.bank.trim();
  return bank === "" ? name : `${name} · ${bank}`;
}

/** Whether this kind's money sits in a bucket the family chooses the place of. */
export function asksWhereItSits(draft: Pick<Draft, "kind" | "keepsMoney">): boolean {
  return draft.kind === "saveUp" || (draft.kind === "spend" && draft.keepsMoney);
}

function problem(field: Field, code: ProblemCode): Problem {
  return { field, code };
}

function groupOf(draft: Draft, problems: Problem[]): GroupPlan | null {
  if (draft.group.kind === "new") {
    if (draft.group.name.trim() === "") {
      problems.push(problem("groupName", "groupNameMissing"));
      return null;
    }
    return { kind: "new", name: draft.group.name.trim(), counts: draft.group.counts };
  }
  if (draft.group.groupId === null) {
    problems.push(problem("group", "groupMissing"));
    return null;
  }
  return { kind: "existing", groupId: draft.group.groupId };
}

function whereOf(draft: Draft, problems: Problem[]): Where | null {
  if (draft.kind === "spend" && !draft.keepsMoney) {
    if (draft.paidFrom === null) {
      problems.push(problem("paidFrom", "accountMissing"));
      return null;
    }
    return { kind: "account", accountId: draft.paidFrom };
  }
  if (draft.sits.kind === "own") return { kind: "own" };
  if (draft.sits.accountId === null) {
    problems.push(problem("sits", "accountMissing"));
    return null;
  }
  return { kind: "account", accountId: draft.sits.accountId };
}

function accountOf(draft: Draft, context: NewJobContext, problems: Problem[]): PaidIntoPlan | null {
  const choice = draft.payInto;
  if (choice.kind === "existing") {
    if (choice.accountId === null) {
      problems.push(problem("payInto", "accountMissing"));
      return null;
    }
    return { kind: "existing", accountId: choice.accountId };
  }
  const { account } = choice;
  const before = problems.length;
  if (account.name.trim() === "") problems.push(problem("accountName", "nameMissing"));
  const balance = parseAmountText(account.balance, context.currency);
  if (balance === null || balance < 0) problems.push(problem("balance", "balanceNotAnAmount"));
  const date = dateOfText(account.date);
  if (date === null) problems.push(problem("balanceDate", "balanceDateMissing"));
  const number = account.importStatements ? parseAccountNumber(account.number) : null;
  if (account.importStatements && number === null) problems.push(problem("number", "numberBad"));
  else if (number !== null && [...context.facts.accounts.values()].some((other) => other.number === number)) problems.push(problem("number", "numberTaken"));
  if (problems.length > before || balance === null || date === null) return null;
  return { kind: "new", name: accountNameOf(account), balance, date, number };
}

function amountField(text: string, field: Field, context: NewJobContext, problems: Problem[]): Money | null {
  const read = amountOf(text, context.currency);
  if (read.ok) return read.amount;
  problems.push(problem(field, read.code));
  return null;
}

function spendOf(draft: Draft, context: NewJobContext, problems: Problem[]): JobPlan | null {
  const amount = amountField(draft.amount, "amount", context, problems);
  const where = whereOf(draft, problems);
  return amount === null || where === null ? null : { kind: "spend", first: amount, amount, essential: draft.essential, keepsMoney: draft.keepsMoney, where };
}

function saveUpOf(draft: Draft, context: NewJobContext, problems: Problem[]): JobPlan | null {
  if (draft.targetMode === "monthly") {
    const amount = amountField(draft.amount, "amount", context, problems);
    const where = whereOf(draft, problems);
    return amount === null || where === null ? null : { kind: "saveUp", first: amount, target: { kind: "monthly", amount }, reach: null, where };
  }
  const target = amountField(draft.target, "target", context, problems);
  const readyBy = monthOfText(draft.readyBy);
  const found = reachOf(draft, context);
  if (readyBy === null) problems.push(problem("readyBy", "readyByMissing"));
  else if (found.kind === "tooEarly") problems.push(problem("readyBy", "readyByTooEarly"));
  const where = whereOf(draft, problems);
  if (target === null || readyBy === null || found.kind !== "reach" || where === null) return null;
  return { kind: "saveUp", first: found.reach.monthly, target: { kind: "amountByMonth", amount: target, readyBy }, reach: found.reach, where };
}

function payIntoOf(draft: Draft, context: NewJobContext, problems: Problem[]): JobPlan | null {
  const amount = amountField(draft.amount, "amount", context, problems);
  const account = accountOf(draft, context, problems);
  if (draft.paidFrom === null) problems.push(problem("paidFrom", "accountMissing"));
  return amount === null || account === null || draft.paidFrom === null ? null : { kind: "payInto", first: amount, amount, account, paidFrom: draft.paidFrom };
}

/**
 * The draft as a valid job, or every reason it is not, in the order the form shows its fields. Each kind has
 * its own fields, and a field the kind does not have is never looked at: a name, a group and an amount typed
 * under one kind survive a change to another.
 */
export function readDraft(draft: Draft, context: NewJobContext): { readonly ok: true; readonly job: NewJob } | { readonly ok: false; readonly problems: readonly Problem[] } {
  const problems: Problem[] = [];
  const name = draft.name.trim();
  if (name === "") problems.push(problem("name", "nameMissing"));
  const group = groupOf(draft, problems);
  const plan = draft.kind === "spend" ? spendOf(draft, context, problems) : draft.kind === "saveUp" ? saveUpOf(draft, context, problems) : payIntoOf(draft, context, problems);
  if (problems.length > 0 || group === null || plan === null) return { ok: false, problems };
  return { ok: true, job: { name, group, ...plan } };
}

/** The option each button picks, so a choice survives the options changing under it. */
export function fundingKey(option: FundingOption): string {
  return option.kind === "single" ? `single:${option.moves[0]?.from ?? ""}` : option.kind;
}

/** The option the family chose, or the first when nothing is chosen or the choice is gone. Null when there is none to choose. */
export function chosenFunding(options: FundingOptions, key: string | null): FundingOption | null {
  return options.options.find((option) => fundingKey(option) === key) ?? options.options[0] ?? null;
}

export type Funding =
  /** The month can't be given money yet or any more, so the job is added without any. */
  | { readonly kind: "skipped"; readonly access: Exclude<MonthAccess, "editable"> }
  | { readonly kind: "options"; readonly options: FundingOptions; readonly chosen: FundingOption | null };

/** Where `first` for the job's first month comes from, as core works it out for the figures the screen holds. */
export function fundingForAmount(first: Money, context: NewJobContext, figures: Figures, key: string | null): Funding {
  if (context.access !== "editable") return { kind: "skipped", access: context.access };
  const options = fundingOptionsFrom(figures, { month: context.month, amount: first });
  return { kind: "options", options, chosen: chosenFunding(options, key) };
}

export function fundingOf(job: NewJob, context: NewJobContext, figures: Figures, key: string | null): Funding {
  return fundingForAmount(job.first, context, figures, key);
}

/**
 * What the job is given in its first month, once the amount (or the target and the date) can be read, even
 * while other fields are not valid yet. The money for it can be shown from that point.
 */
export function firstOf(draft: Draft, context: NewJobContext): Money | null {
  if (draft.kind === "saveUp" && draft.targetMode === "byMonth") {
    const found = reachOf(draft, context);
    return found.kind === "reach" ? found.reach.monthly : null;
  }
  const amount = amountOf(draft.amount, context.currency);
  return amount.ok ? amount.amount : null;
}
