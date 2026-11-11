import type { Month } from "@holt/core";

function at(month: Month): Date {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1, 1));
}

/** "November 2026". A month is a calendar month, so no time zone shifts it. */
export function monthAndYear(month: Month, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(at(month));
}

/** "November". */
export function monthOnly(month: Month, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(at(month));
}

/** "May 2027". */
export function shortMonthAndYear(month: Month, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(at(month));
}
