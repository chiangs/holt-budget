/**
 * Measures `computeFigures` (domain model, "Facts and figures"). Run with
 * `node packages/core/src/testing/measure-figures.ts [runs] [year | family-50 | family-all]`, all three when
 * the last is left out. Two kinds of facts:
 *
 * - the synthetic year of Milestone 2, timing each method of estimating separately;
 * - the family's volume (about 8,500 transactions), once with about 50 of them waiting in needs you and
 *   once with all of them waiting, which is where a first import leaves the household.
 *
 * Each is timed after a warm-up, twice: a pass that reads nothing but the plan, and a pass that also reads
 * `needsYou` and `importStatus`, as the page does. It prints the median and range of the runs together
 * with checksums that prove each run did the whole computation. Named alone, a family scenario also times
 * the first passes of a fresh process, which run before V8 has optimised the code.
 */

import { estimate } from "../estimate.ts";
import { type EstimateFunction, type Figures, computeFigures } from "../figures/index.ts";
import { localDate } from "../dates.ts";
import { averageEstimate } from "./estimates.ts";
import { familyVolume } from "./family-volume.ts";
import { syntheticYear } from "./synthetic-year.ts";

// Core is typed without Node, so this script names the three host globals it uses here, not in core.
declare const performance: { now(): number };
declare const process: { readonly argv: readonly string[] };
declare const console: { log(text: string): void };

const runs = Number(process.argv[2] ?? 50);
const only = process.argv[3];
const warmUp = 10;

const built = performance.now();
const { facts, asOf } = syntheticYear();
const buildMs = performance.now() - built;

/** What the page reads of a pass beyond the plan. Returns a number so the reads cannot be skipped. */
function readLazily(figures: Figures): number {
  return figures.needsYou.length + figures.importStatus.due + figures.importStatus.accounts.size;
}

function checksum(estimateWith: EstimateFunction): number {
  const figures = computeFigures(facts, asOf, { estimate: estimateWith });
  let sum = 0;
  for (const m of figures.months.values()) {
    sum += m.available + m.assigned;
    for (const j of m.jobs.values()) sum += j.spent + j.assigned.amount;
  }
  for (const a of figures.accounts.values()) sum += a.balance.amount + a.bucketed;
  return sum + readLazily(figures);
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function describeRuns(times: number[]): string {
  const sorted = [...times].sort((a, b) => a - b);
  return `median ${median(times).toFixed(2)} ms, range ${sorted[0]?.toFixed(2)} to ${sorted.at(-1)?.toFixed(2)} ms over ${times.length} runs`;
}

function measure(name: string, estimateWith: EstimateFunction): void {
  let estimates = 0;
  const counting: EstimateFunction = (input) => {
    estimates += 1;
    return estimateWith(input);
  };
  for (let i = 0; i < warmUp; i++) readLazily(computeFigures(facts, asOf, { estimate: estimateWith }));
  const times: number[] = [];
  const reading: number[] = [];
  let months = 0;
  for (let i = 0; i < runs; i++) {
    let start = performance.now();
    const figures = computeFigures(facts, asOf, { estimate: i === 0 ? counting : estimateWith });
    times.push(performance.now() - start);
    months += figures.months.size;
    start = performance.now();
    const read = computeFigures(facts, asOf, { estimate: estimateWith });
    readLazily(read);
    reading.push(performance.now() - start);
  }
  console.log(
    `${name}: ${describeRuns(reading)} when the page also reads needs you and import status; ${describeRuns(times)} when it does not ` +
      `(${months / runs} months, ${estimates} estimates per run, checksum ${checksum(estimateWith)})`,
  );
}

const today = localDate("2026-06-15");

function measureFamily(name: string, waitingEvery: number, fresh: boolean): void {
  const { facts: family, waiting } = familyVolume(waitingEvery);
  const times: number[] = [];
  const reading: number[] = [];
  const firstPasses: number[] = [];
  let read = 0;
  for (let i = 0; i < 9; i++) {
    const start = performance.now();
    read = readLazily(computeFigures(family, today));
    firstPasses.push(performance.now() - start);
  }
  for (let i = 0; i < warmUp; i++) readLazily(computeFigures(family, today));
  for (let i = 0; i < runs; i++) {
    let start = performance.now();
    computeFigures(family, today);
    times.push(performance.now() - start);
    start = performance.now();
    const items = readLazily(computeFigures(family, today));
    reading.push(performance.now() - start);
    if (items !== read) throw new Error(`Passes disagree: ${items} and ${read}`);
  }
  console.log(
    `${name}: ${family.transactions.size} transactions, ${waiting.length} waiting, ${family.importRows.size} import rows: ${describeRuns(reading)} reading needs you and import status; ` +
      `${describeRuns(times)} not reading them` +
      (fresh ? `; passes 2 to 9 of a fresh process, median ${median(firstPasses.slice(1)).toFixed(2)} ms (first pass ${firstPasses[0]?.toFixed(2)} ms)` : "") +
      `; checksum ${read}`,
  );
}

if (only === undefined || only === "year") {
  console.log(`Synthetic year: ${facts.transactions.size} transactions, ${facts.jobs.size} jobs, ${facts.accounts.size} accounts, built in ${buildMs.toFixed(1)} ms`);
  measure("Stand-in average estimate", averageEstimate);
  measure("estimate.ts", estimate);
}
if (only === undefined || only === "family-50") measureFamily("Family volume, about 50 waiting", 170, only === "family-50");
if (only === undefined || only === "family-all") measureFamily("Family volume, all waiting", 1, only === "family-all");
