import { type Currency, type Money, add, minorUnitDigits, money } from "../money.ts";
import type { Filter, Period, TransactionQuery, Weekday } from "./query.ts";

/**
 * What a transaction query needs to know about a transaction. Milestone 2's Transaction provides these fields.
 * Dates are "yyyy-mm-dd" until core's LocalDate exists.
 */
export interface QueryableTransaction {
  readonly id: string;
  /** The account's name as the family calls it. */
  readonly account: string;
  readonly bookingDate: string;
  /** Negative means money out. */
  readonly amount: Money;
  /** The other party's name, as the bank gives it. Empty when the bank gives only a number. */
  readonly counterparty: string;
  /** The other party's account number, when the bank gives one. */
  readonly counterpartyAccount?: string;
  readonly description: string;
  readonly job?: string;
  /** A move between two of the household's own accounts. */
  readonly transfer: boolean;
  /** The currency a purchase abroad was made in. */
  readonly originalCurrency?: string;
}

export interface AskContext {
  /** Today's date, "yyyy-mm-dd", for relative periods. */
  readonly today: string;
  readonly currency: Currency;
}

/** A sum, average or monthly average is money; a count is a number of transactions. */
export type Value = { readonly kind: "money"; readonly amount: Money } | { readonly kind: "count"; readonly count: number };

export interface Group {
  readonly key: string;
  readonly value: Value;
  readonly transactions: number;
}

export interface TransactionResult {
  readonly query: TransactionQuery;
  /** The dates the period resolved to, both inclusive. */
  readonly from: string;
  readonly to: string;
  readonly value: Value;
  readonly groups?: readonly Group[];
  /** Every matching transaction, for "show working"; for a list with `top`, only the ones kept. */
  readonly matched: readonly QueryableTransaction[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthRange = (year: number, month: number) => ({ from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay(year, month))}` });
/** Moves a (year, month) by a number of months. */
function shift(year: number, month: number, by: number): [number, number] {
  const index = year * 12 + (month - 1) + by;
  return [Math.floor(index / 12), (index % 12) + 1];
}

export function resolvePeriod(period: Period, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (period.type) {
    case "month":
      return monthRange(Number(period.month.slice(0, 4)), Number(period.month.slice(5, 7)));
    case "year":
      return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
    case "range":
      return { from: period.from, to: period.to };
    case "this-month":
      return monthRange(year, month);
    case "last-month":
      return monthRange(...shift(year, month, -1));
    case "this-year":
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case "last-months": {
      const [fy, fm] = shift(year, month, -period.count);
      const [ty, tm] = shift(year, month, -1);
      return { from: monthRange(fy, fm).from, to: monthRange(ty, tm).to };
    }
  }
}

/** Whole months the range touches, counting partial months at either end as whole. */
function monthsIn(from: string, to: string): number {
  const months = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  return Math.max(1, months(to) - months(from) + 1);
}

const weekdays: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const weekdayOf = (date: string): Weekday =>
  weekdays[new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay()]!;

const contains = (haystack: string, needles: readonly string[]) => {
  const h = haystack.toLocaleLowerCase("nb");
  return needles.some((n) => h.includes(n.toLocaleLowerCase("nb")));
};

function matches(t: QueryableTransaction, filter: Filter, from: string, to: string, unit: number): boolean {
  if (t.bookingDate < from || t.bookingDate > to) return false;
  if (filter.transfers === "exclude" && t.transfer) return false;
  if (filter.transfers === "only" && !t.transfer) return false;
  if (filter.accounts && !filter.accounts.includes(t.account)) return false;
  if (filter.jobs && (t.job === undefined || !filter.jobs.includes(t.job))) return false;
  if (filter.counterparties && !contains(`${t.counterparty} ${t.counterpartyAccount ?? ""}`, filter.counterparties)) return false;
  if (filter.text && !contains(t.description, filter.text)) return false;
  if (filter.direction === "in" && t.amount <= 0) return false;
  if (filter.direction === "out" && t.amount >= 0) return false;
  if (filter.weekdays && !filter.weekdays.includes(weekdayOf(t.bookingDate))) return false;
  if (filter.foreign === true && t.originalCurrency === undefined) return false;
  if (filter.foreign === false && t.originalCurrency !== undefined) return false;
  const size = Math.abs(t.amount);
  if (filter.amount?.atLeast !== undefined && size < filter.amount.atLeast * unit) return false;
  if (filter.amount?.atMost !== undefined && size > filter.amount.atMost * unit) return false;
  return true;
}

/** Divides money into whole minor units, rounding half away from zero. */
function divide(total: Money, by: number): Money {
  return money(Math.sign(total) * Math.round(Math.abs(total) / by));
}

function measure(query: TransactionQuery, rows: readonly QueryableTransaction[], months: number): Value {
  const total = add(...rows.map((t) => t.amount));
  switch (query.measure) {
    case "count":
      return { kind: "count", count: rows.length };
    case "sum":
    case "list":
      return { kind: "money", amount: total };
    case "average":
      return { kind: "money", amount: rows.length === 0 ? money(0) : divide(total, rows.length) };
    case "monthly-average":
      return { kind: "money", amount: divide(total, months) };
  }
}

const size = (v: Value) => (v.kind === "money" ? Math.abs(v.amount) : v.count);

function groupKey(t: QueryableTransaction, by: NonNullable<TransactionQuery["groupBy"]>): string {
  switch (by) {
    case "month":
      return t.bookingDate.slice(0, 7);
    case "counterparty":
      return t.counterparty || t.counterpartyAccount || "";
    case "job":
      return t.job ?? "";
    case "account":
      return t.account;
    case "currency":
      return t.originalCurrency ?? "";
  }
}

/** Runs a transaction query over the household's transactions. Pure: the same inputs always give the same result. */
export function evaluateTransactionQuery(
  query: TransactionQuery,
  transactions: readonly QueryableTransaction[],
  context: AskContext,
): TransactionResult {
  const { from, to } = resolvePeriod(query.filter.period, context.today);
  const unit = 10 ** minorUnitDigits(context.currency);
  const rows = transactions
    .filter((t) => matches(t, query.filter, from, to, unit))
    .toSorted((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id));
  const months = monthsIn(from, to);

  if (query.groupBy === undefined) {
    const matched = query.measure === "list" && query.top !== undefined
      ? rows.toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, query.top)
      : rows;
    return { query, from, to, value: measure(query, matched, months), matched };
  }

  const byKey = new Map<string, QueryableTransaction[]>();
  for (const t of rows) {
    const key = groupKey(t, query.groupBy);
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  let groups: Group[] = [...byKey].map(([key, members]) => ({ key, value: measure(query, members, months), transactions: members.length }));
  groups = query.top === undefined
    ? groups.toSorted((a, b) => a.key.localeCompare(b.key))
    : groups.toSorted((a, b) => size(b.value) - size(a.value) || a.key.localeCompare(b.key)).slice(0, query.top);
  return { query, from, to, value: measure(query, rows, months), groups, matched: rows };
}
