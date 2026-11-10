import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Facts, Transaction } from "../facts.ts";
import { type MoveId, type TransactionId, transactionId } from "../ids.ts";
import { type Patch, diffFacts } from "../patch.ts";
import { money } from "../money.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { importHousehold, today } from "../testing/synthetic-statement.ts";
import { type ApplyResult, type Command, apply } from "./apply.ts";
import { checkFacts } from "./check-facts.ts";
import type { TransferPair } from "./imports.ts";

const accountCount = 3;
const sizes = [kr(10), kr(20), kr(30)];
const days = ["2026-09-29", "2026-10-02", "2026-10-03"];

const couple = fc.record({
  from: fc.integer({ min: 0, max: accountCount - 1 }),
  /** Where it goes, counted from the account it leaves, so 0 is the same account. */
  away: fc.integer({ min: 0, max: accountCount - 1 }),
  size: fc.integer({ min: 0, max: sizes.length - 1 }),
  differs: fc.boolean(),
  day: fc.integer({ min: 0, max: days.length - 1 }),
  pairedWith: fc.constantFrom("nobody", "the other", "a stranger"),
  /** A move at the bank to do for exactly this couple. */
  hasMove: fc.boolean(),
});

/** A couple that pairs cleanly: two accounts, one amount, after the plan start, nobody else involved. */
const cleanCouple = couple.map((c) => ({ ...c, away: 1 + (c.away % (accountCount - 1)), differs: false, day: 1 + (c.day % (days.length - 1)), pairedWith: "nobody" as const }));

const recipe = fc.record({
  couples: fc.oneof({ weight: 3, arbitrary: fc.array(cleanCouple, { minLength: 1, maxLength: 7 }) }, { weight: 2, arbitrary: fc.array(couple, { minLength: 1, maxLength: 7 }) }),
  /** Moves at the bank that match no couple in particular. */
  moves: fc.array(fc.record({ from: fc.integer({ min: 0, max: accountCount - 1 }), to: fc.integer({ min: 0, max: accountCount - 1 }), size: fc.integer({ min: 0, max: sizes.length - 1 }), done: fc.boolean() }), { maxLength: 3 }),
  /** Mostly each couple's own two sides, sometimes any two transactions, and now and then the same pair again or an unknown ID. */
  pairs: fc.array(
    fc.record({
      couple: fc.nat(),
      how: fc.constantFrom("couple", "couple", "couple", "couple", "couple", "couple", "again", "crossed", "unknown"),
      cross: fc.nat(),
      move: fc.constantFrom("none", "its own", "its own", "another"),
      other: fc.nat(),
    }),
    { minLength: 1, maxLength: 8 },
  ),
});

interface Scenario {
  readonly facts: Facts;
  readonly pairs: readonly TransferPair[];
}

function scenario(r: typeof recipe extends fc.Arbitrary<infer T> ? T : never): Scenario {
  const h = importHousehold();
  const ids = Object.values(h.accounts).slice(0, accountCount);
  const at = (i: number) => ids[i % ids.length] ?? h.accounts.everyday;
  const sides: { out: TransactionId; into: TransactionId; move: MoveId | null }[] = [];
  for (const [k, c] of r.couples.entries()) {
    const size = sizes[c.size] ?? kr(10);
    const date = days[c.day] ?? "2026-10-02";
    const out = h.builder.needsYou({ accountId: at(c.from), date, amount: money(-size), description: `Out ${k}` });
    const into = h.builder.needsYou({ accountId: at(c.from + c.away), date, amount: c.differs ? money(size + 100) : size, description: `In ${k}` });
    const move = c.hasMove ? h.builder.move({ from: at(c.from), to: at(c.from + c.away), amount: size, month: "2026-10" }) : null;
    sides.push({ out, into, move });
  }
  const loose: MoveId[] = r.moves.map((m) => h.builder.move({ from: at(m.from), to: at(m.to), amount: sizes[m.size] ?? kr(10), month: "2026-10", status: m.done ? "done" : "todo" }));
  const built = h.facts();
  const transactions = new Map(built.transactions);
  for (const [k, c] of r.couples.entries()) {
    const side = sides[k];
    if (side === undefined || c.pairedWith === "nobody") continue;
    const out = transactions.get(side.out) as Transaction;
    const partner = c.pairedWith === "the other" ? side.into : (sides[(k + 1) % sides.length]?.into ?? side.into);
    transactions.set(side.out, { ...out, treatment: { kind: "transfer", partner } });
  }
  const every = sides.flatMap((s) => [s.out, s.into]);
  const pairs = r.pairs.map((p): TransferPair => {
    const side = sides[p.couple % sides.length] as { out: TransactionId; into: TransactionId; move: MoveId | null };
    const crossed = every[p.cross % every.length] as TransactionId;
    const [a, b] =
      p.how === "couple" ? [side.out, side.into] : p.how === "crossed" ? [side.out, crossed] : p.how === "again" ? [side.into, side.out] : [transactionId(testId(990_000)), side.into];
    const move = p.move === "its own" ? side.move : p.move === "another" ? (loose[p.other % Math.max(1, loose.length)] ?? null) : null;
    return move === null ? { a, b } : { a, b, completesMove: move };
  });
  return { facts: { ...built, transactions }, pairs };
}

