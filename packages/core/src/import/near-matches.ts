import { addDays } from "../dates.ts";
import type { Facts, Transaction } from "../facts.ts";
import type { ImportBatchId, TransactionId } from "../ids.ts";
import type { Money } from "../money.ts";
import { compareIds, dayNumbers, liveBacking, normaliseDescription, undatedKey, waitingTransactions } from "./matching.ts";

/** Transactions by everything a match compares except the date, then by booking date. */
export type NearIndex = Map<string, Map<string, Transaction[]>>;

export function nearIndex(transactions: Iterable<Transaction>): NearIndex {
  const index: NearIndex = new Map();
  for (const t of transactions) {
    const key = undatedKey(t);
    let byDate = index.get(key);
    if (byDate === undefined) {
      byDate = new Map();
      index.set(key, byDate);
    }
    const list = byDate.get(t.bookingDate);
    if (list === undefined) byDate.set(t.bookingDate, [t]);
    else list.push(t);
  }
  return index;
}

/** The transactions on the same account with the same amount and description, booked one day before or after. */
export function oneDayApart(index: NearIndex, t: Pick<Transaction, "accountId" | "amount" | "description" | "bookingDate">): Transaction[] {
  const byDate = index.get(undatedKey(t));
  if (byDate === undefined) return [];
  return [...(byDate.get(addDays(t.bookingDate, -1)) ?? []), ...(byDate.get(addDays(t.bookingDate, 1)) ?? [])];
}

function shareABatch(a: readonly ImportBatchId[] | undefined, b: readonly ImportBatchId[] | undefined): boolean {
  return a !== undefined && b !== undefined && a.some((batch) => b.includes(batch));
}

interface Dated {
  readonly row: Transaction;
  readonly day: number;
}

/**
 * For each needs-you transaction that looks like a duplicate of another (same account, amount and
 * description, a booking date one day apart), the transaction it may duplicate, the smallest ID when there
 * are several. Two transactions that one bank file lists both are two transactions, so a pair that a live
 * import backs on both sides is never a near match.
 *
 * Only a transaction with the amount of a waiting one can match, so only those are grouped, by amount.
 * Each group is put in date order and a waiting transaction reads the rows a day either side of it. A
 * description is normalised only for a row with the same account, amount and a date a day apart. `waiting`
 * must be all of the facts' needs-you transactions, for a caller that already holds them.
 */
export function nearMatches(facts: Facts, waiting: readonly Transaction[] = waitingTransactions(facts)): ReadonlyMap<TransactionId, TransactionId> {
  const matches = new Map<TransactionId, TransactionId>();
  if (waiting.length === 0) return matches;

  const byAmount = new Map<Money, Transaction[]>();
  for (const t of waiting) {
    const group = byAmount.get(t.amount);
    if (group === undefined) byAmount.set(t.amount, [t]);
    else group.push(t);
  }
  for (const t of facts.transactions.values()) if (t.treatment.kind !== "needsYou") byAmount.get(t.amount)?.push(t);

  const dayOf = dayNumbers();
  const found = new Map<TransactionId, TransactionId>();
  let backing: Map<TransactionId, ImportBatchId[]> | undefined;
  for (const group of byAmount.values()) {
    if (group.length < 2) continue;
    const dated: Dated[] = group.map((row) => ({ row, day: dayOf(row.bookingDate) })).sort((a, b) => a.day - b.day);
    for (let i = 0; i < dated.length; i++) {
      const { row: t, day } = dated[i] as Dated;
      if (t.treatment.kind !== "needsYou") continue;
      let normalised: string | undefined;
      let first: TransactionId | undefined;
      const consider = ({ row: u, day: other }: Dated): void => {
        if (other === day || u.accountId !== t.accountId) return;
        if (u.description !== t.description && normaliseDescription(u.description) !== (normalised ??= normaliseDescription(t.description))) return;
        backing ??= liveBacking(facts);
        if (shareABatch(backing.get(t.id), backing.get(u.id))) return;
        if (first === undefined || compareIds(u.id, first) < 0) first = u.id;
      };
      for (let j = i - 1; j >= 0 && day - (dated[j] as Dated).day <= 1; j--) consider(dated[j] as Dated);
      for (let j = i + 1; j < dated.length && (dated[j] as Dated).day - day <= 1; j++) consider(dated[j] as Dated);
      if (first !== undefined) found.set(t.id, first);
    }
  }
  if (found.size === 0) return matches;
  for (const t of waiting) {
    const keep = found.get(t.id);
    if (keep !== undefined) matches.set(t.id, keep);
  }
  return matches;
}
