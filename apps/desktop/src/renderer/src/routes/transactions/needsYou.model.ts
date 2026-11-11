/**
 * What the Needs you list shows and what each row can do. Everything here is a pure function of the facts
 * and core's `needsYou` figure, so it is tested without a browser. The page turns these into words and
 * sends the commands; it works out no figure.
 */

import {
  type AgreementId,
  type ContributionAgreement,
  type Facts,
  type FamilyCommand,
  type IncomeSource,
  type JobId,
  type LocalDate,
  type Month,
  type NeedsYouItem,
  type NeedsYouSuggestion,
  type RuleShare,
  type Transaction,
  type TransactionId,
  type TreatmentInput,
  maxBatchCommands,
} from "@holt/core";
import { defaultFundsMonth } from "./commands.model.ts";
import type { Words } from "./ImportSay.ts";

/** Everything a row can offer. Which ones it does depends on the row (`actionsFor`). */
export type RowAction = "accept" | "chooseJob" | "split" | "transfer" | "income" | "refund" | "note" | "alwaysDoThis";

/** What accepting a suggestion would give a transaction, as the words need it: one job by name, or a split over several. */
export type JobLabel = { readonly kind: "job"; readonly name: string } | { readonly kind: "split"; readonly jobs: number };

/** What a contribution suggestion says about the money in: whose agreement it pays, and the month it would fund. */
export interface ContributionSuggestion {
  readonly agreementId: AgreementId;
  /** Null when the agreement's person cannot be found, which a household that has kept its people never sees. */
  readonly personName: string | null;
  readonly fundsMonth: Month;
}

interface SuggestionBase {
  /** What Space runs: the suggestion's own command. For a merge it is the merge. */
  readonly command: FamilyCommand;
  /** The job or split accepting would give, or null for a merge or a contribution, which have no job. */
  readonly result: JobLabel | null;
  /** The jobs accepting would use, each once. Empty for a merge or a contribution. */
  readonly jobs: readonly JobId[];
  /** Those jobs with the share each takes, so a rule can remember the same split. Null for a merge or a contribution. */
  readonly shares: readonly [RuleShare, ...RuleShare[]] | null;
  /** The earlier transaction the suggestion rests on: the one it copies, or the one it would keep. */
  readonly basis: { readonly date: LocalDate; readonly description: string } | null;
}

type WithKind<K extends NeedsYouSuggestion["kind"]> = K extends "contribution"
  ? SuggestionBase & { readonly kind: K; readonly contribution: ContributionSuggestion }
  : SuggestionBase & { readonly kind: K; readonly contribution?: undefined };

/** A suggestion as the row shows it. Only a contribution carries the agreement, and it always does. */
export type RowSuggestion = WithKind<NeedsYouSuggestion["kind"]>;

export interface NeedsYouRow {
  readonly id: TransactionId;
  readonly transaction: Transaction;
  readonly accountName: string;
  /** The payee, or the bank's description when it gave no payee. */
  readonly who: string;
  /** The bank's own description, when it says more than `who`. */
  readonly detail: string | null;
  readonly direction: "out" | "in";
  readonly suggestion: RowSuggestion | null;
  /** Transactions in other accounts this one could be the other side of. */
  readonly candidates: readonly Transaction[];
  readonly actions: readonly RowAction[];
}

export function directionOf(transaction: Pick<Transaction, "amount">): "out" | "in" {
  return transaction.amount > 0 ? "in" : "out";
}

/**
 * The actions a row offers, in the order the menu lists them. Money out is a cost, so it goes to a job or a
 * split. Money in is income or a refund against a job, and a refund is not income. Either way it can be the
 * other side of a transfer, and can carry a note. A rule needs a payee to match, so a row without one can't
 * make one.
 */
