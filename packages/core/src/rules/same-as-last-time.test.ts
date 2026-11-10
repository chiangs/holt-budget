import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { treatmentFor } from "../commands/transactions.ts";
import type { Facts, Transaction } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { factsBuilder, kr, setAmount } from "../testing/facts-builder.ts";
import { counterpartyKey } from "./resolve.ts";
import { sameAsLastTime } from "./same-as-last-time.ts";

const names = ["Kiwi", "kiwi ", "Rema 1000", "Vy"];

interface Row {
  readonly day: number;
  readonly amount: number;
  readonly name: string | null;
  /** Null waits for you. Otherwise the shares of a split across the jobs, and whether the last one points the other way. */
  readonly split: { readonly weights: readonly number[]; readonly pointsBack: boolean } | null;
}

const rowArbitrary: fc.Arbitrary<Row> = fc.record({
  day: fc.integer({ min: 1, max: 28 }),
  amount: fc.integer({ min: -90_000, max: 30_000 }),
  name: fc.option(fc.constantFrom(...names), { nil: null }),
  split: fc.option(fc.record({ weights: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 3 }), pointsBack: fc.boolean() }), { nil: null }),
});

/** Facts planned from October 2026 in which each row is a transaction, named, and split or waiting. */
function build(rows: readonly Row[]): Facts {
  const b = factsBuilder({ planStart: "2026-10" });
  b.account({ name: "Everyday" });
  b.buffer({ monthly: kr(1_000) });
  const jobs = [b.spendJob({ name: "Food", plan: setAmount(kr(1)) }), b.spendJob({ name: "Eating out", plan: setAmount(kr(1)) }), b.spendJob({ name: "Car", plan: setAmount(kr(1)) })];
  const counterparties = new Map<string, string>();
  for (const row of rows) {
    const date = `2026-10-${String(row.day).padStart(2, "0")}`;
    let id: string;
    if (row.split === null) id = b.needsYou({ date, amount: money(row.amount) });
    else {
      const { weights, pointsBack } = row.split;
      const total = weights.reduce((sum, w) => sum + w, 0);
      const parts = weights.map((w) => Math.trunc((row.amount * w) / total));
      parts[0] = (parts[0] ?? 0) + (row.amount - parts.reduce((sum, p) => sum + p, 0));
      const last = weights.length - 1;
      const allocations = parts.map((part, i): [JobId, Money] => [jobs[i] as JobId, money(pointsBack && i === last && last > 0 ? -part * 2 : part)]);
      id = b.split({ date, allocations });
    }
    if (row.name !== null) counterparties.set(id, row.name);
  }
  const facts = b.facts();
  return { ...facts, transactions: new Map([...facts.transactions].map(([id, t]) => [id, counterparties.has(id) ? { ...t, counterparty: counterparties.get(id) as string } : t])) };
}

const bookedBefore = (a: Transaction, b: Transaction): boolean => a.bookingDate < b.bookingDate || (a.bookingDate === b.bookingDate && a.id < b.id);

/** A split can be scaled when no allocation points the other way from the transaction and they are not all zero. */
const scalable = (t: Transaction): boolean =>
  t.treatment.kind === "split" && t.treatment.allocations.every((a) => a.amount === 0 || Math.sign(a.amount) === Math.sign(t.amount)) && t.treatment.allocations.some((a) => a.amount !== 0);

describe("sameAsLastTime", () => {
  it("finds, for each transaction waiting with a counterparty, the latest earlier scalable split from the same counterparty", () => {
    let found = 0;
    fc.assert(
      fc.property(fc.array(rowArbitrary, { maxLength: 24 }), (list) => {
        const facts = build(list);
        const result = sameAsLastTime(facts);
        for (const t of facts.transactions.values()) {
          if (t.treatment.kind !== "needsYou" || t.counterparty === undefined) {
            expect(result.has(t.id)).toBe(false);
            continue;
          }
          const key = counterpartyKey(t.counterparty);
          const precedents = [...facts.transactions.values()].filter((p) => p.counterparty !== undefined && counterpartyKey(p.counterparty) === key && scalable(p) && bookedBefore(p, t));
          const latest = precedents.reduce<Transaction | undefined>((best, p) => (best === undefined || bookedBefore(best, p) ? p : best), undefined);
          expect(result.get(t.id)?.from).toBe(latest?.id);
          if (latest !== undefined) found += 1;
        }
      }),
    );
    expect(found).toBeGreaterThan(0);
  });

  it("scales to the new amount: the same jobs in the same order, adding up to it, with its sign", () => {
    fc.assert(
      fc.property(fc.array(rowArbitrary, { maxLength: 24 }), (list) => {
        const facts = build(list);
        for (const [id, suggestion] of sameAsLastTime(facts)) {
          const t = facts.transactions.get(id) as Transaction;
          const from = facts.transactions.get(suggestion.from) as Transaction;
          if (from.treatment.kind !== "split" || suggestion.treatment.kind !== "split") throw new Error("not a split");
          expect(suggestion.treatment.allocations.map((a) => a.jobId)).toEqual(from.treatment.allocations.map((a) => a.jobId));
          expect(suggestion.treatment.allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(t.amount);
          expect(treatmentFor(suggestion.treatment, t.amount)).not.toBeNull();
          for (const a of suggestion.treatment.allocations) expect(a.amount === 0 || Math.sign(a.amount) === Math.sign(t.amount)).toBe(true);
        }
      }),
    );
  });

  it("keeps the proportions of the earlier split when the amount is the same", () => {
    fc.assert(
      fc.property(fc.array(rowArbitrary, { maxLength: 24 }), (list) => {
        const facts = build(list);
        for (const [id, suggestion] of sameAsLastTime(facts)) {
          const t = facts.transactions.get(id) as Transaction;
          const from = facts.transactions.get(suggestion.from) as Transaction;
          if (from.treatment.kind !== "split" || suggestion.treatment.kind !== "split" || from.amount !== t.amount) continue;
          expect(suggestion.treatment.allocations.map((a) => a.amount)).toEqual(from.treatment.allocations.map((a) => a.amount));
        }
      }),
    );
  });

  it("is the same whatever order the transactions are held in", () => {
    fc.assert(
      fc.property(fc.array(rowArbitrary, { maxLength: 24 }), (list) => {
        const facts = build(list);
        const reversed: Facts = { ...facts, transactions: new Map([...facts.transactions].reverse()) };
        expect(sameAsLastTime(reversed)).toEqual(sameAsLastTime(facts));
      }),
    );
  });

  it("changes no transaction", () => {
    const facts = build([{ day: 1, amount: -500, name: "Kiwi", split: { weights: [1], pointsBack: false } }, { day: 2, amount: -300, name: "Kiwi", split: null }]);
    const before = JSON.stringify([...facts.transactions]);
    sameAsLastTime(facts);
    expect(JSON.stringify([...facts.transactions])).toBe(before);
  });
});
