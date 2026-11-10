import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { month } from "./dates.ts";
import { type Account, type Facts, type Group, type Household, emptyFacts, makeSplit, type Transaction } from "./facts.ts";
import { accountId, groupId, householdId, transactionId } from "./ids.ts";
import { currency, money } from "./money.ts";
import { type Patch, PatchConflict, applyPatch, diffFacts, editFacts, invertPatch } from "./patch.ts";
import { localDate } from "./dates.ts";
import { jobId } from "./ids.ts";

const household: Household = {
  id: householdId("00000000-0000-4000-8000-000000000001"),
  name: "Test household",
  currency: currency("NOK"),
  planStart: month("2026-01"),
  evenOutStep: money(5000),
};

const accountIds = [1, 2, 3].map((n) => accountId(`00000000-0000-4000-8000-0000000001${n}0`));
const groupIds = [1, 2].map((n) => groupId(`00000000-0000-4000-8000-0000000002${n}0`));

const account = (n: number, name: string, balance = 0): Account => ({
  id: accountIds[n]!,
  name,
  kind: "everyday",
  scope: "shared",
  openingBalance: money(balance),
  openingDate: localDate("2026-01-01"),
});

const group = (n: number, name: string): Group => ({ id: groupIds[n]!, name, order: n, countsTowardsSavingsRate: false });

function deepFreeze<T>(value: T): T {
  if (value instanceof Map) {
    for (const [k, v] of value) {
      deepFreeze(k);
      deepFreeze(v);
    }
  }
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function seed(): Facts {
  const base = emptyFacts(household);
  const patch = editFacts(base).put("accounts", account(0, "Everyday", 100)).put("groups", group(0, "Home")).patch();
  return applyPatch(base, patch);
}

type Op =
  | { kind: "putAccount"; n: number; name: string; balance: number }
  | { kind: "removeAccount"; n: number }
  | { kind: "putGroup"; n: number; name: string }
  | { kind: "removeGroup"; n: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("putAccount" as const), n: fc.nat(2), name: fc.string(), balance: fc.integer({ min: -1000, max: 1000 }) }),
  fc.record({ kind: fc.constant("removeAccount" as const), n: fc.nat(2) }),
  fc.record({ kind: fc.constant("putGroup" as const), n: fc.nat(1), name: fc.string() }),
  fc.record({ kind: fc.constant("removeGroup" as const), n: fc.nat(1) }),
);

function patchFor(facts: Facts, op: Op): Patch {
  const e = editFacts(facts);
  switch (op.kind) {
    case "putAccount":
      return e.put("accounts", account(op.n, op.name, op.balance)).patch();
    case "removeAccount":
      return e.remove("accounts", accountIds[op.n]!).patch();
    case "putGroup":
      return e.put("groups", group(op.n, op.name)).patch();
    case "removeGroup":
      return e.remove("groups", groupIds[op.n]!).patch();
  }
}

function runOps(start: Facts, ops: readonly Op[]): { facts: Facts; patch: Patch } {
  let facts = start;
  const all: Patch[] = [];
  for (const op of ops) {
    const p = patchFor(facts, op);
    facts = applyPatch(facts, p);
    all.push(p);
  }
  return { facts, patch: all.flat() };
}

