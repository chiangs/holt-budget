import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import { month } from "../dates.ts";
import type { BucketTransfer, Facts } from "../facts.ts";
import { bucketTransferId, jobId, transactionId } from "../ids.ts";
import { accepted, changeMeta } from "../testing/command-household.ts";
import { kr, monthlySaving, testId } from "../testing/facts-builder.ts";
import { transferHousehold, transferToday } from "../testing/transfer-household.ts";
import { type Command, apply, commit } from "./apply.ts";

const h = transferHousehold();
const run = (command: Command, facts: Facts = h.facts) => apply(facts, command, { asOf: transferToday });
const id = (n: number) => bucketTransferId(testId(840_000 + n));
const november = month("2026-11");
const october = month("2026-10");

const move = (change: Partial<BucketTransfer> = {}, n = 1): Command => ({
  kind: "moveBucket",
  transfer: { id: id(n), month: november, from: h.jobs.electricity, to: h.jobs.holiday, amount: kr(300), reason: "", ...change },
});
const refusalOf = (command: Command, facts: Facts = h.facts) => {
  const result = run(command, facts);
  return result.ok ? "accepted" : result.refusal.code;
};

describe("moving money between buckets", () => {
  it("stores exactly the transfer it was given, and changes no other row", () => {
    const command = move({ amount: kr(300), reason: "Cover the holiday deposit" });
    const result = run(command);
    if (!result.ok || command.kind !== "moveBucket") throw new Error("refused");
    expect(result.patch).toEqual([{ table: "bucketTransfers", key: id(1), before: null, after: command.transfer }]);
    expect(result.facts.bucketTransfers.get(id(1))).toEqual(command.transfer);
  });

  it("accepts the whole bucket and refuses one øre more, from the bucket's end of that month", () => {
    expect(refusalOf(move({ amount: kr(800) }))).toBe("accepted");
    expect(refusalOf(move({ amount: (kr(800) + 1) as BucketTransfer["amount"] }))).toBe("bucketHoldsLess");
    expect(refusalOf(move({ amount: kr(1_800), month: october }))).toBe("accepted");
    expect(refusalOf(move({ amount: (kr(1_800) + 1) as BucketTransfer["amount"], month: october }))).toBe("bucketHoldsLess");
  });

  it("counts what the bucket already gave away and got in that month", () => {
    const gaveAway = accepted(run(move({ amount: kr(500) }, 1)));
    expect(refusalOf(move({ amount: kr(301) }, 2), gaveAway)).toBe("bucketHoldsLess");
    expect(refusalOf(move({ amount: kr(300) }, 2), gaveAway)).toBe("accepted");
    const got = accepted(run(move({ from: h.jobs.holiday, to: h.jobs.electricity, amount: kr(1_000) }, 1)));
    expect(refusalOf(move({ amount: kr(1_800) }, 2), got)).toBe("accepted");
    expect(refusalOf(move({ amount: kr(1_801) }, 2), got)).toBe("bucketHoldsLess");
  });

  it("counts what the bucket spent, so a bucket that overspent has nothing to give", () => {
    const short = accepted(run({ kind: "recordTransaction", transaction: { id: transactionId(testId(840_900)), accountId: h.accounts.everyday, bookingDate: transferToday, amount: kr(-900), description: "Electricity bill", treatment: { kind: "split", allocations: [{ jobId: h.jobs.electricity, amount: kr(-900) }] } } }));
    expect(refusalOf(move({ amount: kr(1) }), short)).toBe("bucketHoldsLess");
    expect(refusalOf(move({ amount: kr(1), from: h.jobs.holiday, to: h.jobs.electricity }), short)).toBe("accepted");
  });

  it("is refused for an amount of zero or less", () => {
    expect(refusalOf(move({ amount: kr(0) }))).toBe("amountNotPositive");
    expect(refusalOf(move({ amount: kr(-1) }))).toBe("amountNotPositive");
  });

  it("is refused from a job to itself, and for a job that isn't there", () => {
    expect(refusalOf(move({ to: h.jobs.electricity }))).toBe("sameJob");
    expect(refusalOf(move({ from: jobId(testId(999_999)) }))).toBe("jobNotFound");
    expect(refusalOf(move({ to: jobId(testId(999_999)) }))).toBe("jobNotFound");
  });

  it("is refused for an ID that is taken", () => {
    expect(refusalOf(move({}, 1), accepted(run(move({}, 1))))).toBe("idTaken");
  });

  it("is refused in a month the family hasn't opened, and accepted in an open, a closed and a reopened month", () => {
    expect(refusalOf(move({ month: month("2026-12") }))).toBe("transferMonthNotStarted");
    expect(refusalOf(move({ month: month("2026-09") }))).toBe("transferMonthNotStarted");
    expect(refusalOf(move({ month: november }))).toBe("accepted");
    expect(refusalOf(move({ month: october }))).toBe("accepted");
    const reopened = accepted(run({ kind: "reopenMonth", month: october }));
    expect(refusalOf(move({ month: october }), reopened)).toBe("accepted");
  });

  it("is refused into or out of a job that keeps no money", () => {
    expect(refusalOf(move({ to: h.jobs.food }))).toBe("bucketNotKept");
    expect(refusalOf(move({ from: h.jobs.food, amount: kr(1) }))).toBe("bucketNotKept");
  });

  it("asks for a reason when the money leaves the buffer, and for no reason otherwise", () => {
    const fromBuffer = (reason: string) => move({ from: h.jobs.buffer, to: h.jobs.electricity, amount: kr(4_100), reason });
    expect(refusalOf(fromBuffer(""))).toBe("bufferMoveNeedsReason");
    expect(refusalOf(fromBuffer("   "))).toBe("bufferMoveNeedsReason");
    expect(refusalOf(fromBuffer("Start evening out Electricity"))).toBe("accepted");
    expect(refusalOf(move({ from: h.jobs.electricity, to: h.jobs.buffer, reason: "" }))).toBe("accepted");
    expect(refusalOf(move({ reason: "" }))).toBe("accepted");
  });

  it("moves a bucket in another account without touching a balance or the bank", () => {
    const before = h.facts;
    const after = accepted(run(move({ from: h.jobs.buffer, to: h.jobs.electricity, amount: kr(4_100), reason: "Start evening out" })));
    expect(after.accounts).toEqual(before.accounts);
    expect(after.moves).toEqual(before.moves);
    expect(after.transactions).toEqual(before.transactions);
    expect(after.assignments).toEqual(before.assignments);
  });

  it("sees the transfers earlier in a batch", () => {
    const drain = move({ amount: kr(800) }, 1);
    const again = move({ amount: kr(1) }, 2);
    expect(refusalOf({ kind: "batch", commands: [drain, again] })).toBe("bucketHoldsLess");
    const there = move({ from: h.jobs.holiday, to: h.jobs.electricity, amount: kr(1_000) }, 1);
    expect(refusalOf({ kind: "batch", commands: [there, move({ amount: kr(1_800) }, 2)] })).toBe("accepted");
  });

  it("can be undone, which restores the facts exactly", () => {
    const done = commit(h.facts, emptyChangeLog(), move({ amount: kr(500), reason: "" }), changeMeta(1), { asOf: transferToday });
    if (!done.ok) throw new Error("refused");
    const undone = undo(done.facts, done.log);
    expect(undone.ok && undone.facts).toEqual(h.facts);
  });
});

