import type { LocalDate } from "../dates.ts";
import type { Facts, Transaction } from "../facts.ts";
import type { AccountId, TransactionId } from "../ids.ts";
import type { Money } from "../money.ts";
import { compareIds, dayNumbers } from "./matching.ts";

/** What pairing a transfer looks at. */
export interface TransferSide {
  readonly id: TransactionId;
  readonly accountId: AccountId;
  readonly amount: Money;
  readonly bookingDate: LocalDate;
}

/** Waiting for the family, or a transfer still waiting for its other side. */
function isUnpaired(t: Transaction): boolean {
  return t.treatment.kind === "needsYou" || (t.treatment.kind === "transfer" && t.treatment.partner === null);
}

/**
 * Transfers are between shared accounts. A payment into an account the household pays into is saving, a
 * split to a pay-into job (rule 7), so it never pairs.
 */
export function unpairedSides(facts: Facts): Transaction[] {
  const sides: Transaction[] = [];
  for (const t of facts.transactions.values()) {
    if (isUnpaired(t) && facts.accounts.get(t.accountId)?.scope === "shared") sides.push(t);
  }
  return sides;
}

const transferWindowDays = 3;

/**
 * For each source, the sides of `pool` in other accounts with the same amount, the opposite sign and a
 * booking date within 3 days, in ID order. The pool is grouped by amount and each group put in date order,
 * so a source reads only the few rows within its window.
 */
function candidatesAmong(pool: readonly TransferSide[], sources: readonly TransferSide[] = pool): Map<TransactionId, TransactionId[]> {
  const dayOf = dayNumbers();
  const byAmount = new Map<number, TransferSide[]>();
  for (const side of pool) {
    if (side.amount === 0) continue;
    const group = byAmount.get(side.amount);
    if (group === undefined) byAmount.set(side.amount, [side]);
    else group.push(side);
  }
  for (const group of byAmount.values()) if (group.length > 1) group.sort((a, b) => dayOf(a.bookingDate) - dayOf(b.bookingDate));

  const candidates = new Map<TransactionId, TransactionId[]>();
  for (const side of sources) {
    if (side.amount === 0) continue;
    const group = byAmount.get(-side.amount);
    if (group === undefined) continue;
    const day = dayOf(side.bookingDate);
    let low = 0;
    let high = group.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (dayOf((group[middle] as TransferSide).bookingDate) < day - transferWindowDays) low = middle + 1;
      else high = middle;
    }
    let found: TransactionId[] | undefined;
    for (let i = low; i < group.length && dayOf((group[i] as TransferSide).bookingDate) <= day + transferWindowDays; i++) {
      const other = group[i] as TransferSide;
      if (other.accountId === side.accountId) continue;
      if (found === undefined) found = [other.id];
      else found.push(other.id);
    }
    if (found !== undefined) candidates.set(side.id, found.sort(compareIds));
  }
  return candidates;
}

/**
 * The pairs an import makes: a side from `first`, in order, whose only candidate in the pool has it as its
 * only candidate in turn. Both sides must be `pairable`, and a side pairs once.
 */
export function uniquePairs(pool: readonly TransferSide[], first: readonly TransactionId[], pairable: ReadonlySet<TransactionId>): (readonly [TransactionId, TransactionId])[] {
  const candidates = candidatesAmong(pool);
  const paired = new Set<TransactionId>();
  const pairs: (readonly [TransactionId, TransactionId])[] = [];
  for (const self of first) {
    const [other, ...more] = candidates.get(self) ?? [];
    if (other === undefined || more.length > 0 || candidates.get(other)?.length !== 1) continue;
    if (!pairable.has(self) || !pairable.has(other) || paired.has(self) || paired.has(other)) continue;
    paired.add(self).add(other);
    pairs.push([self, other]);
  }
  return pairs;
}

/**
 * For each unpaired transaction, the transactions in other household accounts it could pair with (same
 * amount, opposite sign, within 3 days). Import pairs a transaction only when each side has exactly one;
 * the rest wait in needs you with these as suggestions. `answer: "waiting"` lists only those that wait in
 * needs you, which are still looked for among every unpaired side.
 */
export function transferCandidates(facts: Facts, answer: "unpaired" | "waiting" = "unpaired"): ReadonlyMap<TransactionId, readonly TransactionId[]> {
  const pool = unpairedSides(facts);
  return candidatesAmong(pool, answer === "waiting" ? pool.filter((side) => side.treatment.kind === "needsYou") : pool);
}
