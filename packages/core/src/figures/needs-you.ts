/**
 * What waits for the family in "needs you", and what the app suggests for each (decision 0047). A suggestion
 * is a command the family can accept, never a change. Accepting every suggestion as one `batch` gives the
 * same facts as accepting them one by one, in any order: no suggestion removes or changes a transaction
 * that another suggestion names.
 */

import type { ImportCommand } from "../commands/imports.ts";
import type { TransactionCommand } from "../commands/transactions.ts";
import type { LocalDate } from "../dates.ts";
import type { Facts, Transaction } from "../facts.ts";
import type { AgreementId, RuleId, TransactionId } from "../ids.ts";
import { waitingTransactions } from "../import/matching.ts";
import { nearMatches } from "../import/near-matches.ts";
import { transferCandidates } from "../import/transfers.ts";
import { ruleResolver, treatmentOfRule } from "../rules/resolve.ts";
import { sameAsLastTime } from "../rules/same-as-last-time.ts";
import { matchContributions } from "./contributions.ts";

type SetTreatment = Extract<TransactionCommand, { readonly kind: "setTreatment" }>;
type Merge = Extract<ImportCommand, { readonly kind: "mergeTransactions" }>;

export type NeedsYouSuggestion =
  /** A rule made after the import now matches. Accepting it applies the rule. */
  | { readonly kind: "rule"; readonly ruleId: RuleId; readonly command: SetTreatment }
  /** An earlier transaction looks like the same payment booked a day apart. Accepting it drops this one and keeps that one. */
  | { readonly kind: "merge"; readonly command: Merge }
  /** Money in that looks like a person's payment under a contribution agreement. Accepting it links the payment to the agreement and sets the month it funds. */
  | { readonly kind: "contribution"; readonly agreementId: AgreementId; readonly personName?: string; readonly command: SetTreatment }
  /** The treatment of the latest earlier transaction from the same counterparty, scaled to this amount. */
  | { readonly kind: "sameAsLast"; readonly from: TransactionId; readonly command: SetTreatment };

export interface NeedsYouItem {
  readonly transaction: Transaction;
  readonly suggestion: NeedsYouSuggestion | null;
  /** Transactions in other accounts that this one could be the other side of. */
  readonly transferCandidates: readonly TransactionId[];
}

/** Newest booking date first, then by ID, so the same facts always list the same way. Grouped by date, so it costs a pass over the rows however they arrive. */
function newestFirst(transactions: readonly Transaction[]): Transaction[] {
  const byDate = new Map<LocalDate, Transaction[]>();
  for (const t of transactions) {
    const day = byDate.get(t.bookingDate);
    if (day === undefined) byDate.set(t.bookingDate, [t]);
    else day.push(t);
  }
  const listed: Transaction[] = [];
  for (const date of [...byDate.keys()].sort().reverse()) {
    const day = byDate.get(date) as Transaction[];
    if (day.length > 1) day.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const t of day) listed.push(t);
  }
  return listed;
}

const noCandidates: readonly TransactionId[] = Object.freeze([]);

function setTreatment(transaction: Transaction, treatment: SetTreatment["treatment"], ruleId?: RuleId): SetTreatment {
  return { kind: "setTreatment", transactionId: transaction.id, treatment, ...(ruleId === undefined ? {} : { ruleId }) };
}

export function needsYouItems(facts: Facts): readonly NeedsYouItem[] {
  const held = waitingTransactions(facts);
  if (held.length === 0) return [];
  const waiting = newestFirst(held);
  const near = nearMatches(facts, held);
  const candidates = transferCandidates(facts, "waiting");
  const contributions = matchContributions(facts, held);
  const last = sameAsLastTime(facts, held);
  const ruleFor = ruleResolver(facts.rules.values());
  const dropped = new Set<TransactionId>();
  const kept = new Set<TransactionId>();

  return waiting.map((transaction): NeedsYouItem => {
    const transferTo = candidates.get(transaction.id) ?? noCandidates;
    const rule = ruleFor(transaction);
    if (rule !== null) {
      return { transaction, suggestion: { kind: "rule", ruleId: rule.id, command: setTreatment(transaction, treatmentOfRule(rule, transaction.amount), rule.id) }, transferCandidates: transferTo };
    }
    const keep = near.get(transaction.id);
    if (keep !== undefined && !dropped.has(keep) && !kept.has(transaction.id)) {
      dropped.add(transaction.id);
      kept.add(keep);
      return { transaction, suggestion: { kind: "merge", command: { kind: "mergeTransactions", keep, drop: transaction.id } }, transferCandidates: transferTo };
    }
    const paid = contributions.get(transaction.id);
    if (paid !== undefined) {
      const personName = facts.people.get(paid.agreement.personId)?.name;
      const treatment = { kind: "income", fundsMonth: paid.fundsMonth, source: "contribution", agreement: paid.agreement.id } as const;
      const suggestion = { kind: "contribution", agreementId: paid.agreement.id, ...(personName === undefined ? {} : { personName }), command: setTreatment(transaction, treatment) } as const;
      return { transaction, suggestion, transferCandidates: transferTo };
    }
    const same = last.get(transaction.id);
    const suggestion = same === undefined ? null : ({ kind: "sameAsLast", from: same.from, command: setTreatment(transaction, same.treatment) } as const);
    return { transaction, suggestion, transferCandidates: transferTo };
  });
}
