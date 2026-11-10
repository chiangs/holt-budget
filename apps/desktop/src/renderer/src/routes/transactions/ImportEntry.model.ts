import { type AccountId, type Currency, type JobId, type LocalDate, type Money, MoneyError, localDate, minorUnitDigits, parseMoney } from "@holt/core";
import type { ImportEntry } from "../../../../shared/import-types.ts";

/** What the family typed for the balance their bank shows. */
export type BalanceText = { readonly kind: "empty" } | { readonly kind: "amount"; readonly value: Money } | { readonly kind: "invalid" };

const decimalDigits = /^[\d]+$/;

/**
 * Which character is the decimal separator in what the family typed. English writes "24,960.50" and Norwegian
 * "24 960,50", and `parseMoney` strips the other one as a thousands separator, so a wrong guess would make
 * 24960.50 kr into 2,496,050 kr. A lone separator followed by 1 or 2 digits (the currency's decimals) is decimal;
 * followed by 3 it groups thousands. With both, the last one is the decimal separator.
 */
function decimalSeparatorOf(text: string, digits: number): "," | "." {
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) return lastComma > lastDot ? "," : ".";
  const only = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
  if (only === null) return ",";
  const parts = text.split(only);
  const after = parts[parts.length - 1] ?? "";
  const single = parts.length === 2;
  return single && digits > 0 && decimalDigits.test(after) && after.length <= digits ? only : only === "," ? "." : ",";
}

/** Reads a typed balance as integer minor units, never through a float. A currency marker after the number is ignored. */
export function parseBalanceText(text: string, code: Currency): BalanceText {
  const cleaned = text
    .trim()
    .replace(/[\s  ]+/g, "")
    .replace(new RegExp(`(?:kr\\.?|${code})$`, "i"), "");
  if (cleaned === "") return { kind: "empty" };
  const decimal = decimalSeparatorOf(cleaned, minorUnitDigits(code));
  const grouping = decimal === "," ? "." : ",";
  // Groups of thousands are exactly three digits, so "12,345,67" is a slip, not 1,234,567.
  if (cleaned.includes(grouping) && !new RegExp(`^[+\\-\u2212]?\\d{1,3}(?:[${grouping}]\\d{3})+(?:[${decimal}]\\d*)?$`).test(cleaned)) return { kind: "invalid" };
  try {
    return { kind: "amount", value: parseMoney(cleaned, code, decimal) };
  } catch (error) {
    if (error instanceof MoneyError) return { kind: "invalid" };
    throw error;
  }
}

/** The balance the bank shows for one account: the text as typed and the date as the date field holds it. */
export interface BalanceField {
  readonly accountId: AccountId;
  readonly text: string;
  readonly asOf: string;
}

/** A job the family chose for a new row, with the row's amount, so the whole amount goes to that job. */
export interface JobChoice {
  readonly line: number;
  readonly jobId: JobId;
  readonly amount: Money;
}

/** Everything the family has told the app about this file so far. */
export interface EntryDraft {
  readonly balances: readonly BalanceField[];
  readonly choices: readonly JobChoice[];
  readonly suggest: boolean;
}

export type BalanceProblem = "amount" | "date" | "future";

export interface BuiltEntry {
  readonly entry: ImportEntry;
  /** Accounts whose typed balance the app can't use yet, so the field can say why. Such a balance is left out of the entry. */
  readonly problems: ReadonlyMap<AccountId, BalanceProblem>;
}

function validDate(text: string): LocalDate | null {
  try {
    return localDate(text);
  } catch {
    return null;
  }
}

/** The entry the bridge takes. A balance the app can't read is left out, so a half-typed amount never reaches the main process. */
export function buildEntry(draft: EntryDraft, code: Currency, today: LocalDate): BuiltEntry {
  const balances: ImportEntry["balances"][number][] = [];
  const problems = new Map<AccountId, BalanceProblem>();
  for (const field of draft.balances) {
    const amount = parseBalanceText(field.text, code);
    if (amount.kind === "empty") continue;
    if (amount.kind === "invalid") {
      problems.set(field.accountId, "amount");
      continue;
    }
    const asOf = validDate(field.asOf);
    if (asOf === null) problems.set(field.accountId, "date");
    else if (asOf > today) problems.set(field.accountId, "future");
    else balances.push({ accountId: field.accountId, value: amount.value, asOf });
  }
  const choices: ImportEntry["choices"] = [...draft.choices]
    .sort((a, b) => a.line - b.line)
    .map(({ line, jobId, amount }) => ({ line, treatment: { kind: "split", allocations: [{ jobId, amount }] } }));
  return { entry: { balances, choices, suggest: draft.suggest }, problems };
}

export const withBalanceText = (draft: EntryDraft, accountId: AccountId, text: string): EntryDraft => ({
  ...draft,
  balances: draft.balances.map((field) => (field.accountId === accountId ? { ...field, text } : field)),
});

export const withBalanceDate = (draft: EntryDraft, accountId: AccountId, asOf: string): EntryDraft => ({
  ...draft,
  balances: draft.balances.map((field) => (field.accountId === accountId ? { ...field, asOf } : field)),
});

/** One choice for each line: choosing again replaces the earlier one. */
export const withChoice = (draft: EntryDraft, choice: JobChoice): EntryDraft => ({
  ...draft,
  choices: [...draft.choices.filter((existing) => existing.line !== choice.line), choice],
});

export const withoutChoice = (draft: EntryDraft, line: number): EntryDraft => ({ ...draft, choices: draft.choices.filter((choice) => choice.line !== line) });

export const withSuggest = (draft: EntryDraft, suggest: boolean): EntryDraft => ({ ...draft, suggest });

/** The same entry gives the same plan, so the page asks for a new plan only when this changes. */
export function sameEntry(a: ImportEntry, b: ImportEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