export function actionsFor(transaction: Transaction, suggestion: RowSuggestion | null): readonly RowAction[] {
  const money: readonly RowAction[] = directionOf(transaction) === "out" ? ["chooseJob", "split", "transfer"] : ["income", "refund", "split", "transfer"];
  return [
    ...(suggestion === null ? [] : (["accept"] as const)),
    ...money,
    "note",
    ...(transaction.counterparty === undefined || transaction.counterparty.trim() === "" ? [] : (["alwaysDoThis"] as const)),
  ];
}

export function labelOf(treatment: TreatmentInput, facts: Facts): JobLabel | null {
  if (treatment.kind !== "split") return null;
  const jobs = [...new Set(treatment.allocations.map((allocation) => allocation.jobId))];
  const [only] = jobs;
  if (jobs.length === 1 && only !== undefined) return { kind: "job", name: facts.jobs.get(only)?.name ?? "" };
  return { kind: "split", jobs: jobs.length };
}

/** Each job's size in the split, as a whole weight, leaving out a job that takes nothing. */
function sharesOf(treatment: TreatmentInput): RowSuggestion["shares"] {
  if (treatment.kind !== "split") return null;
  const weights = new Map<JobId, number>();
  for (const { jobId, amount } of treatment.allocations) weights.set(jobId, (weights.get(jobId) ?? 0) + Math.abs(amount));
  const [first, ...rest] = [...weights].filter(([, weight]) => weight > 0).map(([jobId, weight]): RuleShare => ({ jobId, weight }));
  return first === undefined ? null : [first, ...rest];
}

function suggestionView(suggestion: NeedsYouSuggestion, facts: Facts, transaction: Transaction): RowSuggestion {
  const earlier = (id: TransactionId): RowSuggestion["basis"] => {
    const found = facts.transactions.get(id);
    return found === undefined ? null : { date: found.bookingDate, description: found.counterparty ?? found.description };
  };
  if (suggestion.kind === "merge") return { kind: "merge", command: suggestion.command, result: null, jobs: [], shares: null, basis: earlier(suggestion.command.keep) };
  const { treatment } = suggestion.command;
  if (suggestion.kind === "contribution") {
    // Core's suggestion always sets income. Money funds the month after it arrives (decision 1) if it ever did not.
    const fundsMonth = treatment.kind === "income" ? treatment.fundsMonth : defaultFundsMonth(transaction.bookingDate);
    const contribution: ContributionSuggestion = { agreementId: suggestion.agreementId, personName: suggestion.personName ?? null, fundsMonth };
    return { kind: "contribution", command: suggestion.command, result: null, jobs: [], shares: null, basis: null, contribution };
  }
  return {
    kind: suggestion.kind,
    command: suggestion.command,
    result: labelOf(treatment, facts),
    jobs: treatment.kind === "split" ? [...new Set(treatment.allocations.map((allocation) => allocation.jobId))] : [],
    shares: sharesOf(treatment),
    basis: suggestion.kind === "sameAsLast" ? earlier(suggestion.from) : null,
  };
}

/** What a suggestion offers as the answer: a job by its own name, or words for a split, a merge or a contribution. */
export type Headline = { readonly kind: "job"; readonly name: string } | { readonly kind: "words"; readonly words: Words };

/** Everything the words about one suggestion need: what it offers, why, and what to say once it is accepted. */
export interface SuggestionText {
  readonly headline: Headline;
  readonly because: Words;
  readonly done: Words;
}

type TextOf = {
  readonly [K in NeedsYouSuggestion["kind"]]: (row: Pick<NeedsYouRow, "who" | "transaction">, suggestion: Extract<RowSuggestion, { readonly kind: K }>) => SuggestionText;
};

const dayOf = (suggestion: RowSuggestion): string | { readonly day: LocalDate } => (suggestion.basis === null ? "" : { day: suggestion.basis.date });

