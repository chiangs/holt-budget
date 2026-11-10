import { DateError, type AccountNumber, type Currency, type LocalDate, type Money, MoneyError, localDate, parseAccountNumber, parseMoney } from "@holt/core";
import { ImportError } from "./types.ts";

export function accountNumber(text: string, line: number): AccountNumber {
  const parsed = parseAccountNumber(text);
  if (parsed === null) throw new ImportError(`"${text}" isn't an 11-digit account number.`, line);
  return parsed;
}

/** The other side of a row: an account number when it is one, otherwise a name such as a shop's. */
export function counterpart(text: string): { counterpartAccount: AccountNumber } | { counterpartName: string } | {} {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  const parsed = parseAccountNumber(trimmed);
  return parsed !== null ? { counterpartAccount: parsed } : { counterpartName: trimmed };
}

/** Reads "2026-10-22" or "22.10.2026". */
export function isoDate(text: string, line: number): LocalDate {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  const norwegian = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : norwegian ? [norwegian[3], norwegian[2], norwegian[1]] : [];
  try {
    return localDate(`${y}-${m}-${d}`);
  } catch (error) {
    if (error instanceof DateError) throw new ImportError(`"${text}" isn't a date.`, line);
    throw error;
  }
}

export function optionalIsoDate(text: string, line: number): LocalDate | undefined {
  return text.trim() === "" ? undefined : isoDate(text, line);
}

export function amount(text: string, currency: Currency, line: number, decimalSeparator: "," | "." = ","): Money {
  try {
    return parseMoney(text, currency, decimalSeparator);
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

/** The start of a file without leading blank space, for recognising a format. JavaScript counts a byte-order mark as blank space. */
export function startOf(text: string, length = 2048): string {
  return text.slice(0, length + 1).trimStart().slice(0, length);
}
