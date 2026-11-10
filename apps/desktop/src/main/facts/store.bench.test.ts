/**
 * Measurements, not checks: boot time, commit time and snapshot size at the family's volume (17,000 rows).
 * Run with `HOLT_BENCH=1 HOLT_BENCH_DIR=<a folder on the real disk> pnpm exec vitest run <this file>`. /tmp is
 * usually RAM, where fsync costs nothing, so the commit numbers mean something only on a real disk.
 */

import {
  type Command,
  type Facts,
  type ImportBatch,
  type ImportRow,
  type Tables,
  type Transaction,
  StoredChangeSchema,
  commit,
  emptyChangeLog,
  factsOf,
  importBatchId,
  importRowId,
  localDate,
  money,
  tableNames,
  transactionId,
} from "@holt/core";
import { describe, it } from "vitest";
import { openDatabase } from "../storage/database.ts";
import { migrate } from "../storage/migrations.ts";
import { parseRow } from "./columns.ts";
import { importOf } from "./crash-fixtures.ts";
import { createFactsStore, openFactsStore } from "./index.ts";
import { prepareStatements } from "./store.ts";
import { factsBuilder, kr, storeDeps, testDatabase, testId } from "./test-support.ts";

const enabled = process.env.HOLT_BENCH === "1";
const parent = process.env.HOLT_BENCH_DIR;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const percentile = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const ms = (n: number): string => `${n.toFixed(1)} ms`;
async function time<T>(fn: () => T): Promise<[T, number]> {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
}

