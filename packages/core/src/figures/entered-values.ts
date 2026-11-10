/**
 * Entered values (domain model, "Entered value"; rule 10). A change adds a row, so the value that counts
 * is the latest row for its kind and subject. A row dated after `asOf` doesn't count yet, and two rows on
 * the same day are told apart by their UUIDv7 IDs, which sort in the order they were made.
 */

import { type LocalDate, localDate } from "../dates.ts";
import type { EnteredValue, EnteredValueKind, Facts } from "../facts.ts";

export type LatestEnteredValues = ReadonlyMap<string, EnteredValue>;

const keyOf = (kind: EnteredValueKind, subject: string): string => `${kind}:${subject}`;

export function latestEnteredValues(facts: Facts, asOf: LocalDate): LatestEnteredValues {
  const latest = new Map<string, EnteredValue>();
  for (const row of facts.enteredValues.values()) {
    if (row.asOf > asOf) continue;
    const key = keyOf(row.kind, row.subject);
    const held = latest.get(key);
    if (held === undefined || row.asOf > held.asOf || (row.asOf === held.asOf && row.id > held.id)) latest.set(key, row);
  }
  return latest;
}

export function latestValue(latest: LatestEnteredValues, kind: EnteredValueKind, subject: string): EnteredValue | undefined {
  return latest.get(keyOf(kind, subject));
}

/** The same day a year later. 29 February becomes 28 February. */
function twelveMonthsAfter(date: LocalDate): LocalDate {
  const year = String(Number(date.slice(0, 4)) + 1).padStart(4, "0");
  const monthAndDay = date.slice(4) === "-02-29" ? "-02-28" : date.slice(4);
  return localDate(`${year}${monthAndDay}`);
}

export interface StaleEnteredValue {
  readonly value: EnteredValue;
  /** Twelve months after the value's date. The value is stale from the day after. */
  readonly reviewBy: LocalDate;
}

/** The latest value of each kind and subject that is more than twelve months old, oldest first (rule 10). */
export function staleEnteredValues(latest: LatestEnteredValues, asOf: LocalDate): StaleEnteredValue[] {
  return [...latest.values()]
    .map((value) => ({ value, reviewBy: twelveMonthsAfter(value.asOf) }))
    .filter((stale) => asOf > stale.reviewBy)
    .sort((a, b) => (a.reviewBy === b.reviewBy ? (a.value.id < b.value.id ? -1 : 1) : a.reviewBy < b.reviewBy ? -1 : 1));
}
