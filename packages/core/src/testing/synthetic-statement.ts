/**
 * Invented bank files and a household whose accounts carry invented account numbers, for import tests.
 * Every name, number and amount here is made up. The plan starts in October 2026 and today is 9 November 2026.
 */

import { type AccountNumber, accountNumber } from "../account-number.ts";
import { type ApplyResult, apply } from "../commands/apply.ts";
import { type LocalDate, addDays, localDate } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { type AccountId, enteredValueId, importBatchId, importRowId } from "../ids.ts";
import type { ImportIds, ImportInput, ImportPlan, TypedBalance } from "../import/plan.ts";
import type { StatementFile, StatementRow } from "../import/statement.ts";
import { type Currency, type Money, money } from "../money.ts";
import { NOK, type FactsBuilder, factsBuilder, kr, setAmount, testId } from "./facts-builder.ts";

export const today: LocalDate = localDate("2026-11-09");

export const numbers = {
  everyday: accountNumber("9001.00.00001"),
  savings: accountNumber("9001.00.00002"),
  bills: accountNumber("9001.00.00003"),
  child: accountNumber("9001.00.00004"),
  /** A number no account in the household has. */
  stranger: accountNumber("9009.99.99999"),
} as const;

/** The same facts with these account numbers set. */
export function withAccountNumbers(facts: Facts, byAccount: ReadonlyMap<AccountId, AccountNumber>): Facts {
  return {
    ...facts,
    accounts: new Map([...facts.accounts].map(([id, account]) => {
      const number = byAccount.get(id);
      return [id, number === undefined ? account : { ...account, number }];
    })),
  };
}

export function importHousehold(options: { readonly planStart?: string } = {}) {
  const b: FactsBuilder = factsBuilder({ planStart: options.planStart ?? "2026-10" });
  const everyday = b.account({ name: "Everyday", openingBalance: kr(10_000), openingDate: "2026-08-31" });
  const savings = b.account({ name: "Savings", kind: "savings", openingBalance: kr(50_000), openingDate: "2026-08-31" });
  const bills = b.account({ name: "Bills", kind: "bills", openingDate: "2026-08-31" });
  const child = b.account({ name: "Child", kind: "savings", scope: "paidInto", openingDate: "2026-08-31" });
  b.group({ name: "Living" });
  const buffer = b.buffer({ monthly: kr(1_000), accountId: savings });
  const food = b.spendJob({ name: "Food and household", plan: setAmount(kr(6_000)) });
  const electricity = b.spendJob({ name: "Electricity", plan: setAmount(kr(1_500)), accountId: bills });
  const accounts = { everyday, savings, bills, child };
  const byAccount = new Map<AccountId, AccountNumber>([
    [everyday, numbers.everyday],
    [savings, numbers.savings],
    [bills, numbers.bills],
    [child, numbers.child],
  ]);
  return { builder: b, accounts, jobs: { buffer, food, electricity }, facts: (): Facts => withAccountNumbers(b.facts(), byAccount) };
}

export interface RowSpec {
  readonly account: AccountNumber;
  readonly date: string;
  readonly amount: Money;
  readonly description: string;
  readonly counterparty?: string;
  readonly reference?: string;
  readonly accountName?: string;
  readonly pending?: boolean;
}

/** A statement whose rows are numbered from line 2, after the header. */
export function statement(rows: readonly RowSpec[], options: { readonly currency?: Currency; readonly format?: string } = {}): StatementFile {
  return {
    format: options.format ?? "test-csv",
    accountCurrency: options.currency ?? NOK,
    rows: rows.map((spec, i): StatementRow => ({
      line: i + 2,
      account: spec.account,
      bookingDate: localDate(spec.date),
      amount: spec.amount,
      description: spec.description,
      pending: spec.pending ?? false,
      ...(spec.counterparty === undefined ? {} : { counterparty: spec.counterparty }),
      ...(spec.reference === undefined ? {} : { reference: spec.reference }),
      ...(spec.accountName === undefined ? {} : { accountName: spec.accountName }),
    })),
  };
}

export const shops = ["Kiwi", "Rema 1000", "Coop Extra", "Meny", "Bakeri", "Apotek", "Kino", "Bensin", "Bokhandel", "Sportsbutikk"] as const;

export interface BankHistory {
  /** The first booking day. */
  readonly from: string;
  readonly days: number;
  /** Rows that are each different from every other row, spread evenly over the days. */
  readonly distinctRows: number;
  /** Groups of identical rows, as Bulder's small automatic savings repeat several times a day. Group sizes run 2, 3, 4, 2, 3, 4 and so on. */
  readonly repeatGroups: number;
  /** Every this many distinct rows is a transfer from Everyday to Savings, which adds the incoming row too. 0 for none. */
  readonly transferEvery?: number;
}

/** A long bank history in Bulder's shape, the same every time. Each distinct row has its own amount, so the only identical rows are the repeat groups. */
export function bankHistory(spec: BankHistory): RowSpec[] {
  const rows: RowSpec[] = [];
  const start = localDate(spec.from);
  const dayOf = (k: number, total: number) => addDays(start, Math.floor((k * spec.days) / Math.max(1, total)));
  for (let k = 0; k < spec.distinctRows; k++) {
    const date = dayOf(k, spec.distinctRows);
    const amount = money(kr(-(k + 1)) - 37);
    if (spec.transferEvery !== undefined && spec.transferEvery > 0 && k % spec.transferEvery === 0) {
      rows.push({ account: numbers.everyday, date, amount: money(-Math.abs(amount)), description: "Overføring til sparing", counterparty: "Overføring" });
      rows.push({ account: numbers.savings, date, amount: money(Math.abs(amount)), description: "Overføring fra brukskonto", counterparty: "Overføring" });
      continue;
    }
    const shop = shops[k % shops.length] ?? "Kiwi";
    rows.push({ account: k % 3 === 2 ? numbers.bills : numbers.everyday, date, amount: money(amount), description: `${shop} ${k}`, counterparty: shop });
  }
  for (let g = 0; g < spec.repeatGroups; g++) {
    const date = dayOf(g, spec.repeatGroups);
    const row: RowSpec = { account: numbers.everyday, date, amount: kr(-10), description: "Automatisk sparing", counterparty: "Automatisk sparing" };
    for (let i = 0; i < 2 + (g % 3); i++) rows.push(row);
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** IDs from a counter starting after `start`, the same sequence every time. */
export function countingIds(start: number): ImportIds {
  let n = start;
  return {
    batch: () => importBatchId(testId(++n)),
    row: () => importRowId(testId(++n)),
    enteredValue: () => enteredValueId(testId(++n)),
  };
}

export function importInput(fingerprint: string, start: number, balances: readonly TypedBalance[] = []): ImportInput {
  return { fileName: `${fingerprint}.csv`, fingerprint, importedAt: `2026-11-09T10:00:00Z`, balances, asOf: today, ids: countingIds(start) };
}

/** The plan's command applied. Throws when the plan was blocked or the app refused it, so a test fails loudly. */
export function commitPlan(facts: Facts, plan: ImportPlan): Facts {
  if (!plan.ok) throw new Error(`Blocked: ${plan.blocked.kind}`);
  const result: ApplyResult = apply(facts, plan.command, { asOf: today });
  if (!result.ok) throw new Error(`Refused (${result.refusal.code}): ${result.refusal.message}`);
  return result.facts;
}
