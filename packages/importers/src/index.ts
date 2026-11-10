/**
 * Bank statement importers. The formats that ship with Holt are code (technical-decisions.md §13).
 * Real exports stay in private/fixtures/; the committed fixtures are synthetic (src/synthetic.ts, scripts/make-synthetic.ts).
 */
import { bulder } from "./formats/bulder.ts";
import { ofx } from "./formats/ofx.ts";
import { sparebank1 } from "./formats/sparebank1.ts";
import type { BankFormat } from "./types.ts";

export * from "./types.ts";
export { readCsv } from "./csv.ts";
export { cleanCounterparty, type CounterpartyInput } from "./counterparty.ts";
export { decodeStatement, type DecodedStatement } from "./decode.ts";

export const formats: readonly BankFormat[] = [bulder, sparebank1, ofx];

/** The format whose header the file starts with, or null when Holt doesn't know it yet. */
export function recogniseFormat(text: string): BankFormat | null {
  return formats.find((f) => f.recognises(text)) ?? null;
}
