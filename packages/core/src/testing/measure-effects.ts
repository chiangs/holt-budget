/**
 * Measures what the Plan screen asks of core on every change of an amount (decision 0048): the effects of a
 * command, the options for where a new job's money could come from, the moves at the bank and the savings rate.
 * Run with `node packages/core/src/testing/measure-effects.ts [runs]` on the family's volume (about 8,500
 * transactions, 40 jobs, 6 accounts). It prints the median, the 95th percentile and the range after a warm-up.
 * The effects of a command must stay under 15 ms: two passes over the figures and one `apply`.
 */

import { type Command, apply } from "../commands/apply.ts";
import { localDate, month } from "../dates.ts";
import { previewEffects } from "../effects.ts";
import { computeFigures } from "../figures/index.ts";
import { movesPlan } from "../figures/moves-plan.ts";
import { savingsRate } from "../figures/savings-rate.ts";
import { fundingOptions } from "../funding.ts";
import { money } from "../money.ts";
import { familyVolume } from "./family-volume.ts";

// Core is typed without Node, so this script names the three host globals it uses here, not in core.
declare const performance: { now(): number };
declare const process: { readonly argv: readonly string[] };
declare const console: { log(text: string): void };

const runs = Number(process.argv[2] ?? 200);
const warmUp = 20;
const asOf = localDate("2026-07-15");
const july = month("2026-07");
const { facts } = familyVolume(170);
const [, first, second, third] = [...facts.jobs.keys()];
if (first === undefined || second === undefined || third === undefined) throw new Error("The family's volume has no jobs");

const change: Command = {
  kind: "batch",
  commands: [
    { kind: "moveAssignment", month: july, from: first, to: second, amount: money(10_000) },
    { kind: "assign", month: july, jobId: third, amount: money(1_234_500) },
  ],
};

function describeRuns(name: string, work: () => unknown): string {
  for (let i = 0; i < warmUp; i += 1) work();
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    work();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const at = (share: number) => (times[Math.min(times.length - 1, Math.floor(times.length * share))] ?? 0).toFixed(2);
  return `${name.padEnd(36)} median ${at(0.5)} ms, 95th ${at(0.95)} ms, range ${at(0)} to ${(times.at(-1) ?? 0).toFixed(2)} ms over ${runs} runs`;
}

const preview = previewEffects(facts, change, { asOf });
if (!preview.ok) throw new Error(`The measured change was refused: ${preview.refusal.message}`);
console.log(`The change moves ${preview.effects.jobs.length} jobs and gives a savings rate of ${preview.effects.savingsRate.after ?? "none"} tenths of a percent.`);
console.log(describeRuns("previewEffects (a batch of two)", () => previewEffects(facts, change, { asOf })));
console.log(describeRuns("  apply alone", () => apply(facts, change, { asOf })));
console.log(describeRuns("  computeFigures, current month only", () => computeFigures(facts, asOf, { horizonMonths: 0 })));
console.log(describeRuns("fundingOptions", () => fundingOptions(facts, { month: july, amount: money(500_000) }, asOf)));
console.log(describeRuns("movesPlan", () => movesPlan(facts, july, asOf)));
console.log(describeRuns("savingsRate", () => savingsRate(facts, asOf)));
