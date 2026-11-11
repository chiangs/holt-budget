/**
 * What the family types in the Money in dialogs becomes a command, or a reason it cannot. A change of amount
 * never edits history: it ends the agreement that runs and starts a new one from the month the family
 * picks, in one batch, so one undo takes it back and the months before keep the agreement they had.
 * An amount is read by the same reader as the rest of Plan, so no float ever stands for money.
 */

import {
  type AccountId,
  type AgreementId,
  type ContributionAgreement,
  type Currency,
  type Facts,
  type FamilyCommand,
  type Money,
  type Month,
  type PersonId,
  addMonths,
} from "@holt/core";
import type { Words } from "../transactions/ImportSay.ts";
import { type DecimalSeparator, formatAmountInput } from "../transactions/SplitEditor.model.ts";
import { readAmount } from "./PlanEdit.model.ts";

/** Months ahead the family can pick for a change. */
export const monthsAhead = 12;

export const firstDay = 1;
export const lastDay = 28;

export type AmountProblem = "notAnAmount" | "negative" | "notAbove";

/** The one reason a form cannot be saved yet. Each has plain words in the message file. */
export type FormProblem =
  | { readonly kind: AmountProblem | "day" | "account" | "month" | "person" | "name" }
  /** Money for `month` or later is already linked to the agreement that would end. */
  | { readonly kind: "paidAlready"; readonly month: Month }
  /** The person already has an agreement that runs from `from`. */
  | { readonly kind: "hasOne"; readonly from: Month };

/** A command, or the batch of several. One undo takes back what one save did. */
export function oneChange(commands: readonly [FamilyCommand, ...FamilyCommand[]]): FamilyCommand {
  const [only, ...rest] = commands;
  return rest.length === 0 ? only : { kind: "batch", commands: [...commands] };
}

/** Whole amounts, an amount above zero. */
function readAgreedAmount(text: string, currency: Currency): { readonly amount: Money } | { readonly problem: AmountProblem } {
  const read = readAmount(text, currency);
  if (read.kind === "invalid") return { problem: read.problem };
  if (read.amount <= 0) return { problem: "notAbove" };
  return { amount: read.amount };
}

/** A day of the month the family typed: a whole number from 1 to 28. */
export function readDay(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const day = Number(trimmed);
  return day >= firstDay && day <= lastDay ? day : null;
}

/** The funds months of an agreement that have income linked to it. */
export function linkedFundsMonths(facts: Facts, agreementId: AgreementId): ReadonlySet<Month> {
  const months = new Set<Month>();
  for (const t of facts.transactions.values()) {
    if (t.treatment.kind === "income" && t.treatment.agreement === agreementId) months.add(t.treatment.fundsMonth);
  }
  return months;
}

function firstLinkedFrom(linked: ReadonlySet<Month>, from: Month): Month | null {
  const found = [...linked].filter((m) => m >= from).sort();
  return found[0] ?? null;
}

/** The first month a change or an end can reach: the funds month on show, or the agreement's own start when that is later. */
function earliest(agreement: ContributionAgreement, current: Month): Month {
  return agreement.from > current ? agreement.from : current;
}

/**
 * The months a change can apply from, oldest first: this funds month (or the agreement's start, if later) to a
 * year ahead, and no later than the month the agreement ends.
 */
export function applyChoices(agreement: ContributionAgreement, current: Month): readonly Month[] {
  const first = earliest(agreement, current);
  const months: Month[] = [];
  for (let step = 0; step <= monthsAhead; step += 1) {
    const m = addMonths(first, step);
    if (agreement.to !== undefined && m > agreement.to) break;
    months.push(m);
  }
  return months;
}

/** The next funds month, as soon as the agreement has one to change. */
export function defaultApplyFrom(agreement: ContributionAgreement, current: Month): Month {
  const choices = applyChoices(agreement, current);
  const next = addMonths(current, 1);
  return choices.find((m) => m >= next) ?? choices.at(-1) ?? earliest(agreement, current);
}

/** The months an agreement can last fund, from the first it can reach to a year ahead. */
export function endChoices(agreement: ContributionAgreement, current: Month): readonly Month[] {
  const first = earliest(agreement, current);
  return Array.from({ length: monthsAhead + 1 }, (_, step) => addMonths(first, step));
}

export interface ChangeForm {
  readonly amountText: string;
  readonly dayText: string;
  readonly accountId: AccountId | null;
  readonly from: Month;
}

