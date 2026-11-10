import type { LocalDate } from "@holt/core";

/** "19 Oct" in British English, "19. okt." in Norwegian. A `LocalDate` is a calendar day, so no time zone shifts it. */
export function formatDay(date: LocalDate, locale: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "19 Oct 2026". */
export function formatFullDay(date: LocalDate, locale: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const at = (d: LocalDate) => Date.UTC(...(d.split("-").map(Number) as [number, number, number]).map((n, i) => (i === 1 ? n - 1 : n)) as [number, number, number]);
  return Math.round((at(to) - at(from)) / 86_400_000);
}
