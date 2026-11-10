/**
 * The balance check (rule 5; decision 0047, "The balance check"). Neither bank states a closing balance, so
 * the family types the balance the bank shows, with its date. The check compares it with the balance core
 * works out at that date. A difference is flagged with its likely causes; nothing adjusts a balance.
 */

import { type LocalDate, addDays, monthOf } from "../dates.ts";
import type { Facts, ImportBatch } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import type { AccountId, ImportRowId, MoveId, TransactionId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { compareIds } from "./matching.ts";
import { nearMatches } from "./near-matches.ts";

/** A balance the family read at the bank, on a date. */
export interface EnteredBalance {
  readonly value: Money;
  readonly asOf: LocalDate;
}

export type LikelyCause =
  /** No live import covers these days, inclusive, so transactions may be missing. */
  | { readonly kind: "gap"; readonly from: LocalDate; readonly to: LocalDate }
  /** A transaction waiting in needs you that may duplicate another. */
  | { readonly kind: "nearDuplicate"; readonly transactionId: TransactionId; readonly of: TransactionId }
  /** Pending rows in the latest file for the account. The bank may count them in the balance it shows. */
  | { readonly kind: "pending"; readonly rows: readonly ImportRowId[]; readonly amount: Money }
  /** A move at the bank into or out of the account that is still to do. */
  | { readonly kind: "moveToDo"; readonly moveId: MoveId };

export type BalanceCheck =
  | { readonly kind: "notChecked"; readonly accountId: AccountId }
  | { readonly kind: "matches"; readonly accountId: AccountId; readonly asOf: LocalDate; readonly entered: Money; readonly calculated: Money }
  | {
      readonly kind: "differs";
      readonly accountId: AccountId;
      readonly asOf: LocalDate;
      readonly entered: Money;
      readonly calculated: Money;
      /** The entered balance less the calculated one. */
      readonly difference: Money;
      readonly causes: readonly LikelyCause[];
    };

export function balanceCheck(facts: Facts, accountId: AccountId, entered: EnteredBalance | undefined): BalanceCheck {
  if (entered === undefined) return { kind: "notChecked", accountId };
  const calculated = computeFigures(facts, entered.asOf, { horizonMonths: 0 }).accounts.get(accountId)?.balance.amount;
  if (calculated === undefined) return { kind: "notChecked", accountId };
  const common = { accountId, asOf: entered.asOf, entered: entered.value, calculated };
  if (calculated === entered.value) return { kind: "matches", ...common };
  return { kind: "differs", ...common, difference: money(entered.value - calculated), causes: likelyCauses(facts, accountId, entered.asOf) };
}

function byImport(a: ImportBatch, b: ImportBatch): number {
  return a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : compareIds(a.id, b.id);
}

function likelyCauses(facts: Facts, accountId: AccountId, asOf: LocalDate): LikelyCause[] {
  const touched = new Set<string>();
  for (const row of facts.importRows.values()) if (row.accountId === accountId) touched.add(row.batchId);
  const imports = [...facts.importBatches.values()].filter((b) => !b.undone && touched.has(b.id));

  const causes: LikelyCause[] = [];
  let coveredTo = facts.accounts.get(accountId)?.openingDate;
  for (const batch of [...imports].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) {
    if (batch.from > asOf) break;
    if (coveredTo !== undefined && batch.from > addDays(coveredTo, 1)) causes.push({ kind: "gap", from: addDays(coveredTo, 1), to: addDays(batch.from, -1) });
    if (coveredTo === undefined || batch.to > coveredTo) coveredTo = batch.to;
  }

  for (const [transactionId, of] of [...nearMatches(facts)].sort(([a], [b]) => compareIds(a, b))) {
    const t = facts.transactions.get(transactionId);
    if (t?.accountId === accountId && t.bookingDate <= asOf) causes.push({ kind: "nearDuplicate", transactionId, of });
  }

  const latest = imports.sort(byImport).at(-1);
  if (latest !== undefined) {
    const pending = [...facts.importRows.values()].filter((r) => r.batchId === latest.id && r.accountId === accountId && r.pending && r.bookingDate <= asOf).sort((a, b) => a.line - b.line);
    if (pending.length > 0) causes.push({ kind: "pending", rows: pending.map((r) => r.id), amount: money(pending.reduce((sum, r) => sum + r.amount, 0)) });
  }

  const moves = [...facts.moves.values()].filter((m) => m.status === "todo" && (m.from === accountId || m.to === accountId) && m.month <= monthOf(asOf));
  for (const move of moves.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : compareIds(a.id, b.id)))) causes.push({ kind: "moveToDo", moveId: move.id });
  return causes;
}
