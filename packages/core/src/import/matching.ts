/**
 * How an imported row is told apart from the transactions already there (decision 0047, "Matching,
 * exactly"). The key is the account, the amount, the booking date and the description with its whitespace
 * collapsed and lower-cased. The bank's reference is not part of it, because a KID repeats on every
 * payment of a recurring bill.
 */

import { type LocalDate, daysBetween } from "../dates.ts";
import type { Facts, ImportRow, Transaction } from "../facts.ts";
import type { AccountId, ImportBatchId, ImportRowId, TransactionId } from "../ids.ts";
import type { Money } from "../money.ts";

export interface Matchable {
  readonly accountId: AccountId;
  readonly amount: Money;
  readonly bookingDate: LocalDate;
  readonly description: string;
}

export function normaliseDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Everything a match compares except the date, so a near match one day apart can be looked up. */
export function undatedKey(m: Omit<Matchable, "bookingDate">): string {
  return `${m.accountId}|${m.amount}|${normaliseDescription(m.description)}`;
}

/** The matching key. It is also the import row's fingerprint, so equal rows have equal fingerprints. */
export function matchKey(m: Matchable): string {
  return `${m.bookingDate}|${undatedKey(m)}`;
}

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The transactions waiting in needs you, in the order the facts hold them. */
export function waitingTransactions(facts: Facts): Transaction[] {
  const waiting: Transaction[] = [];
  for (const t of facts.transactions.values()) if (t.treatment.kind === "needsYou") waiting.push(t);
  return waiting;
}

const epoch = "1970-01-01" as LocalDate;

/**
 * Days since 1970-01-01, worked out once for each date a pass sees. `daysBetween` builds a `Date` on every
 * call, which a loop over thousands of rows cannot afford, and two dates are a day apart exactly when
 * their numbers are.
 */
export function dayNumbers(): (date: LocalDate) => number {
  const known = new Map<LocalDate, number>();
  return (date) => {
    let day = known.get(date);
    if (day === undefined) {
      day = daysBetween(epoch, date);
      known.set(date, day);
    }
    return day;
  };
}

/** What one incoming row does: back a transaction already there, create one, or wait because it is pending. */
export type RowOutcome = { readonly kind: "backs"; readonly transactionId: TransactionId } | { readonly kind: "creates" } | { readonly kind: "pending" };

/**
 * Matching by counting. For each key, with `n` booked rows in file order and `m` transactions already there
 * in ID order, the first min(n, m) rows back those transactions one each and the rest create new ones, so
 * two identical rows in one file are two transactions.
 */
export function matchRows<R extends Matchable & { readonly pending: boolean }>(transactions: Iterable<Transaction>, rows: readonly R[]): { readonly row: R; readonly outcome: RowOutcome }[] {
  const existing = new Map<string, TransactionId[]>();
  for (const t of transactions) {
    const key = matchKey(t);
    const list = existing.get(key);
    if (list === undefined) existing.set(key, [t.id]);
    else list.push(t.id);
  }
  for (const list of existing.values()) list.sort(compareIds);
  const taken = new Map<string, number>();
  const outcomeOf = (row: R): RowOutcome => {
    if (row.pending) return { kind: "pending" };
    const key = matchKey(row);
    const k = taken.get(key) ?? 0;
    const match = existing.get(key)?.[k];
    if (match === undefined) return { kind: "creates" };
    taken.set(key, k + 1);
    return { kind: "backs", transactionId: match };
  };
  return rows.map((row) => ({ row, outcome: outcomeOf(row) }));
}

/** For each transaction, the live imports whose rows back it. */
export function liveBacking(facts: Facts): Map<TransactionId, ImportBatchId[]> {
  const backing = new Map<TransactionId, ImportBatchId[]>();
  for (const row of facts.importRows.values()) {
    if (row.backs === null || facts.importBatches.get(row.batchId)?.undone !== false) continue;
    const batches = backing.get(row.backs);
    if (batches === undefined) backing.set(row.backs, [row.batchId]);
    else batches.push(row.batchId);
  }
  return backing;
}

/**
 * The row an import created this transaction from, or undefined for one recorded by hand. A transaction an
 * import creates takes the ID of the row that creates it, so the facts keep saying which import brought it
 * after an undo releases the row or a merge points the row elsewhere.
 */
export function creatingRow(facts: Facts, transaction: Pick<Transaction, "id">): ImportRow | undefined {
  return facts.importRows.get(transaction.id as string as ImportRowId);
}