export interface EditContext {
  readonly agreement: ContributionAgreement;
  /** The funds month on show. */
  readonly current: Month;
  readonly currency: Currency;
  /** The accounts a contribution can land in. */
  readonly accounts: readonly AccountId[];
  /** The funds months that have income linked to this agreement. */
  readonly linked: ReadonlySet<Month>;
  readonly newAgreementId: () => AgreementId;
}

export type ChangePlan =
  | { readonly kind: "problem"; readonly problem: FormProblem }
  | { readonly kind: "unchanged" }
  /** The agreement had not started funding anything at that month, so its own values were wrong and the change corrects them. */
  | { readonly kind: "corrects"; readonly command: FamilyCommand; readonly amount: Money }
  | { readonly kind: "replaces"; readonly command: FamilyCommand; readonly amount: Money; readonly from: Month };

/**
 * A change of amount, day or account from a month. From a month after the agreement began, the agreement ends the
 * month before and a new one starts, in one batch. From its own first month, nothing has been funded yet, so the
 * agreement itself is corrected.
 */
export function planChange(form: ChangeForm, context: EditContext): ChangePlan {
  const { agreement } = context;
  const read = readAgreedAmount(form.amountText, context.currency);
  if ("problem" in read) return { kind: "problem", problem: { kind: read.problem } };
  const day = readDay(form.dayText);
  if (day === null) return { kind: "problem", problem: { kind: "day" } };
  const { accountId } = form;
  if (accountId === null || !context.accounts.includes(accountId)) return { kind: "problem", problem: { kind: "account" } };
  if (!applyChoices(agreement, context.current).includes(form.from)) return { kind: "problem", problem: { kind: "month" } };

  const same = read.amount === agreement.amount && day === agreement.day && accountId === agreement.accountId;
  if (same) return { kind: "unchanged" };

  const paid = firstLinkedFrom(context.linked, form.from);
  if (form.from > agreement.from && paid !== null) return { kind: "problem", problem: { kind: "paidAlready", month: paid } };

  if (form.from <= agreement.from) {
    const changes = {
      ...(read.amount === agreement.amount ? {} : { amount: read.amount }),
      ...(day === agreement.day ? {} : { day }),
      ...(accountId === agreement.accountId ? {} : { accountId }),
    };
    return { kind: "corrects", amount: read.amount, command: { kind: "changeAgreement", agreementId: agreement.id, changes } };
  }

  const ending: FamilyCommand = { kind: "changeAgreement", agreementId: agreement.id, changes: { to: addMonths(form.from, -1) } };
  const starting: FamilyCommand = {
    kind: "addAgreement",
    agreement: {
      id: context.newAgreementId(),
      personId: agreement.personId,
      accountId,
      amount: read.amount,
      day,
      from: form.from,
      ...(agreement.to === undefined ? {} : { to: agreement.to }),
    },
  };
  return { kind: "replaces", amount: read.amount, from: form.from, command: oneChange([ending, starting]) };
}

/** What Edit amounts is asked to do with the agreement it shows. */
export type EditMode = "change" | "end";

/** Everything the Edit amounts dialog holds: what is typed for a change, and the month an end would be after. */
export interface EditState extends ChangeForm {
  readonly mode: EditMode;
  /** The last month the contribution funds, when it is ended. */
  readonly last: Month;
}

/** The dialog for one agreement, starting from what is agreed now and from the next funds month. */
export function startEdit(agreement: ContributionAgreement, current: Month, currency: Currency, separator: DecimalSeparator, mode: EditMode = "change"): EditState {
  return {
    mode,
    amountText: formatAmountInput(agreement.amount, currency, separator),
    dayText: String(agreement.day),
    accountId: agreement.accountId,
    from: defaultApplyFrom(agreement, current),
    last: endChoices(agreement, current)[0] ?? current,
  };
}

export type EndPlan =
  | { readonly kind: "problem"; readonly problem: FormProblem }
  | { readonly kind: "unchanged" }
  | { readonly kind: "ends"; readonly command: FamilyCommand; readonly last: Month };