describe("a job a transfer names", () => {
  const gifts = jobId(testId(840_800));
  /** Gifts is a new job. It gets 100 kr from Holiday, and then gives the 100 kr back. */
  const world = () => {
    const addGifts = accepted(run({ kind: "addJob", job: { id: gifts, name: "Gifts", groupId: [...h.facts.groups.keys()][0]!, status: "active", accountId: h.accounts.everyday, essential: false, opening: kr(0), kind: "saveUp", role: "ordinary", target: { kind: "monthly", amount: kr(100) } } }));
    const filled = accepted(run(move({ from: h.jobs.holiday, to: gifts, amount: kr(100) }, 1), addGifts));
    const emptied = accepted(run(move({ from: gifts, to: h.jobs.holiday, amount: kr(100) }, 2), filled));
    return { addGifts, filled, emptied };
  };

  it("can't be deleted while its bucket holds money, and then not at all, even once the bucket is empty", () => {
    const { addGifts, filled, emptied } = world();
    expect(refusalOf({ kind: "deleteJob", jobId: gifts }, addGifts)).toBe("accepted");
    expect(refusalOf({ kind: "deleteJob", jobId: gifts }, filled)).toBe("bucketHoldsMoney");
    expect(refusalOf({ kind: "deleteJob", jobId: gifts }, emptied)).toBe("jobHasTransfers");
  });

  it("can't be deleted whichever side of the transfer it is on, once its bucket is empty", () => {
    const { b, accounts } = transferHousehold();
    const gave = b.saveUpJob({ name: "Gave", target: monthlySaving(kr(1)), opening: kr(100), accountId: accounts.everyday });
    const got = b.saveUpJob({ name: "Got", target: monthlySaving(kr(1)), opening: kr(-100), accountId: accounts.everyday });
    b.bucketTransfer({ month: "2026-11", from: gave, to: got, amount: kr(100) });
    const facts = b.facts();
    expect(refusalOf({ kind: "deleteJob", jobId: gave }, facts)).toBe("jobHasTransfers");
    expect(refusalOf({ kind: "deleteJob", jobId: got }, facts)).toBe("jobHasTransfers");
  });

  it("can be archived instead, and keeps its transfers", () => {
    const archived = accepted(run({ kind: "changeJob", jobId: gifts, changes: { status: "archived" } }, world().emptied));
    expect(archived.bucketTransfers.size).toBe(2);
  });

  it("can't stop keeping its money while a transfer names it", () => {
    const hobbies = jobId(testId(840_801));
    const plain = accepted(run({ kind: "addJob", job: { id: hobbies, name: "Hobbies", groupId: [...h.facts.groups.keys()][0]!, status: "active", accountId: h.accounts.everyday, essential: false, opening: kr(0), kind: "spend", keepsMoney: true, plan: { mode: "setAmount", amount: kr(100) }, seasonality: "irregular" } }));
    const into = accepted(run(move({ to: hobbies, amount: kr(100) }, 3), plain));
    const result = run({ kind: "changeJob", jobId: hobbies, changes: { ofKind: { kind: "spend", keepsMoney: false } } }, into);
    expect(!result.ok && result.refusal.code === "breaksFacts" && result.refusal.violations.map((v) => v.code)).toEqual(["transferJobKeepsNoMoney"]);
  });
});
