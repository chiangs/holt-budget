/**
 * Dates in Holt are branded strings, never `Date`, which can shift a day across time zones.
 * `LocalDate` is "2026-11-08" and `Month` is "2026-11". Both sort correctly as plain strings.
 * Calendar arithmetic here uses UTC only to count days, so the result never depends on the machine's zone.
 */

declare const localDateBrand: unique symbol;
declare const monthBrand: unique symbol;

export type LocalDate = string & { readonly [localDateBrand]: true };
export type Month = string & { readonly [monthBrand]: true };

export class DateError extends Error {
  override name = "DateError";
}

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthPattern = /^(\d{4})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Check a calendar date such as "2026-11-08". Throws for anything that is not a real day. */
export function localDate(text: string): LocalDate {
  const parts = datePattern.exec(text);
  const [year, month, day] = [Number(parts?.[1]), Number(parts?.[2]), Number(parts?.[3])];
  if (!parts || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new DateError(`Not a calendar date: "${text}"`);
  }
  return text as LocalDate;
}

/** Check a calendar month such as "2026-11". */
export function month(text: string): Month {
  const parts = monthPattern.exec(text);
  const m = Number(parts?.[2]);
  if (!parts || m < 1 || m > 12) throw new DateError(`Not a calendar month: "${text}"`);
  return text as Month;
}

export function monthOf(date: LocalDate): Month {
  return date.slice(0, 7) as Month;
}

export function firstDayOf(m: Month): LocalDate {
  return `${m}-01` as LocalDate;
}

export function lastDayOf(m: Month): LocalDate {
  const [year, mm] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
  return `${m}-${String(daysInMonth(year, mm)).padStart(2, "0")}` as LocalDate;
}

/** The month `count` months after `m`. Negative counts go back. */
export function addMonths(m: Month, count: number): Month {
  if (!Number.isInteger(count)) throw new DateError(`Months must be a whole number: ${count}`);
  const index = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + count;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12 + 12) % 12 + 1).padStart(2, "0")}` as Month;
}

/** Whole months from `from` to `to`: positive when `to` is later. */
export function monthsBetween(from: Month, to: Month): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

/** The months from `from` to `to`, both included. Empty when `to` is earlier. */
export function monthRange(from: Month, to: Month): Month[] {
  const count = monthsBetween(from, to);
  return count < 0 ? [] : Array.from({ length: count + 1 }, (_, i) => addMonths(from, i));
}

function utcDay(date: LocalDate): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return utcDay(to) - utcDay(from);
}

export function addDays(date: LocalDate, count: number): LocalDate {
  if (!Number.isInteger(count)) throw new DateError(`Days must be a whole number: ${count}`);
  return new Date((utcDay(date) + count) * 86_400_000).toISOString().slice(0, 10) as LocalDate;
}
