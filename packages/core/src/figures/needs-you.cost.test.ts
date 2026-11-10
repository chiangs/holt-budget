/**
 * What a pass costs the caller (decision 0046, "Facts and figures"): the page works the figures out again
 * after every change, so a pass must not pay for rows that cannot matter, and the two figures the screen
 * reads separately are worked out only when read.
 */

import { describe, expect, it } from "vitest";
import { apply } from "../commands/apply.ts";
import { localDate } from "../dates.ts";
import type { Facts, Transaction } from "../facts.ts";
import { nearMatches } from "../import/near-matches.ts";
import { kr, factsBuilder, setAmount } from "../testing/facts-builder.ts";
import { familyVolume } from "../testing/family-volume.ts";
import { computeFigures } from "./index.ts";
import { importStatuses } from "./import-status.ts";
import { needsYouItems } from "./needs-you.ts";

// Core is typed without Node, so the one host function this test uses is named here.
declare const structuredClone: <T>(value: T) => T;

const asOf = localDate("2026-06-15");

/** A Map that counts how often it is iterated. */
class CountingMap<K, V> extends Map<K, V> {
  iterations = 0;
  override values(): MapIterator<V> {
    this.iterations += 1;
    return super.values();
  }
  override [Symbol.iterator](): MapIterator<[K, V]> {
    this.iterations += 1;
    return super[Symbol.iterator]();
  }
}

function counted<K, V>(map: ReadonlyMap<K, V>): CountingMap<K, V> {
  return new CountingMap(map);
}

describe("the figures read when asked", () => {
  const { facts } = familyVolume(170);

  it("work out the needs-you list and the import status only when read, and once", () => {
    const rows = counted(facts.importRows);
    const rules = counted(facts.rules);
    const figures = computeFigures({ ...facts, importRows: rows, rules }, asOf);
    expect(rows.iterations).toBe(0);
    expect(rules.iterations).toBe(0);

    const status = figures.importStatus;
    expect(rows.iterations).toBe(1);
    expect(figures.importStatus).toBe(status);
    expect(rows.iterations).toBe(1);

    const items = figures.needsYou;
    expect(rules.iterations).toBe(1);
    expect(figures.needsYou).toBe(items);
    expect(rules.iterations).toBe(1);
  });

  it("give what the functions behind them give", () => {
    const figures = computeFigures(facts, asOf);
    expect(figures.needsYou).toEqual(needsYouItems(facts));
    expect(figures.needsYou.length).toBe(51);
  });

  it("stay plain data in a copy: spreading or cloning what was read keeps its values", () => {
    const figures = computeFigures(facts, asOf);
    const copy = { ...figures };
    expect(Object.getOwnPropertyDescriptor(copy, "needsYou")).toMatchObject({ value: figures.needsYou });
    expect(Object.getOwnPropertyDescriptor(copy, "importStatus")).toMatchObject({ value: figures.importStatus });
    const cloned = structuredClone(figures);
    expect(cloned.needsYou).toEqual(figures.needsYou);
    expect(cloned.importStatus).toEqual(figures.importStatus);
    expect(Object.keys(copy)).toEqual(Object.keys(figures));
  });

  it("come from the facts of their own pass: after a change the next pass lists one waiting transaction fewer", () => {
    const before = computeFigures(facts, asOf);
    const [first] = before.needsYou;
    if (first === undefined || first.suggestion?.command.kind !== "setTreatment") throw new Error("expected a suggestion to accept");
    const done = apply(facts, first.suggestion.command, { asOf });
    if (!done.ok) throw new Error(`refused: ${done.refusal.code}`);
    const after = computeFigures(done.facts, asOf);
    expect(after.needsYou.map((item) => item.transaction.id)).toEqual(before.needsYou.slice(1).map((item) => item.transaction.id));
    expect(after.needsYou).toEqual(needsYouItems(done.facts));
    const other = familyVolume(85).facts;
    expect(computeFigures(other, asOf).needsYou).toEqual(needsYouItems(other));
    expect(computeFigures(other, asOf).importStatus).toEqual(importStatuses(other, asOf));
  });

  it("are equal for equal facts, whether or not either was read first", () => {
    const first = computeFigures(facts, asOf);
    const second = computeFigures({ ...facts }, asOf);
    void first.needsYou;
    expect(first).toEqual(second);
  });
});

/** The households here have no two rows that could be one payment, so no row may be compared with another. */
describe("a pass does not look at rows that cannot matter", () => {
  /** A transaction whose description counts how often it is read. */
  function watched(facts: Facts): { readonly facts: Facts; readonly reads: () => number } {
    let reads = 0;
    const transactions = new Map<Transaction["id"], Transaction>();
    for (const [id, t] of facts.transactions) {
      const { description } = t;
      transactions.set(id, Object.defineProperty({ ...t }, "description", { enumerable: true, get: () => ((reads += 1), description) }));
    }
    return { facts: { ...facts, transactions }, reads: () => reads };
  }

  const { facts } = familyVolume(1);

  it("reads no description when no row shares an account, amount and nearby date with a waiting one", () => {
    const { facts: watching, reads } = watched(facts);
    expect(nearMatches(watching).size).toBe(0);
    expect(reads()).toBe(0);
    needsYouItems(watching);
    expect(reads()).toBe(0);
  });

  it("reads the descriptions of the rows that are candidates, and of no others", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const account = b.account({ name: "One" });
    b.group();
    b.buffer({ monthly: kr(1) });
    const job = b.spendJob({ plan: setAmount(kr(1)) });
    for (let i = 0; i < 300; i += 1) b.spend({ date: "2026-03-10", amount: kr(-(i + 1)), jobId: job, description: `Shop ${i}` });
    const a = b.needsYou({ date: "2026-03-02", amount: kr(-1000), accountId: account, description: "Kiwi" });
    b.needsYou({ date: "2026-03-03", amount: kr(-1000), accountId: account, description: "KIWI" });
    b.needsYou({ date: "2026-03-05", amount: kr(-1000), accountId: account, description: "Kiwi" });
    const { facts: watching, reads } = watched(b.facts());
    expect(nearMatches(watching).get(a)).toBeDefined();
    expect(reads()).toBeGreaterThan(0);
    expect(reads()).toBeLessThanOrEqual(12);
  });
});