/** Ending an agreement sets the last month it funds. It is never deleted, so what it paid stays on record. */
export function planEnd(last: Month, context: Pick<EditContext, "agreement" | "current" | "linked">): EndPlan {
  const { agreement } = context;
  if (!endChoices(agreement, context.current).includes(last)) return { kind: "problem", problem: { kind: "month" } };
  if (agreement.to === last) return { kind: "unchanged" };
  const paid = firstLinkedFrom(context.linked, addMonths(last, 1));
  if (paid !== null) return { kind: "problem", problem: { kind: "paidAlready", month: paid } };
  return { kind: "ends", last, command: { kind: "changeAgreement", agreementId: agreement.id, changes: { to: last } } };
}

export type EditPlan =
  | { readonly kind: "problem"; readonly problem: FormProblem }
  | { readonly kind: "unchanged" }
  | { readonly kind: "save"; readonly command: FamilyCommand; readonly done: Words };

/** What saving the Edit amounts dialog does: the one command, the words to say once it is saved, or why not. */
export function planEdit(state: EditState, context: EditContext, name: string): EditPlan {
  if (state.mode === "end") {
    const plan = planEnd(state.last, context);
    return plan.kind === "ends" ? { kind: "save", command: plan.command, done: endedWords(plan, name) } : plan;
  }
  const plan = planChange(state, context);
  return plan.kind === "corrects" || plan.kind === "replaces" ? { kind: "save", command: plan.command, done: changedWords(plan, name) } : plan;
}

/** The person the contribution is from: someone already in the household, or a new adult the family names. */
export type WhoPays = { readonly kind: "existing"; readonly personId: PersonId } | { readonly kind: "new"; readonly name: string };

export interface AddForm {
  readonly who: WhoPays | null;
  readonly amountText: string;
  readonly dayText: string;
  readonly accountId: AccountId | null;
  readonly from: Month;
}

export interface AddContext {
  readonly facts: Pick<Facts, "contributionAgreements" | "people">;
  readonly currency: Currency;
  readonly accounts: readonly AccountId[];
  /** The months the family can start it from. */
  readonly months: readonly Month[];
  readonly newPersonId: () => PersonId;
  readonly newAgreementId: () => AgreementId;
}

export type AddPlan =
  | { readonly kind: "problem"; readonly problem: FormProblem }
  | { readonly kind: "add"; readonly command: FamilyCommand; readonly amount: Money; readonly name: string; readonly from: Month };

/**
 * A new contribution. A person who is new is added first, in the same batch, so the agreement and the person
 * are one change with one undo. A person who already has an agreement running from the first month has it
 * changed with Edit amounts instead, so the month never holds two for one person.
 */
export function planAdd(form: AddForm, context: AddContext): AddPlan {
  const { who } = form;
  if (who === null) return { kind: "problem", problem: { kind: "person" } };
  if (who.kind === "new" && who.name.trim() === "") return { kind: "problem", problem: { kind: "name" } };
  const read = readAgreedAmount(form.amountText, context.currency);
  if ("problem" in read) return { kind: "problem", problem: { kind: read.problem } };
  const day = readDay(form.dayText);
  if (day === null) return { kind: "problem", problem: { kind: "day" } };
  const { accountId } = form;
  if (accountId === null || !context.accounts.includes(accountId)) return { kind: "problem", problem: { kind: "account" } };
  if (!context.months.includes(form.from)) return { kind: "problem", problem: { kind: "month" } };

  if (who.kind === "existing") {
    const person = context.facts.people.get(who.personId);
    if (person === undefined || person.kind !== "adult") return { kind: "problem", problem: { kind: "person" } };
    for (const existing of context.facts.contributionAgreements.values()) {
      if (existing.personId === who.personId && (existing.to === undefined || existing.to >= form.from)) return { kind: "problem", problem: { kind: "hasOne", from: existing.from } };
    }
  }

  const personId = who.kind === "existing" ? who.personId : context.newPersonId();
  const name = who.kind === "existing" ? (context.facts.people.get(who.personId)?.name ?? "") : who.name.trim();
  const agreement: FamilyCommand = {
    kind: "addAgreement",
    agreement: { id: context.newAgreementId(), personId, accountId, amount: read.amount, day, from: form.from },
  };
  const command = who.kind === "new" ? oneChange([{ kind: "addPerson", person: { id: personId, name, kind: "adult" } }, agreement]) : oneChange([agreement]);
  return { kind: "add", amount: read.amount, name, from: form.from, command };
}

/** The months a new contribution can start from: two before the funds month on show, so a payment that already arrived can be linked, to a year ahead. Never before the plan starts. */
export function addMonthChoices(current: Month, planStart: Month): readonly Month[] {
  const first = addMonths(current, -2) < planStart ? planStart : addMonths(current, -2);
  const last = addMonths(current, monthsAhead);
  const months: Month[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m);
  return months;
}

