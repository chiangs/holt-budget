/**
 * Measures the family's first import at the real size (about 9,000 rows, 1,700 transfer pairs) through
 * every step that has to finish in seconds: plan, core apply, the store's `run`, reopening the store, undo
 * and redo. Run with `pnpm bench:import`; `HOLT_BENCH_RUNS`, `HOLT_BENCH_ROWS` and `HOLT_BENCH_PAIRS` change
 * the size. Each run uses a fresh encrypted database. /tmp is usually RAM, where fsync costs nothing, so set
 * `HOLT_BENCH_DIR` to a folder on the real disk. Every step is checked, so a number never stands for work
 * that did not happen: a step that fails is reported with its error, and the steps that need it are skipped.
 */

import { cpus, loadavg } from "node:os";
import { type Command, type Facts, type ImportPlan, apply, commit, emptyChangeLog, localDate, planImport, tableNames } from "@holt/core";
import { describe, it } from "vitest";
import { bulderLikeSize, firstImport } from "../../../../../packages/core/src/testing/first-import.ts";
import { createFactsStore, openFactsStore } from "./index.ts";
import { differences, storeDeps, testDatabase } from "./test-support.ts";

const enabled = process.env.HOLT_BENCH === "1";
const runs = Number(process.env.HOLT_BENCH_RUNS ?? 5);
const rows = Number(process.env.HOLT_BENCH_ROWS ?? bulderLikeSize.rows);
const pairs = Number(process.env.HOLT_BENCH_PAIRS ?? bulderLikeSize.pairs);
const parent = process.env.HOLT_BENCH_DIR;
const asOf = localDate("2026-11-09");

const ms = (n: number): string => `${n.toFixed(0)} ms`;
const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;
const summary = (xs: readonly number[]): string => (xs.length === 0 ? "no runs" : `${ms(median(xs))} (range ${ms(Math.min(...xs))} to ${ms(Math.max(...xs))}, cold ${ms(xs[0] ?? 0)}, ${xs.length} runs)`);
const rowCount = (facts: Facts): number => tableNames.reduce((n, table) => n + facts[table].size, 0);

function timed<T>(fn: () => T): [T, number] {
  const began = performance.now();
  const result = fn();
  return [result, performance.now() - began];
}