const asOf = { asOf: today };
const single = (pair: TransferPair): Command => ({ kind: "pairTransfers", pairs: [pair] });
const sorted = (patch: Patch) => [...patch].sort((x, y) => (x.table + x.key < y.table + y.key ? -1 : 1));
const outcomeOf = (result: ApplyResult) => (result.ok ? { ok: true as const } : { ok: false as const, code: result.refusal.code });

/** The same pairs, one command at a time, each applied to what the one before left. */
function oneByOne(facts: Facts, pairs: readonly TransferPair[]): ApplyResult {
  let current = facts;
  for (const pair of pairs) {
    const result = apply(current, single(pair), asOf);
    if (!result.ok) return result;
    current = result.facts;
  }
  return { ok: true, facts: current, patch: diffFacts(facts, current) };
}

/** Every row of every table as text, so a test sees any change to any row. */
const snapshot = (facts: Facts): string => JSON.stringify(Object.entries(facts).map(([table, rows]) => [table, [...(rows as ReadonlyMap<string, unknown>)]]));

const seen = { accepted: 0, completedMove: 0, codes: new Set<string>() };

describe("pairTransfers with many pairs", () => {
  it("does exactly what the same pairs one by one do, and what a batch of one command per pair does", () => {
    fc.assert(
      fc.property(recipe, (r) => {
        const { facts, pairs } = scenario(r);
        const together = apply(facts, { kind: "pairTransfers", pairs }, asOf);
        const separately = oneByOne(facts, pairs);
        const batched = apply(facts, { kind: "batch", commands: pairs.map(single) }, asOf);
        expect(outcomeOf(together)).toEqual(outcomeOf(separately));
        expect(outcomeOf(batched)).toEqual(outcomeOf(separately));
        if (together.ok && separately.ok && batched.ok) {
          expect(together.facts).toEqual(separately.facts);
          expect(batched.facts).toEqual(separately.facts);
          expect(sorted(together.patch)).toEqual(sorted(separately.patch));
          expect(sorted(batched.patch)).toEqual(sorted(separately.patch));
          expect(checkFacts(together.facts)).toEqual(checkFacts(facts));
          seen.accepted += 1;
          if ([...together.facts.moves.values()].some((m) => m.status === "done" && facts.moves.get(m.id)?.status === "todo")) seen.completedMove += 1;
        } else if (!together.ok) seen.codes.add(together.refusal.code);
      }),
      { numRuns: 400 },
    );
    expect(seen.accepted).toBeGreaterThan(20);
    expect(seen.completedMove).toBeGreaterThan(0);
    expect(seen.codes.size).toBeGreaterThanOrEqual(4);
  });

  it("changes nothing when a later pair is refused, however many pairs came first", () => {
    fc.assert(
      fc.property(recipe, (r) => {
        const { facts, pairs } = scenario(r);
        const before = snapshot(facts);
        const spoiled: TransferPair[] = [...pairs, { a: transactionId(testId(990_000)), b: transactionId(testId(990_002)) }];
        const result = apply(facts, { kind: "pairTransfers", pairs: spoiled }, asOf);
        expect(result.ok).toBe(false);
        expect(snapshot(facts)).toBe(before);
        const first = apply(facts, { kind: "pairTransfers", pairs }, asOf);
        if (first.ok) expect(result).toMatchObject({ refusal: { code: "transactionNotFound" } });
      }),
      { numRuns: 100 },
    );
  });

  it("is a change that does nothing when it holds no pairs", () => {
    const { facts } = scenario({ couples: [{ from: 0, away: 1, size: 0, differs: false, day: 1, pairedWith: "nobody", hasMove: false }], moves: [], pairs: [{ couple: 0, how: "couple", cross: 0, move: "none", other: 0 }] });
    const result = apply(facts, { kind: "pairTransfers", pairs: [] }, asOf);
    expect(result.ok && result.patch).toEqual([]);
    expect(result.ok && result.facts).toEqual(facts);
  });
});
