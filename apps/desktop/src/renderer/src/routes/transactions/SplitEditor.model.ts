/**
 * The state of the split editor and what it lets the family save. A row holds what the person typed, so the
 * model keeps the text and works out the money from it. The family types amounts without a sign ("700" for a
 * payment of 700 kr, and for a refund of 700 kr); the model gives each allocation the transaction's sign.
 * `checkSplit` is the only gate to Save, and it hands back allocations only when they pass core's `makeSplit`.
 */

import { type Allocation, type Currency, type JobId, type Money, type Transaction, MoneyError, makeSplit, minorUnitDigits, money, parseMoney } from "@holt/core";

export const maxSplitRows = 12;

export interface SplitRow {
  readonly key: number;
  readonly jobId: JobId | null;
  /** What the person typed. */
  readonly text: string;
}

export interface SplitDraft {
  readonly rows: readonly SplitRow[];
  readonly nextKey: number;
}

export type DecimalSeparator = "," | ".";

/**
 * An amount as typed: "700", "1 234,50", "1234.50". A comma or a point followed by one or two digits at the end
 * is the decimal separator whichever the interface language uses, because a wrong guess here would be a
 * thousand times out. Null when the text is not an amount.
 */
export function parseAmountText(text: string, code: Currency): Money | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const compact = trimmed.replace(/[\s  ]/g, "");
  const separator: DecimalSeparator = /,\d{1,2}$/.test(compact) ? "," : ".";
  try {
    return parseMoney(trimmed, code, separator);
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

/** A whole amount as typed, in the interface language's decimal separator: "700", "700,50". */
export function formatAmountInput(amount: Money, code: Currency, separator: DecimalSeparator): string {
  const digits = minorUnitDigits(code);
  const scale = 10 ** digits;
  const absolute = Math.abs(amount);
  const whole = Math.floor(absolute / scale);
  const fraction = absolute % scale;
  return fraction === 0 ? String(whole) : `${whole}${separator}${String(fraction).padStart(digits, "0")}`;
}

const emptyRow = (key: number): SplitRow => ({ key, jobId: null, text: "" });

/**
 * Starts from the given allocations, or from two empty rows. A transaction that already has one job gets a
 * second empty row, because opening the editor means splitting it.
 */
export function initialDraft(initial: readonly Allocation[] | undefined, code: Currency, separator: DecimalSeparator): SplitDraft {
  if (initial === undefined || initial.length === 0) return { rows: [emptyRow(0), emptyRow(1)], nextKey: 2 };
  const rows = initial.map((allocation, key): SplitRow => ({ key, jobId: allocation.jobId, text: formatAmountInput(allocation.amount, code, separator) }));
  const padded = rows.length === 1 ? [...rows, emptyRow(1)] : rows;
  return { rows: padded, nextKey: padded.length };
}

export function addRow(draft: SplitDraft): SplitDraft {
  if (draft.rows.length >= maxSplitRows) return draft;
  return { rows: [...draft.rows, emptyRow(draft.nextKey)], nextKey: draft.nextKey + 1 };
}

/** Removes a row. The last row stays, because a split has at least one allocation. */
export function removeRow(draft: SplitDraft, key: number): SplitDraft {
  if (draft.rows.length <= 1) return draft;
  return { ...draft, rows: draft.rows.filter((row) => row.key !== key) };
}

export function setRowJob(draft: SplitDraft, key: number, jobId: JobId | null): SplitDraft {
  return { ...draft, rows: draft.rows.map((row) => (row.key === key ? { ...row, jobId } : row)) };
}

export function setRowText(draft: SplitDraft, key: number, text: string): SplitDraft {
  return { ...draft, rows: draft.rows.map((row) => (row.key === key ? { ...row, text } : row)) };
}

export type RowProblem = "badAmount" | "zero" | "noJob" | "duplicateJob";

export interface RowCheck {
  readonly key: number;
  /** What the row's text is worth, as a positive amount. Null when it is empty, not an amount, negative or zero. */
  readonly magnitude: Money | null;
  /** What is wrong with the row, most important first. An empty amount is not a problem until Save. */
  readonly problem: RowProblem | null;
}

/** Why Save is off, in the order the person should fix them. */
export type Blocker = "tooMany" | "badAmount" | "zero" | "noJob" | "duplicateJob" | "over" | "notAllAssigned" | "noAmount";

export interface SplitCheck {
  /** The transaction's whole amount, as a positive number. */
  readonly total: Money;
  readonly rows: readonly RowCheck[];
  /** What the rows with a usable amount add up to. */
  readonly assigned: Money;
  /** The whole amount less what the rows add up to. Negative when the rows are over. */
  readonly left: Money;
  /** Empty exactly when `allocations` is set. */
  readonly blockers: readonly Blocker[];
  /** Set only when the rows add up to the whole amount exactly, each is a non-zero amount of the transaction's sign, and no job appears twice. */
  readonly allocations: readonly [Allocation, ...Allocation[]] | null;
}

const blockerOrder: readonly Blocker[] = ["tooMany", "badAmount", "zero", "noJob", "noAmount", "duplicateJob", "over", "notAllAssigned"];

function problemOf(row: SplitRow, parsed: Money | null, duplicated: ReadonlySet<JobId>): RowProblem | null {
  if (parsed === null) return row.text.trim() === "" ? null : "badAmount";
  if (parsed < 0) return "badAmount";
  if (parsed === 0) return "zero";
  return row.jobId !== null && duplicated.has(row.jobId) ? "duplicateJob" : null;
}

export function checkSplit(transaction: Pick<Transaction, "amount">, rows: readonly SplitRow[], code: Currency): SplitCheck {
  const total = money(Math.abs(transaction.amount));
  const seen = new Set<JobId>();
  const duplicated = new Set<JobId>();
  for (const row of rows) {
    if (row.jobId === null) continue;
    if (seen.has(row.jobId)) duplicated.add(row.jobId);
    seen.add(row.jobId);
  }

  let assigned = 0;
  const checks = rows.map((row): RowCheck => {
    const parsed = parseAmountText(row.text, code);
    const magnitude = parsed !== null && parsed > 0 ? parsed : null;
    if (magnitude !== null) assigned += magnitude;
    return { key: row.key, magnitude, problem: problemOf(row, parsed, duplicated) };
  });
  const left = money(total - assigned);

  const found = new Set<Blocker>();
  if (rows.length > maxSplitRows) found.add("tooMany");
  if (total === 0) found.add("zero");
  for (const check of checks) if (check.problem !== null) found.add(check.problem);
  if (rows.some((row) => row.jobId === null)) found.add("noJob");
  if (rows.some((row) => row.text.trim() === "")) found.add("noAmount");
  if (left < 0) found.add("over");
  if (left > 0) found.add("notAllAssigned");
  const blockers = blockerOrder.filter((blocker) => found.has(blocker));

  return { total, rows: checks, assigned: money(assigned), left, blockers, allocations: blockers.length === 0 ? allocationsOf(transaction, rows, checks) : null };
}

function allocationsOf(transaction: Pick<Transaction, "amount">, rows: readonly SplitRow[], checks: readonly RowCheck[]): readonly [Allocation, ...Allocation[]] | null {
  const sign = Math.sign(transaction.amount);
  const allocations: Allocation[] = [];
  rows.forEach((row, i) => {
    const magnitude = checks[i]?.magnitude;
    if (row.jobId !== null && magnitude !== null && magnitude !== undefined) allocations.push({ jobId: row.jobId, amount: money(sign * magnitude) });
  });
  const [first, ...rest] = allocations;
  if (first === undefined || allocations.length !== rows.length) return null;
  try {
    makeSplit(transaction.amount, allocations);
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
  return [first, ...rest];
}

/** What the other rows leave: the amount "Assign the rest" puts in a row. Zero or less means nothing is left for it. */
export function restFor(check: SplitCheck, key: number): Money {
  const own = check.rows.find((row) => row.key === key)?.magnitude ?? 0;
  return money(check.left + own);
}

/** Puts what the other rows leave into this row. Does nothing when nothing is left. */
export function assignRest(draft: SplitDraft, key: number, transaction: Pick<Transaction, "amount">, code: Currency, separator: DecimalSeparator): SplitDraft {
  const rest = restFor(checkSplit(transaction, draft.rows, code), key);
  return rest > 0 ? setRowText(draft, key, formatAmountInput(rest, code, separator)) : draft;
}

/** Shares the whole amount between every row. The pieces differ by at most one minor unit, the extra units going to the first rows, so they add up exactly. */
export function splitEvenly(draft: SplitDraft, transaction: Pick<Transaction, "amount">, code: Currency, separator: DecimalSeparator): SplitDraft {
  const count = draft.rows.length;
  const total = Math.abs(transaction.amount);
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return { ...draft, rows: draft.rows.map((row, i) => ({ ...row, text: formatAmountInput(money(base + (i < extra ? 1 : 0)), code, separator) })) };
}
