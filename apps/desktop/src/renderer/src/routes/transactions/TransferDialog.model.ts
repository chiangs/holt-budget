/**
 * Marking a transaction as a transfer and pairing it. Core decides what can pair (`transferCandidates`: another
 * shared account, the same amount with the opposite sign, within three days, neither side already paired).
 * This module asks core that question for any transaction, not only one that waits in needs you, orders the
 * answer for the family, and builds the command that makes or changes the pair.
 */

import { type Facts, type FamilyCommand, type Move, type Transaction, type TransactionId, daysBetween, transferCandidates } from "@holt/core";

/** Days between two booking dates, whichever is later. */
const distance = (a: Transaction, b: Transaction): number => Math.abs(daysBetween(a.bookingDate, b.bookingDate));

/** Nearest booking date first, then the earlier date, then by ID, so the best candidate is on top and the order never changes between renders. */
export function orderCandidates(transaction: Transaction, candidates: readonly Transaction[]): Transaction[] {
  return [...candidates].sort(
    (a, b) => distance(transaction, a) - distance(transaction, b) || (a.bookingDate < b.bookingDate ? -1 : a.bookingDate > b.bookingDate ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The facts as they would be with this transaction (and the partner it has now) waiting for a partner, so core's candidate search treats it like any waiting transaction. */
function asWaiting(facts: Facts, transaction: Transaction): Facts {
  const transactions = new Map(facts.transactions);
  transactions.set(transaction.id, { ...transaction, treatment: { kind: "needsYou" } });
  if (transaction.treatment.kind === "transfer" && transaction.treatment.partner !== null) {
    const partner = transactions.get(transaction.treatment.partner);
    if (partner !== undefined && partner.treatment.kind === "transfer" && partner.treatment.partner === transaction.id) {
      transactions.set(partner.id, { ...partner, treatment: { kind: "transfer", partner: null } });
    }
  }
  return { ...facts, transactions };
}

/** The transactions in other accounts this one could pair with, best first. A transaction that is already a pair lists its own partner among them. */
export function candidatesFor(facts: Facts, transaction: Transaction): Transaction[] {
  const ids = transferCandidates(asWaiting(facts, transaction)).get(transaction.id) ?? [];
  const found: Transaction[] = [];
  for (const id of ids) {
    const candidate = facts.transactions.get(id);
    if (candidate !== undefined) found.push(candidate);
  }
  return orderCandidates(transaction, found);
}

/** The move at the bank a pair would complete: the earliest still to do that goes from the paying account to the receiving one for this amount. */
export function moveCompletedBy(facts: Facts, a: Transaction, b: Transaction): Move | undefined {
  const [outgoing, incoming] = a.amount < 0 ? [a, b] : [b, a];
  return [...facts.moves.values()]
    .filter((move) => move.status === "todo" && move.from === outgoing.accountId && move.to === incoming.accountId && move.amount === incoming.amount)
    .sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0))[0];
}

const unpaired = (transactionId: TransactionId): FamilyCommand => ({ kind: "setTreatment", transactionId, treatment: { kind: "transfer", partner: null } });

/**
 * The change for choosing `partner` (a transaction, or null for "the other side isn't imported yet"). A pair
 * the transaction already belongs to is released first, in the same change, so Undo restores it whole.
 * Null when nothing would change.
 */
export function transferCommand(facts: Facts, transaction: Transaction, partner: TransactionId | null): FamilyCommand | null {
  const { treatment } = transaction;
  const current = treatment.kind === "transfer" ? treatment.partner : null;
  if (treatment.kind === "transfer" && current === partner) return null;

  const steps: FamilyCommand[] = [];
  if (current !== null) steps.push(unpaired(current), unpaired(transaction.id));
  if (partner === null) {
    if (current === null) steps.push(unpaired(transaction.id));
  } else {
    const other = facts.transactions.get(partner);
    if (other === undefined) return null;
    const move = moveCompletedBy(facts, transaction, other);
    steps.push({ kind: "pairTransfers", pairs: [{ a: transaction.id, b: partner, ...(move === undefined ? {} : { completesMove: move.id }) }] });
  }
  const [only, ...more] = steps;
  if (only === undefined) return null;
  return more.length === 0 ? only : { kind: "batch", commands: steps };
}
