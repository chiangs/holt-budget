/**
 * "Same as last time" (decision 0047): for a transaction that waits for you, the treatment of the most
 * recent earlier transaction from the same counterparty that the family split to jobs, scaled to this
 * amount by the same shares. It only suggests. Nothing here changes a transaction.
 */

import type { TreatmentInput } from "../commands/transactions.ts";
import type { Allocation, Facts, RuleShare, Transaction } from "../facts.ts";
import type { TransactionId } from "../ids.ts";
import { waitingTransactions } from "../import/matching.ts";
import { counterpartyKey, splitByWeights } from "./resolve.ts";

export interface SameAsLast {
  /** The earlier transaction the treatment comes from. */
  readonly from: TransactionId;
  /** The same shares, scaled to this transaction's amount. */
  readonly treatment: TreatmentInput;
}

export interface Precedent {
  readonly transaction: Transaction;
  readonly shares: readonly [RuleShare, ...RuleShare[]];
}

/** Booking date first, then ID, which sorts in the order UUIDv7 IDs were made. */
export function bookedBefore(a: Pick<Transaction, "bookingDate" | "id">, b: Pick<Transaction, "bookingDate" | "id">): boolean {
  return a.bookingDate < b.bookingDate || (a.bookingDate === b.bookingDate && a.id < b.id);
}

/**
 * A split carries usable shares when none of its allocations points the other way from the transaction
 * and they are not all zero. Each allocation's size is then its weight.
 */
function precedentOf(transaction: Transaction): Precedent | null {
  const { treatment } = transaction;
  if (treatment.kind !== "split") return null;
  const pointsBack = treatment.allocations.some((a) => a.amount !== 0 && Math.sign(a.amount) !== Math.sign(transaction.amount));
  if (pointsBack || treatment.allocations.every((a) => a.amount === 0)) return null;
  const [first, ...rest] = treatment.allocations;
  const share = (a: Allocation): RuleShare => ({ jobId: a.jobId, weight: Math.abs(a.amount) });
  return { transaction, shares: [share(first), ...rest.map(share)] };
}

/**
 * For each counterparty (by `counterpartyKey`), the transactions the family split to jobs, oldest first.
 * `only` limits the answer to those counterparty keys, so the rest are never listed or sorted.
 */
export function precedentsByCounterparty(transactions: Iterable<Transaction>, only?: ReadonlySet<string>): Map<string, Precedent[]> {
  interface Held {
    readonly key: string;
    readonly list: Precedent[];
  }
  const precedents = new Map<string, Precedent[]>();
  const held = new Map<string, Held>();
  const heldAs = new Map<string, Held | null>();
  for (const t of transactions) {
    if (t.treatment.kind !== "split" || t.counterparty === undefined) continue;
    let holder = heldAs.get(t.counterparty);
    if (holder === undefined) {
      const key = counterpartyKey(t.counterparty);
      if (only !== undefined && !only.has(key)) holder = null;
      else {
        holder = held.get(key);
        if (holder === undefined) {
          holder = { key, list: [] };
          held.set(key, holder);
        }
      }
      heldAs.set(t.counterparty, holder);
    }
    if (holder === null) continue;
    const precedent = precedentOf(t);
    if (precedent === null) continue;
    if (holder.list.length === 0) precedents.set(holder.key, holder.list);
    holder.list.push(precedent);
  }
  for (const list of precedents.values()) list.sort((a, b) => (bookedBefore(a.transaction, b.transaction) ? -1 : 1));
  return precedents;
}

/** The latest precedent booked before `t`, in a list that is oldest first. */
function latestBefore(list: readonly Precedent[], t: Transaction): Precedent | undefined {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bookedBefore((list[middle] as Precedent).transaction, t)) low = middle + 1;
    else high = middle;
  }
  return list[low - 1];
}

/** `waiting` must be all of the facts' needs-you transactions, for a caller that already holds them. */
export function sameAsLastTime(facts: Facts, waiting: readonly Transaction[] = waitingTransactions(facts)): ReadonlyMap<TransactionId, SameAsLast> {
  const found = new Map<TransactionId, SameAsLast>();
  const keyOf = new Map<string, string>();
  const keys = new Set<string>();
  for (const { counterparty } of waiting) {
    if (counterparty === undefined || keyOf.has(counterparty)) continue;
    const key = counterpartyKey(counterparty);
    keyOf.set(counterparty, key);
    keys.add(key);
  }
  if (keys.size === 0) return found;
  const precedents = precedentsByCounterparty(facts.transactions.values(), keys);
  if (precedents.size === 0) return found;
  for (const t of waiting) {
    if (t.counterparty === undefined) continue;
    const list = precedents.get(keyOf.get(t.counterparty) as string);
    const last = list === undefined ? undefined : latestBefore(list, t);
    if (last !== undefined) found.set(t.id, { from: last.transaction.id, treatment: { kind: "split", allocations: splitByWeights(t.amount, last.shares) } });
  }
  return found;
}
