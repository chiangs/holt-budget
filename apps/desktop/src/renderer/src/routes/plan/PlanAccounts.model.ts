/**
 * "Where the money sits": each shared account with its balance and the buckets in it, and the accounts the
 * household pays into with a balance that is the last figure the family entered plus what was paid in since.
 * Rule 6 says the buckets plus the remainder equal the balance. When the buckets hold more than the account
 * does, the app says so and names the likely cause in words, from the moves still to make at the bank.
 */

import type { AccountFigures, AccountId, Facts, Figures, JobId, LocalDate, Money, Month } from "@holt/core";

export interface BucketRow {
  readonly jobId: JobId;
  readonly name: string;
  readonly amount: Money;
}

export type Cause =
  /** One-off moves into the account that are still to do. */
  | { readonly kind: "movesToDo"; readonly moves: readonly { readonly amount: Money; readonly month: Month }[] }
  /** This month's monthly move into the account isn't made yet. */
  | { readonly kind: "monthlyMove"; readonly amount: Money }
  | { readonly kind: "unknown" };

export type RemainderRow =
  | { readonly kind: "none" }
  | { readonly kind: "unbucketed"; readonly amount: Money }
  | { readonly kind: "bucketsExceedBalance"; readonly amount: Money; readonly cause: Cause };

export type BalanceBasis =
  /** The app worked it out from the opening balance and every transaction. */
  | { readonly kind: "calculated" }
  /** The family entered the balance on `baseDate`, and the app added the payments since. */
  | { readonly kind: "entered"; readonly baseDate: LocalDate; readonly paidIn: Money };

export interface AccountRow {
  readonly id: AccountId;
  readonly name: string;
  readonly balance: Money;
  readonly basis: BalanceBasis;
  readonly buckets: readonly BucketRow[];
  readonly remainder: RemainderRow;
}

export interface WhereTheMoneySits {
  readonly shared: readonly AccountRow[];
  readonly paidInto: readonly AccountRow[];
}

function causeOf(remainder: Extract<AccountFigures["remainder"], { kind: "bucketsExceedBalance" }>): Cause {
  if (remainder.movesToDo.length > 0) return { kind: "movesToDo", moves: remainder.movesToDo.map((move) => ({ amount: move.amount, month: move.month })) };
  if (remainder.monthlyMove.kind === "moveIn") return { kind: "monthlyMove", amount: remainder.monthlyMove.amount };
  return { kind: "unknown" };
}

function rowOf(facts: Facts, figures: AccountFigures): AccountRow {
  const buckets = figures.buckets.map((bucket) => ({ jobId: bucket.jobId, name: facts.jobs.get(bucket.jobId)?.name ?? "", amount: bucket.amount }));
  const remainder: RemainderRow =
    figures.remainder.kind === "bucketsExceedBalance"
      ? { kind: "bucketsExceedBalance", amount: figures.remainder.amount, cause: causeOf(figures.remainder) }
      : buckets.length > 0 && figures.remainder.amount !== 0
        ? { kind: "unbucketed", amount: figures.remainder.amount }
        : { kind: "none" };
  return {
    id: figures.account.id,
    name: figures.account.name,
    balance: figures.balance.amount,
    basis: figures.balance.kind === "calculated" ? { kind: "calculated" } : { kind: "entered", baseDate: figures.balance.baseDate, paidIn: figures.balance.deposits },
    buckets,
    remainder,
  };
}

/** Accounts in the order the family made them, shared ones first and the accounts the household pays into after. */
export function whereTheMoneySits(facts: Facts, figures: Figures): WhereTheMoneySits {
  const rows = [...figures.accounts.values()].sort((a, b) => a.account.id.localeCompare(b.account.id)).map((account) => ({ scope: account.account.scope, row: rowOf(facts, account) }));
  return {
    shared: rows.filter((entry) => entry.scope === "shared").map((entry) => entry.row),
    paidInto: rows.filter((entry) => entry.scope === "paidInto").map((entry) => entry.row),
  };
}
