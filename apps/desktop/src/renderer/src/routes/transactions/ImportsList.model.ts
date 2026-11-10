import { type AccountId, type Facts, type ImportBatchId, type LocalDate, daysBetween } from "@holt/core";
import { localDateOf } from "../../data/replica.ts";
import { bankWords } from "./ImportPreview.model.ts";
import type { Words } from "./ImportSay.ts";

export interface ImportRowView {
  readonly batchId: ImportBatchId;
  readonly fileName: string;
  readonly bank: Words;
  /** The accounts the file had rows for, by name. */
  readonly accounts: readonly string[];
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly created: number;
  readonly matched: number;
  readonly pending: number;
  /** Transactions this import brought that still wait for a job. Null for an undone import, which brought none. */
  readonly needsYou: number | null;
  readonly importedOn: LocalDate;
  /** "3 days ago". */
  readonly when: Words;
  readonly undone: boolean;
}

const farBack = 30;

export function whenWords(importedAt: string, today: LocalDate): { readonly on: LocalDate; readonly words: Words } {
  const on = localDateOf(new Date(importedAt));
  const days = Math.max(0, daysBetween(on, today));
  return { on, words: days > farBack ? { id: "import.list.on", values: { day: { fullDay: on } } } : { id: "import.list.ago", values: { days } } };
}

/** Newest first. One pass over the import rows, however many files there are. */
export function importRows(facts: Facts, today: LocalDate): ImportRowView[] {
  const accountsOf = new Map<ImportBatchId, Set<AccountId>>();
  const waiting = new Map<ImportBatchId, number>();
  for (const row of facts.importRows.values()) {
    const accounts = accountsOf.get(row.batchId) ?? new Set<AccountId>();
    accounts.add(row.accountId);
    accountsOf.set(row.batchId, accounts);
    // A transaction an import creates takes the ID of the row that creates it (decision 0047), so the rows say which are theirs.
    const { backs } = row;
    if (backs !== null && (backs as string) === (row.id as string) && facts.transactions.get(backs)?.treatment.kind === "needsYou") {
      waiting.set(row.batchId, (waiting.get(row.batchId) ?? 0) + 1);
    }
  }
  return [...facts.importBatches.values()]
    .sort((a, b) => (a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : a.id < b.id ? -1 : 1))
    .map((batch) => {
      const when = whenWords(batch.importedAt, today);
      return {
        batchId: batch.id,
        fileName: batch.fileName,
        bank: bankWords(batch.format),
        accounts: [...(accountsOf.get(batch.id) ?? [])].map((id) => facts.accounts.get(id)?.name ?? "").sort((a, b) => a.localeCompare(b)),
        from: batch.from,
        to: batch.to,
        created: batch.created,
        matched: batch.matched,
        pending: batch.pending,
        needsYou: batch.undone ? null : (waiting.get(batch.id) ?? 0),
        importedOn: when.on,
        when: when.words,
        undone: batch.undone,
      };
    });
}
