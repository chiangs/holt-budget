import { type Currency, type Money, MoneyError, parseMoney } from "@holt/core";
import { type AccountNumber, ImportError, type IsoDate } from "./types.ts";

export function accountNumber(text: string, line: number): AccountNumber {
  const digits = text.replace(/[\s.]/g, "");
  if (!/^\d{11}$/.test(digits)) throw new ImportError(`"${text}" isn't an 11-digit account number.`, line);
  return digits as AccountNumber;
}

/** The other side of a row: an account number when it is one, otherwise a name such as a shop's. */
export function counterpart(text: string): { counterpartAccount: AccountNumber } | { counterpartName: string } | {} {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  const digits = trimmed.replace(/[\s.]/g, "");
  return /^\d{11}$/.test(digits) ? { counterpartAccount: digits as AccountNumber } : { counterpartName: trimmed };
}

function validDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Reads "2026-10-22" or "22.10.2026". */
export function isoDate(text: string, line: number): IsoDate {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  const norwegian = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : norwegian ? [norwegian[3], norwegian[2], norwegian[1]] : [];
  if (y === undefined || m === undefined || d === undefined || !validDate(Number(y), Number(m), Number(d))) {
    throw new ImportError(`"${text}" isn't a date.`, line);
  }
  return `${y}-${m}-${d}` as IsoDate;
}

export function optionalIsoDate(text: string, line: number): IsoDate | undefined {
  return text.trim() === "" ? undefined : isoDate(text, line);
}

export function amount(text: string, currency: Currency, line: number): Money {
  try {
    return parseMoney(text, currency, ",");
  } catch (error) {
    if (error instanceof MoneyError) throw new ImportError(`"${text}" isn't an amount.`, line);
    throw error;
  }
}

/** Looks up each named column in the header, so a reordered export still reads correctly. */
export function columnIndexes<const Name extends string>(header: readonly string[], names: readonly Name[]): Record<Name, number> {
  const indexes = {} as Record<Name, number>;
  for (const name of names) {
    const i = header.indexOf(name);
    if (i === -1) throw new ImportError(`The header has no "${name}" column.`, 1);
    indexes[name] = i;
  }
  return indexes;
}