/** About three years of one household: 8,556 transactions and one import row each (or 8,500 of them), 40 jobs, 33 months of assignments. */
function familyFacts(): Facts {
  const b = factsBuilder({ planStart: "2024-01" });
  const accounts = Array.from({ length: 6 }, (_, i) => b.account({ name: `Account ${i + 1}`, openingBalance: kr(10_000), openingDate: "2023-12-31" }));
  b.group();
  const jobs = [b.buffer({ monthly: kr(1_000) })];
  for (let i = 1; i < 40; i += 1) jobs.push(b.spendJob({ plan: { mode: "setAmount", amount: kr(100 * i) }, accountId: accounts[i % 6]!, name: `Spending job number ${i}` }));
  for (let m = 0; m < 33; m += 1) {
    const month = `${2024 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
    b.budgetMonth(month, m < 30 ? "closed" : "open");
    for (const job of jobs) b.assign(month, job, kr(300));
  }
  const base = b.facts();
  const transactions = new Map(base.transactions);
  const importRows = new Map<ImportRow["id"], ImportRow>();
  const importBatches = new Map<ImportBatch["id"], ImportBatch>();
  for (let batchN = 0; batchN < 40; batchN += 1) {
    const batch: ImportBatch = {
      id: importBatchId(testId(2_000_000 + batchN)),
      fileName: `bank-export-${batchN + 1}.csv`,
      fingerprint: batchN.toString(16).padStart(64, "0"),
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
  for (let i = 0; i < 8_556; i += 1) {
    const account = accounts[i % 6]!;
    const day = (i % 28) + 1;
    const mm = (i % 30) + 1;
    const booking = localDate(`${2024 + Math.floor((mm - 1) / 12)}-${String(((mm - 1) % 12) + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
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
      treatment: i % 7 === 0 ? { kind: "history", jobId: job } : { kind: "needsYou" },
    };
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
  return { ...base, transactions, importRows, importBatches };
}

describe.skipIf(!enabled)("measurements at 17,000 rows", () => {
  it("boot, commit and snapshot", async () => {
    const facts = familyFacts();
    const rows = tableNames.reduce((n, t) => n + facts[t].size, 0);
    const database = testDatabase(parent === undefined ? {} : { parent });
    const report: Record<string, string> = { rows: String(rows), folder: parent ?? "os tmpdir" };
    try {
      const [, createMs] = await time(() => createFactsStore(database.db, facts, storeDeps()));
      report["first population (insert + load)"] = ms(createMs);

      // Boot, in phases.
      const phases = { open: [] as number[], prepare: [] as number[], select: [] as number[], parse: [] as number[], assemble: [] as number[], total: [] as number[] };
      for (let run = 0; run < 7; run += 1) {
        const t0 = performance.now();
        const db = database.reopen();
        const t1 = performance.now();
        const statements = prepareStatements(db);
        const t2 = performance.now();
        const raw = tableNames.map((name) => [name, statements[name].selectAll.all() as Record<string, unknown>[]] as const);
        const t3 = performance.now();
        const parsed = raw.map(([name, list]) => [name, list.map((row) => parseRow(name, row))] as const);
        const t4 = performance.now();
        factsOf(Object.fromEntries(parsed) as unknown as Tables);
        const t5 = performance.now();
        phases.open.push(t1 - t0);
        phases.prepare.push(t2 - t1);
        phases.select.push(t3 - t2);
        phases.parse.push(t4 - t3);
        phases.assemble.push(t5 - t4);
        const [, whole] = await time(() => openFactsStore(db, storeDeps()));
        phases.total.push(whole);
      }
      for (const [name, xs] of Object.entries(phases)) report[`boot ${name} (median of 7)`] = ms(median(xs));
      report["boot first run (cold) openFactsStore"] = ms(phases.total[0]!);

      // Commit, one row, with the weaker syncs for comparison.
      const store = openFactsStore(database.reopen(), storeDeps())!;
      const some = [...store.facts().transactions.keys()];
      const runs = async (label: string, sync: string) => {
        database.db.pragma(`synchronous = ${sync}`);
        const times: number[] = [];
        for (let i = 0; i < 100; i += 1) {
          const command: Command = { kind: "setNote", transactionId: some[i * 7]!, note: `${label} ${i}` };
          const [result, t] = await time(() => store.run(command));
          if (result.status !== "applied") throw new Error("not applied");
          times.push(t);
        }
        report[`commit one row, synchronous=${sync} (median / p95)`] = `${ms(median(times))} / ${ms(percentile(times, 0.95))}`;
      };
      await runs("full", "FULL");
      await runs("normal", "NORMAL");
      await runs("off", "OFF");
      database.db.pragma("synchronous = FULL");

      // Of that, how much is core.
      const coreTimes: number[] = [];
      for (let i = 0; i < 100; i += 1) {
        const meta = { id: testId(9_000_000 + i) as never, at: "2026-06-15T09:00:00.000Z", by: { kind: "family" as const } };
        const [, t] = await time(() => commit(store.facts(), emptyChangeLog(), { kind: "setNote", transactionId: some[i * 7]!, note: `core ${i}` }, meta, { asOf: localDate("2026-06-15") }));
        coreTimes.push(t);
      }
      report["of which core apply + checkFacts (median)"] = ms(median(coreTimes));

      const [snapshot, snapshotMs] = await time(() => store.snapshot());
      report["snapshot() (tablesOf + heads)"] = ms(snapshotMs);
      const [json, jsonMs] = await time(() => JSON.stringify(snapshot));
      report["snapshot as JSON"] = `${(json.length / 1e6).toFixed(2)} MB (${ms(jsonMs)})`;
      const [, cloneMs] = await time(() => structuredClone(snapshot));
      report["structuredClone(snapshot)"] = ms(cloneMs);
      report["database file"] = `${(database.db.prepare("select page_count * page_size as bytes from pragma_page_count(), pragma_page_size()").get() as { bytes: number }).bytes / 1e6} MB`;
    } finally {
      database.dispose();
    }
    console.log(JSON.stringify(report, null, 2));
  }, 300_000);

  it("a 4,000-row import, its undo and its redo, with and without the child indexes", async () => {
    const facts = familyFacts();
    const results: Record<string, string> = {};
    for (const withIndexes of [true, false]) {
      const label = withIndexes ? "with" : "without";
      const database = testDatabase(parent === undefined ? {} : { parent });
      try {
        const store = createFactsStore(database.db, facts, storeDeps());
        if (!withIndexes) for (const index of ["import_rows_backs", "moves_completed_by", "assignments_job", "transactions_rule"]) database.db.exec(`drop index ${index}`);
        const command = importOf(store.facts(), 4_000, 7_000_000);
        const meta = { id: testId(9_999_999) as never, at: "2026-06-15T09:00:00.000Z", by: { kind: "family" as const } };
        const [committed, coreMs] = await time(() => commit(store.facts(), emptyChangeLog(), command, meta, { asOf: localDate("2026-06-15") }));
        if (!committed.ok) throw new Error("refused");
        const [readable, parseMs] = await time(() => StoredChangeSchema.safeParse(committed.record));
        const [applied, runMs] = await time(() => store.run(command));
        const [undone, undoMs] = await time(() => store.step("undo"));
        const [redone, redoMs] = await time(() => store.step("redo"));
        const bytes = (database.db.prepare("select length(command) + length(patch) as n from changes").get() as { n: number }).n;
        results[`import of 4,000 rows, ${label} child indexes`] = `run ${ms(runMs)} (core apply ${ms(coreMs)}, readability check of the whole record ${ms(parseMs)}); undo ${ms(undoMs)}; redo ${ms(redoMs)}; record ${(bytes / 1e6).toFixed(2)} MB; ${applied.status}/${undone.status}/${redone.status}/${readable.success}`;
      } finally {
        database.dispose();
      }
    }
    console.log(JSON.stringify(results, null, 2));
  }, 300_000);
});