/** A job's name for one job, words for several. A rule and the same-as-last suggestion are always a split. */
function resultHeadline(suggestion: RowSuggestion): Headline {
  const { result } = suggestion;
  if (result?.kind === "job") return { kind: "job", name: result.name };
  return { kind: "words", words: { id: "needsYou.suggest.split", values: { jobs: result?.kind === "split" ? result.jobs : 0 } } };
}

const sorted: Words = { id: "needsYou.done.sorted", values: { count: 1 } };

/** One entry for every kind of suggestion core makes, so a new kind does not compile until it has words. */
const textTable: TextOf = {
  rule: (row, suggestion) => ({ headline: resultHeadline(suggestion), because: { id: "needsYou.why.rule", values: { who: row.who } }, done: sorted }),
  sameAsLast: (row, suggestion) => ({ headline: resultHeadline(suggestion), because: { id: "needsYou.why.sameAsLast", values: { who: row.who, date: dayOf(suggestion) } }, done: sorted }),
  merge: (row, suggestion) => ({
    headline: { kind: "words", words: { id: "needsYou.suggest.merge", values: { date: { day: suggestion.basis?.date ?? row.transaction.bookingDate } } } },
    because: { id: "needsYou.why.merge", values: { description: suggestion.basis?.description ?? row.who, date: dayOf(suggestion) } },
    done: { id: "needsYou.done.merged" },
  }),
  contribution: (_row, { contribution }) => {
    const month = { month: contribution.fundsMonth };
    const { personName } = contribution;
    if (personName === null) {
      return {
        headline: { kind: "words", words: { id: "needsYou.suggest.contributionAnon" } },
        because: { id: "needsYou.why.contributionAnon", values: { month } },
        done: contributionDone(null, contribution.fundsMonth),
      };
    }
    return {
      headline: { kind: "words", words: { id: "needsYou.suggest.contribution", values: { person: personName } } },
      because: { id: "needsYou.why.contribution", values: { person: personName, month } },
      done: contributionDone(personName, contribution.fundsMonth),
    };
  },
};

/** What to say once money in is counted as a payment of an agreement, by accepting the suggestion or by marking it as income. */
export function contributionDone(personName: string | null, fundsMonth: Month): Words {
  const month = { month: fundsMonth };
  return personName === null ? { id: "needsYou.done.contributionAnon", values: { month } } : { id: "needsYou.done.contribution", values: { person: personName, month } };
}

/** The words for money in marked as income by hand. Only a payment of an agreement has its own words, so this is null for the rest. */
export function incomeDone(facts: Pick<Facts, "contributionAgreements" | "people">, source: IncomeSource, agreement: AgreementId | null, fundsMonth: Month): Words | null {
  if (source !== "contribution" || agreement === null) return null;
  const personId = facts.contributionAgreements.get(agreement)?.personId;
  return contributionDone(personId === undefined ? null : (facts.people.get(personId)?.name ?? null), fundsMonth);
}

/** The words for a suggestion on a row. */
export function suggestionText(row: Pick<NeedsYouRow, "who" | "transaction">, suggestion: RowSuggestion): SuggestionText {
  return (textTable[suggestion.kind] as (row: Pick<NeedsYouRow, "who" | "transaction">, suggestion: RowSuggestion) => SuggestionText)(row, suggestion);
}

/** An agreement the family can name as the payer of money in: whose it is, and the months it funds. */
export interface AgreementOption {
  readonly agreementId: AgreementId;
  readonly personName: string;
  readonly from: Month;
  readonly to: Month | null;
  readonly amount: ContributionAgreement["amount"];
}

/** The agreements that run in `fundsMonth`, with the person's name, in name order. These are the ones a payment for that month can be a payment of. */
export function agreementOptions(facts: Pick<Facts, "contributionAgreements" | "people">, fundsMonth: Month): readonly AgreementOption[] {
  return [...facts.contributionAgreements.values()]
    .filter((agreement) => agreement.from <= fundsMonth && (agreement.to === undefined || fundsMonth <= agreement.to))
    .map((agreement) => ({ agreementId: agreement.id, personName: facts.people.get(agreement.personId)?.name ?? "", from: agreement.from, to: agreement.to ?? null, amount: agreement.amount }))
    .sort((a, b) => (a.personName === b.personName ? (a.agreementId < b.agreementId ? -1 : 1) : a.personName < b.personName ? -1 : 1));
}

