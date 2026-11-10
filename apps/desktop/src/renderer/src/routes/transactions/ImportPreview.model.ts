import type { AccountId, Facts, ImportCounts, ImportPreview, LeftOutAccount, LocalDate, Money, NewTransactionLine } from "@holt/core";
import type { Words } from "./ImportSay.ts";
import type { PickableJob } from "./jobs.ts";
import { type JobCell, type WhyContext, jobCell, whyWords } from "./ImportWhy.model.ts";

export interface Chip {
  readonly key: "rows" | "created" | "matched" | "needsYou" | "pending" | "transfers" | "moves";
  readonly words: Words;
  /** Needs you is the one count that asks something of the family, so it stands out (by weight and an icon as well as colour). */
  readonly tone: "plain" | "attention";
}

/** The counts the mockup shows, and the ones it doesn't when they are zero, so a chip is never "0 transfers paired". */
export function chipsOf(counts: ImportCounts, completedMoves: number): Chip[] {
  const chips: Chip[] = [
    { key: "rows", words: { id: "import.chip.rows", values: { count: counts.rows } }, tone: "plain" },
    { key: "created", words: { id: "import.chip.created", values: { count: counts.created } }, tone: "plain" },
    { key: "matched", words: { id: "import.chip.matched", values: { count: counts.matched } }, tone: "plain" },
    { key: "needsYou", words: { id: "import.chip.needsYou", values: { count: counts.needsYou } }, tone: counts.needsYou > 0 ? "attention" : "plain" },
  ];
  if (counts.pending > 0) chips.push({ key: "pending", words: { id: "import.chip.pending", values: { count: counts.pending } }, tone: "plain" });
  if (counts.transfers > 0) chips.push({ key: "transfers", words: { id: "import.chip.transfers", values: { count: counts.transfers } }, tone: "plain" });
  if (completedMoves > 0) chips.push({ key: "moves", words: { id: "import.chip.moves", values: { count: completedMoves } }, tone: "plain" });
  return chips;
}

/** An 11-digit account number the way Norwegian banks write it: 9710.11.10003. */
export function dottedAccountNumber(digits: string): string {
  return /^\d{11}$/.test(digits) ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}` : digits;
}

/** Rows of accounts the household doesn't have: left out, so the family can add the account and import the file again. */
export function leftOutNotice(preview: ImportPreview): { readonly words: Words; readonly accounts: readonly LeftOutAccount[] } | null {
  if (preview.leftOut.length === 0) return null;
  return { words: { id: "import.notice.leftOut", values: { rows: preview.counts.leftOut, accounts: preview.leftOut.length } }, accounts: preview.leftOut };
}

export function nearMatchNotice(preview: ImportPreview): Words | null {
  return preview.nearMatches.length === 0 ? null : { id: "import.notice.nearMatches", values: { count: preview.nearMatches.length } };
}

/**
 * The rows keep the places they first had, so the row you just changed stays where you were looking and keeps the focus.
 * Rows that were not shown before come after, in the plan's order.
 */
export function stableOrder(previous: readonly number[], sample: readonly NewTransactionLine[]): number[] {
  const present = new Set(sample.map((line) => line.line));
  const kept = previous.filter((line) => present.has(line));
  const known = new Set(kept);
  return [...kept, ...sample.filter((line) => !known.has(line.line)).map((line) => line.line)];
}

export interface RowView {
  readonly line: number;
  readonly accountId: AccountId;
  readonly date: LocalDate;
  readonly description: string;
  readonly amount: Money;
  readonly job: JobCell;
  readonly why: Words;
  /** Waiting for a job, so the row is marked and asks for one. */
  readonly needsYou: boolean;
}

export function rowViews(order: readonly number[], sample: readonly NewTransactionLine[], context: WhyContext): RowView[] {
  const byLine = new Map(sample.map((line) => [line.line, line]));
  return order.flatMap((lineNumber) => {
    const line = byLine.get(lineNumber);
    if (line === undefined) return [];
    return [
      {
        line: line.line,
        accountId: line.accountId,
        date: line.bookingDate,
        description: line.description,
        amount: line.amount,
        job: jobCell(line.treatment, context),
        why: whyWords(line, context),
        needsYou: line.treatment.kind === "needsYou",
      },
    ];
  });
}

/** "Showing 8 of 21 new rows. The app suggested the jobs. Change any of them now or later." */
export function shownWords(preview: ImportPreview, suggest: boolean): Words {
  const total = preview.counts.created;
  const shown = preview.sample.length;
  return { id: "import.shown", values: { all: shown >= total ? "true" : "false", shown, total, suggest: suggest ? "true" : "false" } };
}

export function addWords(preview: ImportPreview): Words {
  return { id: "import.add", values: { count: preview.counts.created } };
}

const bankKeys: Readonly<Record<string, string>> = { "bulder-csv": "bulderCsv", "sparebank1-csv": "sparebank1Csv", ofx: "ofx" };

/** The bank behind a format profile such as "sparebank1-csv", in words. */
export function bankWords(format: string): Words {
  return { id: "import.bank", values: { format: bankKeys[format] ?? "other" } };
}

export function readAsWords(format: string): Words {
  return { id: "import.readAs", values: { format: bankKeys[format] ?? "other" } };
}

/** The jobs a family can put a transaction on: every job that isn't archived, in the order Plan lists its groups. */
export function pickableJobs(facts: Facts): PickableJob[] {
  const groups = facts.groups;
  return [...facts.jobs.values()]
    .filter((job) => job.status !== "archived")
    .sort((a, b) => (groups.get(a.groupId)?.order ?? 0) - (groups.get(b.groupId)?.order ?? 0) || a.name.localeCompare(b.name))
    .map((job) => ({ id: job.id, name: job.name, groupName: groups.get(job.groupId)?.name ?? "" }));
}