/** Where a new contribution lands unless the family says otherwise: the account the most agreements already use, so the first shared account for a household with none. */
export function defaultAccount(facts: Pick<Facts, "contributionAgreements">, accounts: readonly AccountId[]): AccountId | null {
  const counts = new Map<AccountId, number>();
  for (const agreement of facts.contributionAgreements.values()) {
    if (accounts.includes(agreement.accountId)) counts.set(agreement.accountId, (counts.get(agreement.accountId) ?? 0) + 1);
  }
  let best: AccountId | null = accounts[0] ?? null;
  let most = 0;
  for (const account of accounts) {
    const count = counts.get(account) ?? 0;
    if (count > most) {
      best = account;
      most = count;
    }
  }
  return best;
}

/**
 * The Add a contribution dialog as it opens: the first adult who has no contribution running yet (someone new when
 * every adult has one), the day other contributions arrive on, the usual account, and the funds month on show.
 */
export function startAdd(
  facts: Pick<Facts, "contributionAgreements">,
  current: Month,
  accounts: readonly AccountId[],
  adults: readonly { readonly personId: PersonId }[],
): AddForm {
  const agreements = [...facts.contributionAgreements.values()];
  const free = adults.find((adult) => !agreements.some((agreement) => agreement.personId === adult.personId && agreement.to === undefined));
  return {
    who: free === undefined ? { kind: "new", name: "" } : { kind: "existing", personId: free.personId },
    amountText: "",
    dayText: agreements[0] === undefined ? "" : String(agreements[0].day),
    accountId: defaultAccount(facts, accounts),
    from: current,
  };
}

export type Field = "amount" | "day" | "account" | "month" | "person" | "name";

type ProblemOf<K extends FormProblem["kind"]> = Extract<FormProblem, { readonly kind: K }>;
type ProblemWords = { readonly [K in FormProblem["kind"]]: (problem: ProblemOf<K>, name: string) => Words };

/** One entry for every problem a form can have, so a new one does not compile until it has words. */
const problemTable: ProblemWords = {
  notAnAmount: () => ({ id: "plan.problem.notAnAmount" }),
  negative: () => ({ id: "plan.problem.negative" }),
  notAbove: () => ({ id: "plan.money.problem.notAbove" }),
  day: () => ({ id: "plan.money.problem.day" }),
  account: () => ({ id: "plan.money.problem.account" }),
  month: () => ({ id: "plan.money.problem.month" }),
  person: () => ({ id: "plan.money.problem.person" }),
  name: () => ({ id: "plan.money.problem.name" }),
  paidAlready: (problem) => ({ id: "plan.money.problem.paidAlready", values: { month: { month: problem.month } } }),
  hasOne: (problem, name) => ({ id: "plan.money.problem.hasOne", values: { name, month: { month: problem.from } } }),
};

export function problemWords(problem: FormProblem, name: string): Words {
  return (problemTable[problem.kind] as (problem: FormProblem, name: string) => Words)(problem, name);
}

const fields: { readonly [K in FormProblem["kind"]]: Field } = {
  notAnAmount: "amount",
  negative: "amount",
  notAbove: "amount",
  day: "day",
  account: "account",
  month: "month",
  person: "person",
  name: "name",
  paidAlready: "month",
  hasOne: "person",
};

/** The field a problem is about, so the dialog can mark it and put the cursor there. */
export function problemField(problem: FormProblem): Field {
  return fields[problem.kind];
}

/** What to tell the family once a change is saved. */
export function changedWords(plan: Extract<ChangePlan, { readonly kind: "corrects" | "replaces" }>, name: string): Words {
  return plan.kind === "replaces"
    ? { id: "plan.money.done.changed", values: { name, amount: { money: plan.amount }, month: { month: plan.from } } }
    : { id: "plan.money.done.corrected", values: { name, amount: { money: plan.amount } } };
}

export function endedWords(plan: Extract<EndPlan, { readonly kind: "ends" }>, name: string): Words {
  return { id: "plan.money.done.ended", values: { name, month: { month: plan.last } } };
}

export function addedWords(plan: Extract<AddPlan, { readonly kind: "add" }>): Words {
  return { id: "plan.money.done.added", values: { name: plan.name, amount: { money: plan.amount }, month: { month: plan.from } } };
}
