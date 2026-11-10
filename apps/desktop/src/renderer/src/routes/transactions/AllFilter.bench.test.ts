/**
 * Measurements, not checks: what the All tab pays at the family's volume (8,556 transactions). Run with
 * `HOLT_BENCH=1 pnpm exec vitest run <this file>`. The index is built once for each state of the facts and each
 * keystroke after it only filters, so the two are measured apart.
 */

import { describe, it } from "vitest";
import { familyFacts } from "../../data/bench-facts.ts";
import { type AllFilter, buildBrowseIndex, everything, filterIndex } from "./AllFilter.model.ts";
import { maxRendered, visibleRange } from "./AllWindow.model.ts";

const enabled = process.env.HOLT_BENCH === "1";

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const ms = (n: number): string => `${n.toFixed(3)} ms`;

function time<T>(work: () => T): [T, number] {
  const start = performance.now();
  const result = work();
  return [result, performance.now() - start];
}

describe.skipIf(!enabled)("the All tab at 8,556 transactions", () => {
  it("builds the index once and filters in a fraction of a frame", () => {
    const facts = familyFacts(170);
    const transactions = [...facts.transactions.values()];
    const report: Record<string, string> = { transactions: String(transactions.length) };

    const [index, cold] = time(() => buildBrowseIndex(transactions, 2));
    report["index, first (cold)"] = ms(cold);
    report["index, then (median of 15)"] = ms(median(Array.from({ length: 15 }, () => time(() => buildBrowseIndex(transactions, 2))[1])));

    const filters: Record<string, AllFilter> = {
      "no filter (same list returned)": everything,
      "search a name ('shop 12')": { ...everything, search: "shop 12" },
      "search an amount ('1 390')": { ...everything, search: "1 390" },
      "search that matches nothing": { ...everything, search: "zzzz" },
      "one account": { ...everything, account: [...facts.accounts.keys()][0]! },
      "kind: needs you": { ...everything, treatment: "needsYou" },
      "one job": { ...everything, job: [...facts.jobs.keys()][5]! },
      "month and search": { ...everything, month: "2025-03" as never, search: "card" },
    };
    for (const [name, filter] of Object.entries(filters)) {
      const runs = Array.from({ length: 31 }, () => time(() => filterIndex(index, filter))[1]);
      const [found] = time(() => filterIndex(index, filter));
      report[`${name}, ${found.length} found`] = `median ${ms(median(runs))}, worst ${ms(Math.max(...runs))}`;
    }

    const list = { rowHeight: 56, count: transactions.length, overscan: 6 };
    report["window math (one call)"] = ms(median(Array.from({ length: 31 }, () => time(() => visibleRange({ scrollTop: 123_456, height: 700 }, list))[1])));
    report["rows rendered at most"] = String(maxRendered(700, list));
    console.table(report);
  });
});
