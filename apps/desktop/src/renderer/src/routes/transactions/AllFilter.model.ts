/**
 * What the All tab lists: every transaction, newest booking date first, narrowed by a search and filters.
 * Pure data in, pure data out, so it is tested without a browser. The index is built once for each state of
 * the facts and shared by every keystroke after it, which keeps typing fast at 8,500 transactions.
 *
 * Core's Ask filter (`evaluateTransactionQuery`) is not used for the search. It needs a period, names
 * accounts and jobs by their text, and has no notion of a treatment, a note, a rule or a month, so each
 * keystroke would first map every transaction into its own shape. The search keeps Ask's way of matching
 * words, though: a case-insensitive "contains" under the Norwegian locale, so both find the same names.
 */

import type { AccountId, Facts, Job, JobId, Month, Transaction, Treatment } from "@holt/core";
import type { PickableJob } from "./jobs.ts";

export type TreatmentKind = Treatment["kind"];

/** A record, so a new treatment kind fails to compile here until the filter lists it. */
const listed: Record<TreatmentKind, true> = { needsYou: true, income: true, transfer: true, split: true, history: true };

/** Every treatment kind, in the order the filter offers them. */
export const treatmentKinds = Object.keys(listed) as readonly TreatmentKind[];

export type RuleFilter = "any" | "applied" | "none";

export interface AllFilter {
  readonly search: string;
  readonly account: AccountId | null;
  readonly job: JobId | null;
  readonly treatment: TreatmentKind | null;
  readonly month: Month | null;
  readonly rule: RuleFilter;
}

export const everything: AllFilter = { search: "", account: null, job: null, treatment: null, month: null, rule: "any" };

export function isFiltering(filter: AllFilter): boolean {
  return filter.search.trim() !== "" || filter.account !== null || filter.job !== null || filter.treatment !== null || filter.month !== null || filter.rule !== "any";
}

/** The jobs a transaction counts against: its allocations, or the job a history transaction carries. */
export function jobsOf(transaction: Transaction): readonly JobId[] {
  const { treatment } = transaction;
  switch (treatment.kind) {
    case "split":
      return treatment.allocations.map((allocation) => allocation.jobId);
    case "history":
      return treatment.jobId === null ? [] : [treatment.jobId];
    case "needsYou":
    case "income":
    case "transfer":
      return [];
  }
}

/** Newest booking date first, then by ID, so the same transactions always list the same way whatever order they arrive in. */
export function compareTransactions(a: Transaction, b: Transaction): number {
  if (a.bookingDate !== b.bookingDate) return a.bookingDate < b.bookingDate ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortTransactions(transactions: Iterable<Transaction>): Transaction[] {
  return [...transactions].sort(compareTransactions);
}

const fold = (text: string): string => text.toLocaleLowerCase("nb");

/** The amount as digits a person types: kroner, then a comma and the minor units only when they are not zero. "1390" or "1390,50". */
export function amountDigits(amount: number, minorDigits: number): string {
  const absolute = Math.abs(amount);
  const scale = 10 ** minorDigits;
  const whole = Math.floor(absolute / scale);
  const fraction = absolute % scale;
  return fraction === 0 ? String(whole) : `${whole},${String(fraction).padStart(minorDigits, "0")}`;
}

export interface BrowseIndex {
  /** Every transaction, sorted. */
  readonly rows: readonly Transaction[];
  /** For each row, in the same order: the lower-cased description, counterparty and note, kept apart so a search never matches across them. */
  readonly text: readonly string[];
  readonly amounts: readonly string[];
  /** The months that hold a transaction, newest first. */
  readonly months: readonly Month[];
}

export function buildBrowseIndex(transactions: Iterable<Transaction>, minorDigits: number): BrowseIndex {
  const rows = sortTransactions(transactions);
  const months = new Set<Month>();
  const text: string[] = [];
  const amounts: string[] = [];
  for (const t of rows) {
    text.push(fold(`${t.description}\n${t.counterparty ?? ""}\n${t.note ?? ""}`));
    amounts.push(amountDigits(t.amount, minorDigits));
    months.add(t.bookingDate.slice(0, 7) as Month);
  }
  return { rows, text, amounts, months: [...months] };
}

interface Query {
  readonly words: string;
  /** Set when the search reads as an amount: digits, spaces, a point or a comma, perhaps a sign. */
  readonly amount: string | null;
}

const looksLikeAmount = /^[-−+]?\s*\d[\d\s.,  ]*$/;

function parseSearch(search: string): Query | null {
  const trimmed = search.trim();
  if (trimmed === "") return null;
  const amount = looksLikeAmount.test(trimmed) ? trimmed.replace(/^[-−+]\s*/, "").replace(/[\s  ]/g, "").replace(/\./g, ",") : null;
  return { words: fold(trimmed), amount };
}

/**
 * The transactions that pass every part of the filter, in the index's order. A search matches the
 * description, the counterparty or the note, or, when it reads as an amount, any amount that contains those
 * digits ("1390" finds -1,390 kr and 51,390.50 kr alike).
 */
export function filterIndex(index: BrowseIndex, filter: AllFilter): readonly Transaction[] {
  if (!isFiltering(filter)) return index.rows;
  const query = parseSearch(filter.search);
  const out: Transaction[] = [];
  for (let i = 0; i < index.rows.length; i += 1) {
    const t = index.rows[i]!;
    if (filter.account !== null && t.accountId !== filter.account) continue;
    if (filter.treatment !== null && t.treatment.kind !== filter.treatment) continue;
    if (filter.month !== null && t.bookingDate.slice(0, 7) !== filter.month) continue;
    if (filter.rule === "applied" && t.ruleId === undefined) continue;
    if (filter.rule === "none" && t.ruleId !== undefined) continue;
    if (filter.job !== null && !jobsOf(t).includes(filter.job)) continue;
    if (query !== null && !(index.text[i]!.includes(query.words) || (query.amount !== null && index.amounts[i]!.includes(query.amount)))) continue;
    out.push(t);
  }
  return out;
}

/** The jobs `include` keeps, in group order and then by name, each with the name of its group. */
export function jobsInGroupOrder(facts: Pick<Facts, "jobs" | "groups">, include: (job: Job) => boolean): PickableJob[] {
  const picked: { readonly job: PickableJob; readonly order: number }[] = [];
  for (const job of facts.jobs.values()) {
    if (!include(job)) continue;
    const group = facts.groups.get(job.groupId);
    picked.push({ job: { id: job.id, name: job.name, groupName: group?.name ?? "" }, order: group?.order ?? Number.MAX_SAFE_INTEGER });
  }
  return picked.sort((a, b) => a.order - b.order || a.job.groupName.localeCompare(b.job.groupName) || a.job.name.localeCompare(b.job.name)).map((entry) => entry.job);
}