describe("applyPatch and invertPatch", () => {
  it("applying a patch and then its inverse restores the original facts (property)", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        const start = seed();
        const { facts, patch } = runOps(start, ops);
        expect(applyPatch(facts, invertPatch(patch))).toEqual(start);
      }),
    );
  });

  it("applies a whole patch to the original facts to give the changed facts (property)", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        const start = seed();
        const { facts, patch } = runOps(start, ops);
        expect(applyPatch(start, patch)).toEqual(facts);
      }),
    );
  });

  it("diffFacts then applyPatch reproduces the target (property)", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 25 }), (ops) => {
        const start = seed();
        const { facts: target } = runOps(start, ops);
        expect(applyPatch(start, diffFacts(start, target))).toEqual(target);
      }),
    );
  });

  it("diffFacts of equal facts is empty", () => {
    expect(diffFacts(seed(), seed())).toEqual([]);
  });

  it("never mutates the input facts or the patch", () => {
    const start = deepFreeze(seed());
    const patch = deepFreeze(editFacts(start).put("accounts", account(0, "Renamed")).put("accounts", account(1, "New")).remove("groups", groupIds[0]!).patch());
    const next = applyPatch(start, patch);
    expect(next.accounts.get(accountIds[0]!)?.name).toBe("Renamed");
    expect(start.accounts.get(accountIds[0]!)?.name).toBe("Everyday");
    expect(start.groups.size).toBe(1);
    expect(() => applyPatch(next, deepFreeze(invertPatch(patch)))).not.toThrow();
  });

  it("shares the tables a patch did not touch", () => {
    const start = seed();
    const next = applyPatch(start, editFacts(start).put("accounts", account(1, "New")).patch());
    expect(next.groups).toBe(start.groups);
    expect(next.accounts).not.toBe(start.accounts);
  });

  it("throws a PatchConflict naming every row that no longer matches", () => {
    const start = seed();
    const patch = editFacts(start).put("accounts", account(0, "Renamed")).remove("groups", groupIds[0]!).put("accounts", account(1, "New")).patch();
    const drifted = applyPatch(start, editFacts(start).put("accounts", account(0, "Someone else")).put("groups", group(0, "Changed")).patch());
    let caught: unknown;
    try {
      applyPatch(drifted, patch);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PatchConflict);
    const rows = (caught as PatchConflict).mismatches;
    expect(rows.map((r) => `${r.table}/${r.key}`).sort()).toEqual([`accounts/${accountIds[0]}`, `groups/${groupIds[0]}`].sort());
    const accountRow = rows.find((r) => r.table === "accounts");
    expect(accountRow?.expected).toEqual(account(0, "Everyday", 100));
    expect(accountRow?.actual).toEqual(account(0, "Someone else"));
  });

  it("refuses an insert when the row already exists", () => {
    const start = seed();
    const patch = editFacts(emptyFacts(household)).put("accounts", account(0, "Everyday", 100)).patch();
    expect(() => applyPatch(start, patch)).toThrow(PatchConflict);
  });

  it("treats a split row as equal to an identical copy of it", () => {
    const tx = (): Transaction => ({
      id: transactionId("00000000-0000-4000-8000-000000000301"),
      accountId: accountIds[0]!,
      bookingDate: localDate("2026-02-03"),
      amount: money(-300),
      description: "Shop",
      treatment: makeSplit(money(-300), [
        { jobId: jobId("00000000-0000-4000-8000-000000000401"), amount: money(-100) },
        { jobId: jobId("00000000-0000-4000-8000-000000000402"), amount: money(-200) },
      ]),
    });
    const start = applyPatch(seed(), editFacts(seed()).put("transactions", tx()).patch());
    const rebuilt = tx();
    const patch: Patch = [{ table: "transactions", key: rebuilt.id, before: rebuilt, after: { ...rebuilt, description: "Shop 2" } }];
    expect(applyPatch(start, patch).transactions.get(rebuilt.id)?.description).toBe("Shop 2");
    const otherSplit = makeSplit(money(-300), [
      { jobId: jobId("00000000-0000-4000-8000-000000000401"), amount: money(-99) },
      { jobId: jobId("00000000-0000-4000-8000-000000000402"), amount: money(-201) },
    ]);
    const changedAllocation: Transaction = { ...rebuilt, treatment: otherSplit };
    expect(() => applyPatch(start, [{ table: "transactions", key: rebuilt.id, before: changedAllocation, after: null }])).toThrow(PatchConflict);
  });
});

describe("editFacts", () => {
  it("records an insert as a null before, an update with both rows and a delete as a null after", () => {
    const start = seed();
    const patch = editFacts(start).put("accounts", account(1, "New")).put("accounts", account(0, "Renamed", 100)).remove("groups", groupIds[0]!).patch();
    expect(patch).toEqual([
      { table: "accounts", key: accountIds[1], before: null, after: account(1, "New") },
      { table: "accounts", key: accountIds[0], before: account(0, "Everyday", 100), after: account(0, "Renamed", 100) },
      { table: "groups", key: groupIds[0], before: group(0, "Home"), after: null },
    ]);
  });

  it("adds no change for a row equal to the existing one, or for removing a row that is not there", () => {
    const start = seed();
    expect(editFacts(start).put("accounts", account(0, "Everyday", 100)).remove("accounts", accountIds[2]!).patch()).toEqual([]);
  });

  it("refuses two changes to one row", () => {
    const start = seed();
    expect(() => editFacts(start).put("accounts", account(0, "A")).put("accounts", account(0, "B"))).toThrow();
    expect(() => editFacts(start).put("accounts", account(0, "A")).remove("accounts", accountIds[0]!)).toThrow();
    expect(() => editFacts(start).put("accounts", account(0, "Everyday", 100)).put("accounts", account(0, "B"))).toThrow();
  });

  it("does not change the facts it started from", () => {
    const start = deepFreeze(seed());
    expect(() => editFacts(start).put("accounts", account(1, "New")).remove("groups", groupIds[0]!).patch()).not.toThrow();
  });
});