describe.skipIf(!enabled)("the first import at the real size", () => {
  it("plans, commits, reopens, undoes and redoes", () => {
    const samples: Record<string, number[]> = {};
    const failures = new Map<string, string>();
    let checked = false;
    const sizes: Record<string, number | string> = {};
    const note = (step: string, took: number): void => {
      (samples[step] ??= []).push(took);
    };
    const failed = (step: string, error: unknown): void => {
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      failures.set(step, text.length > 300 ? `${text.slice(0, 300)}...` : text);
    };

    const scenario = firstImport({ rows, pairs, repeatGroups: bulderLikeSize.repeatGroups });
    const { facts, file } = scenario;
    sizes["file rows"] = file.rows.length;
    sizes.accounts = facts.accounts.size;

    for (let run = 0; run < runs; run += 1) {
      let plan: ImportPlan | null = null;
      try {
        let took: number;
        [plan, took] = timed(() => planImport(facts, file, scenario.input()));
        note("planImport", took);
        if (!plan.ok) throw new Error(`blocked: ${plan.blocked.kind}`);
      } catch (error) {
        failed("planImport", error);
        plan = null;
      }
      if (plan === null || !plan.ok) continue;
      const command: Command = plan.command;
      if (run === 0) {
        sizes["transfers paired"] = plan.preview.transfers.length;
        sizes["commands in the batch"] = plan.command.commands.length;
        sizes["new transactions"] = plan.preview.counts.created;
      }

      let expected: Facts | null = null;
      try {
        const [applied, took] = timed(() => apply(facts, command, { asOf }));
        note("core apply", took);
        if (!applied.ok) throw new Error(`refused: ${applied.refusal.code}`);
        expected = applied.facts;
        if (run === 0) {
          sizes["rows the change writes"] = applied.patch.length;
          const sides = [...applied.facts.transactions.values()].filter((t) => t.treatment.kind === "transfer" && t.treatment.partner !== null).length;
          sizes["transactions paired in the facts"] = sides;
          if (sides !== 2 * plan.preview.transfers.length) throw new Error(`${sides} paired transactions for ${plan.preview.transfers.length} pairs`);
        }
      } catch (error) {
        failed("core apply", error);
      }

      try {
        const meta = { id: "00000000-0000-7000-8000-00000000f001" as never, at: "2026-11-09T10:00:00.000Z", by: { kind: "family" as const } };
        const [committed, took] = timed(() => commit(facts, emptyChangeLog(), command, meta, { asOf }));
        note("core commit", took);
        if (!committed.ok) throw new Error(`refused: ${committed.refusal.code}`);
      } catch (error) {
        failed("core commit", error);
      }

      const database = testDatabase(parent === undefined ? {} : { parent });
      try {
        const store = createFactsStore(database.db, facts, storeDeps());
        const [result, runMs] = timed(() => store.run(command));
        note("store run (commit, check readable, write)", runMs);
        if (result.status !== "applied") throw new Error(`not applied: ${result.status}`);
        if (expected !== null && differences(store.facts(), expected).length > 0) throw new Error("the store's facts differ from core's");
        if (run === 0) {
          const record = database.db.prepare("select length(command) as command, length(patch) as patch from changes").get() as { command: number; patch: number };
          sizes["stored record: command"] = `${(record.command / 1e6).toFixed(2)} MB`;
          sizes["stored record: patch"] = `${(record.patch / 1e6).toFixed(2)} MB`;
          sizes["rows the import adds"] = rowCount(store.facts()) - rowCount(facts);
        }

        const reopened = database.reopen();
        const [again, reopenMs] = timed(() => openFactsStore(reopened, storeDeps()));
        note("reopen the store", reopenMs);
        if (again === null) throw new Error("no household after reopening");
        if (expected !== null && differences(again.facts(), expected).length > 0) throw new Error("the reopened facts differ from the facts before");

        const [undone, undoMs] = timed(() => again.step("undo"));
        note("undo the import", undoMs);
        if (undone.status !== "applied") throw new Error(`undo: ${undone.status}`);
        if (differences(again.facts(), facts).length > 0) throw new Error("undo did not restore the facts exactly");
        const [redone, redoMs] = timed(() => again.step("redo"));
        note("redo the import", redoMs);
        if (redone.status !== "applied") throw new Error(`redo: ${redone.status}`);
        if (expected !== null && differences(again.facts(), expected).length > 0) throw new Error("redo did not restore the import");
        checked = true;
      } catch (error) {
        failed(`store (run ${run + 1})`, error);
      } finally {
        database.dispose();
      }
    }

    const [one, five, fifteen] = loadavg();
    const lines = [
      `Machine: ${cpus().length} cores, load average ${one?.toFixed(2)} ${five?.toFixed(2)} ${fifteen?.toFixed(2)} (1, 5, 15 min), node ${process.version}, data in ${parent ?? "the OS temp folder (often RAM)"}`,
      `Scenario: ${JSON.stringify(sizes)}`,
      `Peak memory of this process: ${(process.resourceUsage().maxRSS / 1e3).toFixed(0)} MB resident`,
      ...Object.entries(samples).map(([step, xs]) => `${step.padEnd(46)} ${summary(xs)}`),
      ...[...failures].map(([step, text]) => `FAILED ${step}: ${text}`),
      ...(checked ? ["Checked: store facts equal core's; the reopened facts equal the facts before; undo restores the starting facts exactly; redo restores the import"] : []),
    ];
    console.log(`\n${lines.join("\n")}\n`);
    if (failures.size > 0) throw new Error(`${failures.size} step(s) failed`);
  }, 900_000);
});