/**
 * Money in marked as income by hand. Only a contribution can name the agreement it pays, so a choice of agreement
 * on any other source is left out rather than sent for core to refuse.
 */
export function incomeCommand(transaction: Pick<Transaction, "id">, fundsMonth: Month, source: IncomeSource, agreement: AgreementId | null): FamilyCommand {
  const named = source === "contribution" && agreement !== null ? { agreement } : {};
  return { kind: "setTreatment", transactionId: transaction.id, treatment: { kind: "income", fundsMonth, source, ...named } };
}

/** One row for each waiting transaction, in the order the figure gives: newest booking date first, then by ID. */
export function needsYouRows(facts: Facts, items: readonly NeedsYouItem[]): NeedsYouRow[] {
  return items.map((item) => {
    const { transaction } = item;
    const suggestion = item.suggestion === null ? null : suggestionView(item.suggestion, facts, transaction);
    const who = transaction.counterparty ?? transaction.description;
    return {
      id: transaction.id,
      transaction,
      accountName: facts.accounts.get(transaction.accountId)?.name ?? "",
      who,
      detail: transaction.description.trim().toLowerCase() === who.trim().toLowerCase() ? null : transaction.description,
      direction: directionOf(transaction),
      suggestion,
      candidates: item.transferCandidates.flatMap((id) => facts.transactions.get(id) ?? []),
      actions: actionsFor(transaction, suggestion),
    };
  });
}

/** Accepting every suggestion at once. */
export interface AcceptAll {
  /** One batch of the suggestions' own commands, so it is one change with one undo. Null when no row has a suggestion. */
  readonly command: FamilyCommand | null;
  /** How many suggestions the batch holds. */
  readonly count: number;
  /** How many rows have a suggestion. More than `count` only when one batch can't hold them all. */
  readonly total: number;
}

export function acceptAll(rows: readonly NeedsYouRow[], limit: number = maxBatchCommands): AcceptAll {
  const all = rows.flatMap((row) => (row.suggestion === null ? [] : [row.suggestion.command]));
  const commands = all.slice(0, limit);
  return { command: commands.length === 0 ? null : { kind: "batch", commands }, count: commands.length, total: all.length };
}

/**
 * After the rows changed, the row to select. The same row if it is still there. Otherwise the first row that
 * followed it in the old list and survives, or, when it was last, the nearest one before it.
 */
export function reselect(before: readonly TransactionId[], after: readonly TransactionId[], selected: TransactionId | null): TransactionId | null {
  if (after.length === 0) return null;
  if (selected !== null && after.includes(selected)) return selected;
  const kept = new Set(after);
  const from = selected === null ? -1 : before.indexOf(selected);
  if (from < 0) return after[0] ?? null;
  const following = before.slice(from + 1).find((id) => kept.has(id));
  if (following !== undefined) return following;
  return before.slice(0, from).findLast((id) => kept.has(id)) ?? after[0] ?? null;
}

/** The row `step` away from the selected one, stopping at the ends. Nothing selected starts at the first row. */
export function moveSelection(ids: readonly TransactionId[], selected: TransactionId | null, step: number): TransactionId | null {
  if (ids.length === 0) return null;
  const at = selected === null ? -1 : ids.indexOf(selected);
  const next = at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + step));
  return ids[next] ?? null;
}

/** How many rows to draw: a screenful at a time, and always enough to include the selected row. */
export const pageSize = 50;

export function visibleCount(total: number, requested: number, selectedIndex: number): number {
  return Math.min(total, Math.max(requested, selectedIndex + 1));
}
