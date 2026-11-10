/**
 * Measurements, not checks: what the page pays at the family's volume (about 18,000 rows: 8,556 transactions and
 * an import row for nearly each). Run with `HOLT_BENCH=1 pnpm exec vitest run <this file>`. The snapshot reaches
 * the page by IPC, which structured-clones it, so `structuredClone` stands in for that cost here.
 */

import { type FamilyCommand, type RowChange, apply, computeFigures, localDate, money, tableNames, tablesOf, transactionId } from "@holt/core";
import { describe, it } from "vitest";
import type { Reply } from "./bridge.ts";
import { createReplica } from "./replica.ts";
import { familyFacts } from "./bench-facts.ts";
import { fakeEnvironment, testId } from "./test-support.ts";
import type { RunResult, SnapshotResult } from "../../../shared/ledger-types.ts";

/** The screen reads the sidebar badge and the tab counts, which are lazy figures, so a timed pass must read them. */
function figuresTheScreenReads(facts: Parameters<typeof computeFigures>[0], today: Parameters<typeof computeFigures>[1]) {
  const figures = computeFigures(facts, today);
  void figures.needsYou.length;
  void figures.importStatus;
  return figures;
}

const enabled = process.env.HOLT_BENCH === "1";

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const ms = (n: number): string => `${n.toFixed(2)} ms`;
const spread = (xs: number[]): string => `median ${ms(median(xs))}, range ${ms(Math.min(...xs))} to ${ms(Math.max(...xs))}, ${xs.length} runs`;

function time<T>(work: () => T): [T, number] {
  const start = performance.now();
  const result = work();
  return [result, performance.now() - start];
}

/** 170 means about 50 transactions wait, as for a household that keeps up. 1 means nearly all wait, the worst case. */
describe.skipIf(!enabled).each([{ waitingEvery: 170 }, { waitingEvery: 1 }])("the page at 18,000 rows, a transaction waiting every $waitingEvery", ({ waitingEvery }) => {
  it("snapshot, figures and one change", async () => {
    const facts = familyFacts(waitingEvery);
    const [tables, tablesMs] = time(() => tablesOf(facts));
    const rows = tableNames.reduce((n, t) => n + facts[t].size, 0);
    const today = localDate("2026-06-15");
    const head = { undo: null, redo: null };
    const report: Record<string, string> = { rows: String(rows), transactions: String(facts.transactions.size), waiting: String(computeFigures(facts, today).needsYou.length), "main builds the tables, first (cold)": ms(tablesMs) };
    report["main builds the tables, then"] = spread(Array.from({ length: 7 }, () => time(() => tablesOf(facts))[1]));

    const wire = JSON.stringify(tables);
    report["snapshot as JSON"] = `${(wire.length / 1e6).toFixed(1)} MB`;
    report["structured clone (IPC stand-in)"] = spread(Array.from({ length: 7 }, () => time(() => structuredClone({ revision: 0, today, tables, head }))[1]));

    const cloned = structuredClone({ revision: 0, today, tables, head });
    const answer: Reply<SnapshotResult> = { ok: true, value: { kind: "ready", snapshot: cloned } };
    const replica = createReplica({ snapshot: async () => answer }, fakeEnvironment(new Date(2026, 5, 15, 12)));
    const applyRuns: number[] = [];
    for (let run = 0; run < 8; run += 1) {
      const start = performance.now();
      await replica.resync();
      applyRuns.push(performance.now() - start);
    }
    report["apply a snapshot, first (cold)"] = ms(applyRuns[0]!);
    report["apply a snapshot, then"] = spread(applyRuns.slice(1));

    const rawMaps = Array.from({ length: 7 }, () => time(() => tableNames.map((name) => new Map((tables[name] as readonly object[]).map((row, i) => [i, row]))))[1]);
    report["floor: build one Map per table from the same arrays"] = spread(rawMaps);

    const view = replica.get()!;
    const figureRuns = Array.from({ length: 9 }, () => time(() => figuresTheScreenReads(view.facts, today))[1]);
    report["computeFigures, first (cold)"] = ms(figureRuns[0]!);
    report["computeFigures, then"] = spread(figureRuns.slice(1));

    const [, firstJob] = view.facts.jobs.keys();
    const command: FamilyCommand = { kind: "setTreatment", transactionId: transactionId(testId(1_000_000)), treatment: { kind: "split", allocations: [{ jobId: firstJob!, amount: money(-100) }] } };
    const dry = apply(view.facts, command, { asOf: today });
    if (!dry.ok) throw new Error(`The change was refused: ${dry.refusal.message}`);
    const touched = new Set(dry.patch.map((change) => change.table));
    report["the change touches"] = [...touched].join(", ");
    const patchRuns: number[] = [];
    for (let run = 0; run < 9; run += 1) {
      const fresh = createReplica({ snapshot: async () => answer }, fakeEnvironment(new Date(2026, 5, 15, 12)));
      await fresh.resync();
      const result: RunResult = { status: "applied", base: 0, revision: 1, today, patch: dry.patch as readonly RowChange[], change: { id: "c" as never, at: "2026-06-15T09:00:00.000Z", kind: "addGroup", by: { kind: "family" } }, head };
      const start = performance.now();
      await fresh.accept(result);
      patchRuns.push(performance.now() - start);
    }
    report["accept one change (patch the copy)"] = spread(patchRuns.slice(1));
    const afterChange = apply(view.facts, command, { asOf: today });
    if (afterChange.ok) report["computeFigures after that change"] = spread(Array.from({ length: 9 }, () => time(() => figuresTheScreenReads(afterChange.facts, today))[1]).slice(1));

    console.log(JSON.stringify(report, null, 2));
  }, 120_000);
});
