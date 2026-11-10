/**
 * A small invented household for the browse tests: three accounts, two groups, a few jobs, and the kinds of
 * transaction the All tab shows. Every name and amount is made up. Used by tests only.
 */

import {
  type AccountId,
  type Facts,
  type JobId,
  type LocalDate,
  type Money,
  type Transaction,
  type TransactionId,
  type Treatment,
  localDate,
  makeSplit,
  money,
  transactionId,
} from "@holt/core";
import { factsBuilder, kr, setAmount, testId } from "@holt/core/testing";

export const today = localDate("2026-11-10");

export interface World {
  readonly facts: Facts;
  readonly accounts: { readonly everyday: AccountId; readonly bills: AccountId; readonly savings: AccountId };
  readonly jobs: { readonly electricity: JobId; readonly food: JobId; readonly insurance: JobId; readonly paused: JobId; readonly archived: JobId };
}

export function world(): World {
  const b = factsBuilder({ planStart: "2026-08" });
  const everyday = b.account({ name: "Everyday" });
  const bills = b.account({ name: "Bills" });
  const savings = b.account({ name: "Savings", kind: "savings" });
  const fixed = b.group({ name: "Fixed costs" });
  const living = b.group({ name: "Living" });
  b.buffer({ monthly: kr(1_000), groupId: living, accountId: savings });
  const electricity = b.spendJob({ name: "Electricity", groupId: fixed, accountId: bills, plan: setAmount(kr(1_000)) });
  const insurance = b.spendJob({ name: "Insurance", groupId: fixed, accountId: bills, plan: setAmount(kr(700)) });
  const food = b.spendJob({ name: "Food", groupId: living, accountId: everyday, plan: setAmount(kr(4_000)) });
  const paused = b.spendJob({ name: "Union fees", groupId: living, accountId: bills, plan: setAmount(kr(0)), status: "paused" });
  const archived = b.spendJob({ name: "Old hobby", groupId: living, accountId: everyday, plan: setAmount(kr(0)), status: "archived" });
  return { facts: b.facts(), accounts: { everyday, bills, savings }, jobs: { electricity, food, insurance, paused, archived } };
}

let counter = 1_000;

export interface TransactionSpec {
  readonly id?: TransactionId;
  readonly accountId: AccountId;
  readonly date: string;
  readonly amount: number;
  readonly description?: string;
  readonly treatment?: Treatment;
  readonly counterparty?: string;
  readonly note?: string;
  readonly ruleId?: Transaction["ruleId"];
}

/** A transaction with sensible defaults. A split to one job unless a treatment is given. */
export function transaction(spec: TransactionSpec): Transaction {
  counter += 1;
  const amount: Money = money(spec.amount);
  return {
    id: spec.id ?? transactionId(testId(counter)),
    accountId: spec.accountId,
    bookingDate: localDate(spec.date) as LocalDate,
    amount,
    description: spec.description ?? "Card purchase",
    treatment: spec.treatment ?? { kind: "needsYou" },
    ...(spec.counterparty === undefined ? {} : { counterparty: spec.counterparty }),
    ...(spec.note === undefined ? {} : { note: spec.note }),
    ...(spec.ruleId === undefined ? {} : { ruleId: spec.ruleId }),
  };
}

export const splitTo = (amount: number, jobId: JobId): Treatment => makeSplit(money(amount), [{ jobId, amount: money(amount) }]);

/** The facts with these transactions added. */
export function withTransactions(facts: Facts, ...added: readonly Transaction[]): Facts {
  const transactions = new Map(facts.transactions);
  for (const t of added) transactions.set(t.id, t);
  return { ...facts, transactions };
}
