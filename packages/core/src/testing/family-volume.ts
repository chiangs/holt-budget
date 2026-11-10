/**
 * Three years of one invented household at the family's volume, for measurements and for the speed guard:
 * 8,556 transactions and an import row for 8,500 of them, 6 accounts, 40 jobs and 33 months of assignments.
 * It matches the renderer's `bench-facts.ts`, so `pnpm bench:core` and the page's bench measure the same facts.
 */

import { localDate } from "../dates.ts";
import type { Facts, ImportBatch, ImportRow, Transaction } from "../facts.ts";
import { makeSplit } from "../facts.ts";
import { importBatchId, importRowId, transactionId } from "../ids.ts";
import { money } from "../money.ts";
import { factsBuilder, kr, setAmount, testId } from "./facts-builder.ts";

export interface FamilyVolume {
  readonly facts: Facts;
  /** The ids of the transactions that wait in needs you, in creation order. */
  readonly waiting: readonly Transaction["id"][];
}

/**
 * Every `waitingEvery`th transaction waits in needs you (1 means all of them, 170 means about 50). A seventh
 * of the rest is history and the others are split to a job.
 */
export function familyVolume(waitingEvery: number): FamilyVolume {
  const b = factsBuilder({ planStart: "2024-01" });
  const accounts = Array.from({ length: 6 }, (_, i) => b.account({ name: `Account ${i + 1}`, openingBalance: kr(10_000), openingDate: "2023-12-31" }));
  b.group();
  const jobs = [b.buffer({ monthly: kr(1_000) })];
  for (let i = 1; i < 40; i += 1) jobs.push(b.spendJob({ plan: setAmount(kr(100 * i)), accountId: accounts[i % 6]!, name: `Spending job number ${i}` }));
  for (let m = 0; m < 33; m += 1) {
    const month = `${2024 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
    b.budgetMonth(month, m < 30 ? "closed" : "open");
    for (const job of jobs) b.assign(month, job, kr(300));
  }
  const base = b.facts();
  const transactions = new Map(base.transactions);
  const importRows = new Map<ImportRow["id"], ImportRow>();
  const importBatches = new Map<ImportBatch["id"], ImportBatch>();
  for (let n = 0; n < 40; n += 1) {
    const batch: ImportBatch = {
      id: importBatchId(testId(2_000_000 + n)),
      fileName: `bank-export-${n + 1}.csv`,
      fingerprint: n.toString(16).padStart(64, "0"),
      format: "bulder-csv",
      importedAt: "2026-06-15T09:00:00.000Z",
      from: localDate("2024-01-01"),
      to: localDate("2026-06-01"),
      rows: 213,
      created: 213,
      matched: 0,
      pending: 0,
      undone: false,
    };
    importBatches.set(batch.id, batch);
  }
  const batches = [...importBatches.keys()];
  const waiting: Transaction["id"][] = [];
  for (let i = 0; i < 8_556; i += 1) {
    const account = accounts[i % 6]!;
    const mm = (i % 30) + 1;
    const booking = localDate(`${2024 + Math.floor((mm - 1) / 12)}-${String(((mm - 1) % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`);
    const amount = money(-((i * 37) % 90_000) - 100);
    const id = transactionId(testId(1_000_000 + i));
    const job = jobs[1 + (i % 39)]!;
    const row: Transaction = {
      id,
      accountId: account,
      bookingDate: booking,
      amount,
      description: `Card purchase ${i} SHOP NAME OSLO NOR`,
      counterparty: `Shop ${i % 300}`,
      treatment: i % waitingEvery === 0 ? { kind: "needsYou" } : i % 7 === 0 ? { kind: "history", jobId: job } : makeSplit(amount, [{ jobId: job, amount }]),
    };
    if (row.treatment.kind === "needsYou") waiting.push(id);
    transactions.set(id, row);
    if (i < 8_500) {
      const rowId = importRowId(testId(3_000_000 + i));
      importRows.set(rowId, {
        id: rowId,
        batchId: batches[i % 40]!,
        line: i + 2,
        accountId: account,
        bookingDate: booking,
        description: row.description,
        amount,
        counterpartName: row.counterparty!,
        reference: String(1_000_000 + i),
        bankType: "Kortkjøp",
        original: { text: `${i};${booking};${row.description};${amount}`, currency: "NOK" },
        fingerprint: `${i}`.padStart(40, "f"),
        pending: false,
        backs: id,
      });
    }
  }
  return { facts: { ...base, transactions, importRows, importBatches }, waiting };
}
