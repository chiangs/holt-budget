/**
 * Measures `computeFigures` on the synthetic year (domain model, "Facts and figures": Milestone 2 measures
 * it). Run with `node packages/core/src/testing/measure-figures.ts [runs]`. It times each method of
 * estimating separately, after a warm-up, and prints the median and range of the runs together with
 * checksums that prove each run did the whole computation.
 */

import { estimate } from "../estimate.ts";
import { type EstimateFunction, computeFigures } from "../figures/index.ts";
import { averageEstimate } from "./estimates.ts";
import { syntheticYear } from "./synthetic-year.ts";

// Core is typed without Node, so this script names the three host globals it uses here, not in core.
declare const performance: { now(): number };
declare const process: { readonly argv: readonly string[] };
declare const console: { log(text: string): void };

const runs = Number(process.argv[2] ?? 50);
const warmUp = 10;

const built = performance.now();
const { facts, asOf } = syntheticYear();
const buildMs = performance.now() - built;

function checksum(estimateWith: EstimateFunction): number {
  const figures = computeFigures(facts, asOf, { estimate: estimateWith });
  let sum = 0;
  for (const m of figures.months.values()) {
    sum += m.available + m.assigned;
    for (const j of m.jobs.values()) sum += j.spent + j.assigned.amount;
  }
  for (const a of figures.accounts.values()) sum += a.balance.amount + a.bucketed;
  return sum;
}

function measure(name: string, estimateWith: EstimateFunction): void {
  let estimates = 0;
  const counting: EstimateFunction = (input) => {
    estimates += 1;
    return estimateWith(input);
  };
  for (let i = 0; i < warmUp; i++) computeFigures(facts, asOf, { estimate: estimateWith });
  const times: number[] = [];
  let months = 0;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const figures = computeFigures(facts, asOf, { estimate: i === 0 ? counting : estimateWith });
    times.push(performance.now() - start);
    months += figures.months.size;
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  console.log(
    `${name}: median ${median.toFixed(2)} ms, range ${times[0]?.toFixed(2)} to ${times.at(-1)?.toFixed(2)} ms over ${runs} runs ` +
      `(${months / runs} months, ${estimates} estimates per run, checksum ${checksum(estimateWith)})`,
  );
}

console.log(`Synthetic year: ${facts.transactions.size} transactions, ${facts.jobs.size} jobs, ${facts.accounts.size} accounts, built in ${buildMs.toFixed(1)} ms`);
measure("Stand-in average estimate", averageEstimate);
measure("estimate.ts", estimate);
