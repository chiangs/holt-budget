import { type Facts, type FamilyCommand, type Transaction, apply } from "@holt/core";
import { factsBuilder, kr, testId } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { splitTo, today, transaction, withTransactions, world } from "./AllTestWorld.ts";
import { candidatesFor, moveCompletedBy, orderCandidates, transferCommand } from "./TransferDialog.model.ts";

const w = world();
const ids = (list: readonly Transaction[]): string[] => list.map((t) => t.id);
const apply1 = (facts: Facts, command: FamilyCommand | null) => {
  if (command === null) throw new Error("No command");
  const result = apply(facts, command, { asOf: today });
  if (!result.ok) throw new Error(`Refused: ${result.refusal.code}`);
  return result.facts;
};

describe("which transaction pairs best", () => {
  const mine = transaction({ accountId: w.accounts.everyday, date: "2026-10-10", amount: -50_000 });
  const mk = (date: string, id?: string) => transaction({ accountId: w.accounts.bills, date, amount: 50_000, ...(id === undefined ? {} : { id: id as never }) });

  it("puts the nearest booking date first, the earlier date on a tie, and the lower ID on a tie after that", () => {
    const sameDay = mk("2026-10-10", "00000000-0000-7000-8000-0000000000b0");
    const sameDayToo = mk("2026-10-10", "00000000-0000-7000-8000-0000000000a0");
    const dayAfter = mk("2026-10-11");
    const dayBefore = mk("2026-10-09");
    const threeAway = mk("2026-10-13");
    expect(ids(orderCandidates(mine, [threeAway, dayAfter, sameDay, dayBefore, sameDayToo]))).toEqual([sameDayToo.id, sameDay.id, dayBefore.id, dayAfter.id, threeAway.id]);
  });

  it("orders the same way whatever order the candidates arrive in, with the best first (property)", () => {
    const pool = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].map((d) => mk(d));
    fc.assert(
      fc.property(fc.shuffledSubarray(pool, { minLength: 1 }), (shuffled) => {
        const ordered = orderCandidates(mine, shuffled);
        expect(ordered).toHaveLength(shuffled.length);
        const gap = (t: Transaction) => Math.abs(Date.parse(t.bookingDate) - Date.parse(mine.bookingDate));
        for (let i = 1; i < ordered.length; i += 1) expect(gap(ordered[i - 1]!)).toBeLessThanOrEqual(gap(ordered[i]!));
        expect(ids(orderCandidates(mine, [...shuffled].reverse()))).toEqual(ids(ordered));
      }),
    );
  });
});

describe("which transactions it could pair with", () => {
  const out = transaction({ accountId: w.accounts.everyday, date: "2026-10-10", amount: -50_000, treatment: splitTo(-50_000, w.jobs.food) });
  const near = transaction({ accountId: w.accounts.bills, date: "2026-10-11", amount: 50_000 });
  const sameDay = transaction({ accountId: w.accounts.savings, date: "2026-10-10", amount: 50_000 });
  const tooFar = transaction({ accountId: w.accounts.bills, date: "2026-10-20", amount: 50_000 });
  const otherAmount = transaction({ accountId: w.accounts.bills, date: "2026-10-10", amount: 50_001 });
  const sameAccount = transaction({ accountId: w.accounts.everyday, date: "2026-10-10", amount: 50_000 });
  const alreadyPaired = transaction({ accountId: w.accounts.bills, date: "2026-10-10", amount: 50_000, treatment: { kind: "transfer", partner: "00000000-0000-7000-8000-00000000ffff" as never } });
  const facts = withTransactions(w.facts, out, near, sameDay, tooFar, otherAmount, sameAccount, alreadyPaired);

  it("finds the opposite amount in another account within 3 days, for a transaction that already has a job", () => {
    expect(ids(candidatesFor(facts, out))).toEqual([sameDay.id, near.id]);
  });

  it("finds the other side from either direction", () => {
    const a = transaction({ accountId: w.accounts.everyday, date: "2026-10-10", amount: -12_300 });
    const b = transaction({ accountId: w.accounts.bills, date: "2026-10-12", amount: 12_300 });
    const both = withTransactions(w.facts, a, b);
    expect(ids(candidatesFor(both, a))).toEqual([b.id]);
    expect(ids(candidatesFor(both, b))).toEqual([a.id]);
  });

  it("leaves out a transaction the family already gave a job, as core does", () => {
    expect(ids(candidatesFor(facts, near))).toEqual([]);
  });

  it("finds nothing when the other side isn't imported", () => {
    const lonely = transaction({ accountId: w.accounts.everyday, date: "2026-10-10", amount: -77_700 });
    expect(candidatesFor(withTransactions(w.facts, lonely), lonely)).toEqual([]);
  });

  it("lists a pair's own partner, so a pair can be kept or changed", () => {
    const paired = apply1(facts, transferCommand(facts, out, near.id));
    const mineNow = paired.transactions.get(out.id)!;
    expect(ids(candidatesFor(paired, mineNow))).toContain(near.id);
    expect(ids(candidatesFor(paired, mineNow))).toContain(sameDay.id);
  });
});

