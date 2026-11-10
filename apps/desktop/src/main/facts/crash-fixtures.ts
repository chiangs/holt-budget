/** The facts and commands the crash tests and the child process agree on, built from ids that never change. */

import {
  type Command,
  type Facts,
  type ImportRow,
  type Transaction,
  accountId,
  importBatchId,
  importRowId,
  localDate,
  money,
  transactionId,
} from "../../../../../packages/core/src/index.ts";
import { factsBuilder, kr, testId } from "../../../../../packages/core/src/testing/facts-builder.ts";

export const crashDay = "2026-06-15";

export function crashFacts(): Facts {
  const b = factsBuilder({ planStart: "2026-01" });
  b.account({ name: "Everyday", openingBalance: kr(10_000) });
  b.group();
  b.buffer({ monthly: kr(100) });
  return b.facts();
}

/** An import of `rows` new transactions in one change: the batch, every row and every transaction, as a bank file makes them. */
export function importOf(facts: Facts, rows: number, first = 1_000): Command {
  const account = [...facts.accounts.keys()][0] ?? accountId(testId(1));
  const day = localDate("2026-03-05");
  const batchId = importBatchId(testId(5_000_000 + first));
  const transactions: Transaction[] = [];
  const importRows: ImportRow[] = [];
  for (let i = 0; i < rows; i += 1) {
    const id = transactionId(testId(first + i));
    const amount = money(-(i + 1));
    transactions.push({ id, accountId: account, bookingDate: day, amount, description: `Row ${i + 1}`, treatment: { kind: "needsYou" } });
    importRows.push({ id: importRowId(id), batchId, line: i + 2, accountId: account, bookingDate: day, description: `Row ${i + 1}`, amount, fingerprint: `row-${i}`, pending: false, backs: id });
  }
  return {
    kind: "importFile",
    batch: { id: batchId, fileName: "sample.csv", fingerprint: first.toString(16).padStart(64, "0"), format: "bulder-csv", importedAt: `${crashDay}T09:00:00.000Z`, from: day, to: day, rows, created: rows, matched: 0, pending: 0, undone: false },
    rows: importRows,
    transactions,
  };
}

/** The writes an import makes: the batch, each row, each transaction, then the discard of undone records and the change record. */
export const writesForImport = (rows: number): number => 2 * rows + 1 + 2;

export function oneTransaction(facts: Facts, id: number): Command {
  return {
    kind: "recordTransaction",
    transaction: { id: transactionId(testId(id)), accountId: [...facts.accounts.keys()][0] ?? accountId(testId(1)), bookingDate: localDate("2026-03-06"), amount: money(-5), description: "Coffee", treatment: { kind: "needsYou" } },
  };
}
