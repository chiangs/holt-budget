/**
 * Bank statement importers. The formats that ship with Holt are code (technical-decisions.md §13).
 * Real exports stay in private/fixtures/; the committed fixtures are synthetic (scripts/make-synthetic.ts).
 */
import { bulder } from "./formats/bulder.ts";
import { sparebank1 } from "./formats/sparebank1.ts";
import type { BankFormat } from "./types.ts";

export * from "./types.ts";
export { readCsv } from "./csv.ts";

export const formats: readonly BankFormat[] = [bulder, sparebank1];

/** The format whose header matches the file's first line, or null when Holt doesn't know it yet. */
export function recogniseFormat(text: string): BankFormat | null {
  const firstLine = (text.split(/\r?\n/, 1)[0] ?? "").replace(/^﻿/, "");
  return formats.find((f) => f.recognises(firstLine)) ?? null;
}