describe("the change a choice makes (through core)", () => {
  const out = transaction({ accountId: w.accounts.everyday, date: "2026-10-10", amount: -50_000 });
  const near = transaction({ accountId: w.accounts.bills, date: "2026-10-11", amount: 50_000 });
  const other = transaction({ accountId: w.accounts.savings, date: "2026-10-10", amount: 50_000 });
  const facts = withTransactions(w.facts, out, near, other);

  it("pairs two transactions as transfers of each other", () => {
    const result = apply1(facts, transferCommand(facts, out, near.id));
    expect(result.transactions.get(out.id)!.treatment).toEqual({ kind: "transfer", partner: near.id });
    expect(result.transactions.get(near.id)!.treatment).toEqual({ kind: "transfer", partner: out.id });
  });

  it("marks one side a transfer that waits, when the other side isn't imported", () => {
    const result = apply1(facts, transferCommand(facts, out, null));
    expect(result.transactions.get(out.id)!.treatment).toEqual({ kind: "transfer", partner: null });
    expect(result.transactions.get(near.id)!.treatment).toEqual({ kind: "needsYou" });
  });

  it("completes the move at the bank that the pair matches, and no other", () => {
    const b = factsBuilder({ planStart: "2026-08" });
    const from = b.account({ name: "From" });
    const to = b.account({ name: "To" });
    b.buffer({ monthly: kr(1) });
    const right = b.move({ from, to, amount: kr(500), month: "2026-10" });
    b.move({ from: to, to: from, amount: kr(500), month: "2026-10" });
    b.move({ from, to, amount: kr(400), month: "2026-10" });
    const sent = transaction({ accountId: from, date: "2026-10-10", amount: -50_000 });
    const got = transaction({ accountId: to, date: "2026-10-10", amount: 50_000 });
    const withMoves = withTransactions(b.facts(), sent, got);
    expect(moveCompletedBy(withMoves, sent, got)?.id).toBe(right);
    expect(moveCompletedBy(withMoves, got, sent)?.id).toBe(right);
    const result = apply1(withMoves, transferCommand(withMoves, sent, got.id));
    expect(result.moves.get(right)).toMatchObject({ status: "done", completedBy: sent.id });
    expect([...result.moves.values()].filter((m) => m.status === "done")).toHaveLength(1);
    const backwards = transaction({ accountId: to, date: "2026-10-10", amount: -50_000 });
    const backwardsIn = transaction({ accountId: from, date: "2026-10-10", amount: 50_000 });
    expect(moveCompletedBy(withMoves, backwards, backwardsIn)?.from).toBe(to);
    const elsewhere = transaction({ accountId: from, date: "2026-10-10", amount: -123_400 });
    const elsewhereIn = transaction({ accountId: to, date: "2026-10-10", amount: 123_400 });
    expect(moveCompletedBy(withMoves, elsewhere, elsewhereIn)).toBeUndefined();
  });

  it("changes the partner in one change, letting the old partner go back to waiting for its other side", () => {
    const paired = apply1(facts, transferCommand(facts, out, near.id));
    const mineNow = paired.transactions.get(out.id)!;
    const command = transferCommand(paired, mineNow, other.id);
    expect(command?.kind).toBe("batch");
    const result = apply1(paired, command);
    expect(result.transactions.get(out.id)!.treatment).toEqual({ kind: "transfer", partner: other.id });
    expect(result.transactions.get(other.id)!.treatment).toEqual({ kind: "transfer", partner: out.id });
    expect(result.transactions.get(near.id)!.treatment).toEqual({ kind: "transfer", partner: null });
  });

  it("lets a pair go back to waiting on both sides", () => {
    const paired = apply1(facts, transferCommand(facts, out, near.id));
    const result = apply1(paired, transferCommand(paired, paired.transactions.get(out.id)!, null));
    expect(result.transactions.get(out.id)!.treatment).toEqual({ kind: "transfer", partner: null });
    expect(result.transactions.get(near.id)!.treatment).toEqual({ kind: "transfer", partner: null });
  });

  it("changes nothing when the choice is the one it already has", () => {
    const paired = apply1(facts, transferCommand(facts, out, near.id));
    expect(transferCommand(paired, paired.transactions.get(out.id)!, near.id)).toBeNull();
    const waiting = apply1(facts, transferCommand(facts, out, null));
    expect(transferCommand(waiting, waiting.transactions.get(out.id)!, null)).toBeNull();
  });

  it("builds nothing for a partner that does not exist", () => {
    expect(transferCommand(facts, out, testId(99_999) as never)).toBeNull();
  });
});
