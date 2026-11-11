/**
 * Accounts as of `asOf` (decision record 0046; rule 6; decision 11): each account's balance, the buckets
 * that sit in it, the unbucketed remainder, and the monthly move at the bank that the plan needs.
 */

import type { LocalDate, Month } from "../dates.ts";
import type { Account, Facts, Move } from "../facts.ts";
import type { AccountId, JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import type { ExpectedIncomeMonth } from "./contributions.ts";
import { type LatestEnteredValues, latestValue } from "./entered-values.ts";
import type { PlanFigures } from "./months.ts";
import type { TransactionIndex } from "./transactions.ts";

export type AccountBalance =
  /** A shared account: the opening balance plus every transaction booked after the opening date. */
  | { readonly kind: "calculated"; readonly amount: Money }
  /**
   * An account the household pays into: the latest balance you entered (or the opening balance when there
   * is none) plus the deposits booked after its date.
   */
  | { readonly kind: "depositsSince"; readonly amount: Money; readonly base: Money; readonly baseDate: LocalDate; readonly deposits: Money };

/**
 * One account's monthly move at the bank: the month's assignments for jobs whose money sits there, less the
 * money that lands there. That is the income that has arrived and the contributions still expected (0048), so
 * before payday the move is not the whole month.
 */
export type MonthlyMove =
  | { readonly kind: "moveIn"; readonly amount: Money }
  /** More lands in the account than its jobs are assigned: money to move out. */
  | { readonly kind: "surplus"; readonly amount: Money }
  | { readonly kind: "none" };

/** Rule 6: the buckets plus the remainder equal the balance. The remainder can't go below zero, so a shortfall is flagged instead. */
export type Remainder =
  | { readonly kind: "unbucketed"; readonly amount: Money }
  | {
      readonly kind: "bucketsExceedBalance";
      /** How much more the buckets hold than the balance. */
      readonly amount: Money;
      /** One-off moves into the account still to do, the likely cause. */
      readonly movesToDo: readonly Move[];
      /** The account's monthly move for the current month. */
      readonly monthlyMove: MonthlyMove;
    };

export interface BucketInAccount {
  readonly jobId: JobId;
  readonly amount: Money;
}

export interface AccountFigures {
  readonly account: Account;
  readonly balance: AccountBalance;
  /** Every job that keeps its money here, with its bucket at the end of the current month. */
  readonly buckets: readonly BucketInAccount[];
  readonly bucketed: Money;
  readonly remainder: Remainder;
  /** The monthly move for each plan month. */
  readonly monthlyMoves: ReadonlyMap<Month, MonthlyMove>;
}

function moveOf(net: number): MonthlyMove {
  if (net > 0) return { kind: "moveIn", amount: money(net) };
  if (net < 0) return { kind: "surplus", amount: money(-net) };
  return { kind: "none" };
}

function balanceOf(account: Account, index: TransactionIndex, latest: LatestEnteredValues): AccountBalance {
  if (account.scope === "shared") {
    return { kind: "calculated", amount: money(account.openingBalance + (index.sinceOpening.get(account.id) ?? 0)) };
  }
  const entered = latestValue(latest, "accountBalance", account.id);
  const base = entered === undefined ? account.openingBalance : money(entered.value);
  const baseDate = entered === undefined ? account.openingDate : entered.asOf;
  const deposits = money((index.deposits.get(account.id) ?? []).reduce((sum, d) => (d.bookingDate > baseDate ? sum + d.amount : sum), 0));
  return { kind: "depositsSince", amount: money(base + deposits), base, baseDate, deposits };
}

export function accountFigures(
  facts: Facts,
  plan: PlanFigures,
  index: TransactionIndex,
  latest: LatestEnteredValues,
  current: Month,
  expected: readonly ExpectedIncomeMonth[],
): ReadonlyMap<AccountId, AccountFigures> {
  const buckets = new Map<AccountId, BucketInAccount[]>();
  for (const { job, bucket } of plan.jobs.values()) {
    if (bucket.kind === "absent") continue;
    const list = buckets.get(job.accountId) ?? [];
    list.push({ jobId: job.id, amount: bucket.balance });
    buckets.set(job.accountId, list);
  }

  const assignedByAccount = new Map<AccountId, Map<Month, number>>();
  for (const [m, monthFigures] of plan.months) {
    for (const [jobId, jobMonth] of monthFigures.jobs) {
      const accountId = facts.jobs.get(jobId)?.accountId;
      if (accountId === undefined) continue;
      const row = assignedByAccount.get(accountId) ?? new Map<Month, number>();
      row.set(m, (row.get(m) ?? 0) + jobMonth.assigned.amount);
      assignedByAccount.set(accountId, row);
    }
  }

  const expectedByAccount = new Map<AccountId, Map<Month, number>>();
  for (const { month, contributions } of expected) {
    for (const { accountId, stillExpected } of contributions) {
      const row = expectedByAccount.get(accountId) ?? new Map<Month, number>();
      row.set(month, (row.get(month) ?? 0) + stillExpected);
      expectedByAccount.set(accountId, row);
    }
  }

  const figures = new Map<AccountId, AccountFigures>();
  for (const account of facts.accounts.values()) {
    const assigned = assignedByAccount.get(account.id);
    const income = index.incomeByAccount.get(account.id);
    const coming = expectedByAccount.get(account.id);
    const monthlyMoves = new Map<Month, MonthlyMove>(
      [...plan.months.keys()].map((m) => [m, moveOf((assigned?.get(m) ?? 0) - (income?.get(m) ?? 0) - (coming?.get(m) ?? 0))]),
    );

    const balance = balanceOf(account, index, latest);
    // Sorted by job ID, so the same facts always give the same list, however the rows were added or restored.
    const inAccount = [...(buckets.get(account.id) ?? [])].sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
    const bucketed = money(inAccount.reduce((sum, b) => sum + b.amount, 0));
    const remainder = balance.amount - bucketed;
    figures.set(account.id, {
      account,
      balance,
      buckets: inAccount,
      bucketed,
      remainder:
        remainder < 0
          ? {
              kind: "bucketsExceedBalance",
              amount: money(-remainder),
              movesToDo: [...facts.moves.values()].filter((move) => move.to === account.id && move.status === "todo").sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0)),
              monthlyMove: monthlyMoves.get(current) ?? { kind: "none" },
            }
          : { kind: "unbucketed", amount: money(remainder) },
      monthlyMoves,
    });
  }
  return figures;
}
