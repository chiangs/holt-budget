/**
 * What the transactions say, read in one pass (decision record 0046). Each treatment counts in its own
 * way: a split is spending against its jobs, income funds a month, history only informs the estimates,
 * and a transfer or a transaction that needs you only moves its account's balance (rule 7). Every figure
 * that needs transactions reads this index, so working out the figures stays linear in the rows.
 */

import { type LocalDate, type Month, monthOf } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { AccountId, JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";

export interface Deposit {
  readonly bookingDate: LocalDate;
  readonly amount: Money;
}

export interface TransactionIndex {
  /** Spending per job and booking month, from splits: minus the allocations, so a refund reduces it. */
  readonly spent: ReadonlyMap<JobId, ReadonlyMap<Month, Money>>;
  /** Spending per job and month from history rows that carry a job. Only the estimates read it. */
  readonly history: ReadonlyMap<JobId, ReadonlyMap<Month, Money>>;
  /** Income per funds month, whenever it arrived. */
  readonly income: ReadonlyMap<Month, Money>;
  /** Income per account and funds month. */
  readonly incomeByAccount: ReadonlyMap<AccountId, ReadonlyMap<Month, Money>>;
  /** The sum of the transactions on each account booked after the account's opening date. */
  readonly sinceOpening: ReadonlyMap<AccountId, Money>;
  /** Payments into each paid-into account: minus the allocations to the pay-into jobs that pay into it. */
  readonly deposits: ReadonlyMap<AccountId, readonly Deposit[]>;
}

function add<K>(sums: Map<K, Money>, key: K, amount: number): void {
  sums.set(key, money((sums.get(key) ?? 0) + amount));
}

function addIn<K, M>(sums: Map<K, Map<M, Money>>, key: K, inner: M, amount: number): void {
  let row = sums.get(key);
  if (row === undefined) {
    row = new Map();
    sums.set(key, row);
  }
  add(row, inner, amount);
}

/** Index the transactions booked on or before `asOf`. Later ones haven't happened yet as of that day. */
export function indexTransactions(facts: Facts, asOf: LocalDate): TransactionIndex {
  const spent = new Map<JobId, Map<Month, Money>>();
  const history = new Map<JobId, Map<Month, Money>>();
  const income = new Map<Month, Money>();
  const incomeByAccount = new Map<AccountId, Map<Month, Money>>();
  const sinceOpening = new Map<AccountId, Money>();
  const deposits = new Map<AccountId, Deposit[]>();

  for (const t of facts.transactions.values()) {
    if (t.bookingDate > asOf) continue;
    const openingDate = facts.accounts.get(t.accountId)?.openingDate;
    if (openingDate !== undefined && t.bookingDate > openingDate) add(sinceOpening, t.accountId, t.amount);

    const treatment = t.treatment;
    switch (treatment.kind) {
      case "income":
        add(income, treatment.fundsMonth, t.amount);
        addIn(incomeByAccount, t.accountId, treatment.fundsMonth, t.amount);
        break;
      case "split": {
        const m = monthOf(t.bookingDate);
        for (const allocation of treatment.allocations) {
          addIn(spent, allocation.jobId, m, -allocation.amount);
          const job = facts.jobs.get(allocation.jobId);
          if (job?.kind === "payInto") {
            const list = deposits.get(job.payInto) ?? [];
            list.push({ bookingDate: t.bookingDate, amount: money(-allocation.amount) });
            deposits.set(job.payInto, list);
          }
        }
        break;
      }
      case "history":
        if (treatment.jobId !== null) addIn(history, treatment.jobId, monthOf(t.bookingDate), -t.amount);
        break;
      case "transfer":
      case "needsYou":
        break;
    }
  }
  return { spent, history, income, incomeByAccount, sinceOpening, deposits };
}
