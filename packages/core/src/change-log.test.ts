import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ChangeLog, type ChangeRecord, emptyChangeLog, record, redo, undo } from "./change-log.ts";
import { localDate, month } from "./dates.ts";
import { type Account, type Facts, type Household, emptyFacts } from "./facts.ts";
import { accountId, changeId, householdId, proposalId } from "./ids.ts";
import { currency, money } from "./money.ts";
import { type Patch, applyPatch, editFacts } from "./patch.ts";

const household: Household = {
  id: householdId("00000000-0000-4000-8000-000000000001"),
  name: "Test household",
  currency: currency("NOK"),
  planStart: month("2026-01"),
  evenOutStep: money(5000),
};

const ids = [0, 1, 2].map((n) => accountId(`00000000-0000-4000-8000-0000000001${n}0`));
const account = (n: number, name: string): Account => ({
  id: ids[n]!,
  name,
  kind: "everyday",
  scope: "shared",
  openingBalance: money(0),
  openingDate: localDate("2026-01-01"),
});

let counter = 0;
function entry(patch: Patch, by: ChangeRecord<string>["by"] = { kind: "family" }): ChangeRecord<string> {
  counter += 1;
  return { id: changeId(`00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`), at: "2026-11-09T10:00:00Z", by, command: `command ${counter}`, patch };
}

function freeze<T>(value: T): T {
  if (value instanceof Map) for (const [k, v] of value) (freeze(k), freeze(v));
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

function commit(facts: Facts, log: ChangeLog<string>, patch: Patch, by?: ChangeRecord<string>["by"]) {
  return { facts: applyPatch(facts, patch), log: record(log, entry(patch, by)) };
}

const start = emptyFacts(household);

describe("undo and redo", () => {
  it("undoing an insert deletes the row", () => {
    const { facts, log } = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "Everyday")).patch());
    const result = undo(facts, log);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.facts.accounts.has(ids[0]!)).toBe(false);
  });

  it("undoing a delete restores the identical row", () => {
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "Everyday")).patch());
    const original = s1.facts.accounts.get(ids[0]!);
    const s2 = commit(s1.facts, s1.log, editFacts(s1.facts).remove("accounts", ids[0]!).patch());
    const result = undo(s2.facts, s2.log);
    expect(result.ok && result.facts.accounts.get(ids[0]!)).toEqual(original);
  });

  it("undoing an update restores the row as it was", () => {
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "Everyday")).patch());
    const s2 = commit(s1.facts, s1.log, editFacts(s1.facts).put("accounts", account(0, "Renamed")).patch());
    const result = undo(s2.facts, s2.log);
    expect(result.ok && result.facts).toEqual(s1.facts);
  });

  it("undo then redo gives the same facts as the change itself (property)", () => {
    const nameArb = fc.string();
    fc.assert(
      fc.property(fc.array(fc.record({ n: fc.nat(2), name: nameArb, remove: fc.boolean() }), { minLength: 1, maxLength: 12 }), (steps) => {
        let facts = start;
        let log = emptyChangeLog<string>();
        const history: Facts[] = [facts];
        for (const s of steps) {
          const e = editFacts(facts);
          if (s.remove) e.remove("accounts", ids[s.n]!);
          else e.put("accounts", account(s.n, s.name));
          const next = commit(facts, log, e.patch());
          facts = next.facts;
          log = next.log;
          history.push(facts);
        }
        for (let i = history.length - 2; i >= 0; i--) {
          const u = undo(facts, log);
          if (!u.ok) throw new Error("undo refused");
          expect(u.facts).toEqual(history[i]);
          facts = u.facts;
          log = u.log;
        }
        for (let i = 1; i < history.length; i++) {
          const r = redo(facts, log);
          if (!r.ok) throw new Error("redo refused");
          expect(r.facts).toEqual(history[i]);
          facts = r.facts;
          log = r.log;
        }
        expect(log.undone).toEqual([]);
      }),
    );
  });

  it("refuses to undo when a later change touched the row, and explains what changed", () => {
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "Everyday")).put("accounts", account(1, "Savings")).patch());
    const drifted = applyPatch(s1.facts, editFacts(s1.facts).put("accounts", account(1, "Renamed later")).patch());
    const result = undo(drifted, s1.log);
    expect(result.ok).toBe(false);
    if (result.ok || result.conflict.kind !== "rowsChanged") throw new Error("expected a row conflict");
    expect(result.conflict.changeId).toBe(s1.log.done[0]!.id);
    expect(result.conflict.rows).toEqual([{ table: "accounts", key: ids[1], expected: account(1, "Savings"), actual: account(1, "Renamed later") }]);
  });

  it("does not partly undo: an untouched row stays as the change left it when another row conflicts", () => {
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "A")).put("accounts", account(1, "B")).patch());
    const drifted = applyPatch(s1.facts, editFacts(s1.facts).remove("accounts", ids[1]!).patch());
    const result = undo(drifted, s1.log);
    expect(result.ok).toBe(false);
    if (!result.ok && result.conflict.kind === "rowsChanged") expect(result.conflict.rows[0]).toMatchObject({ key: ids[1], actual: null });
  });

  it("refuses to redo when the rows changed after the undo", () => {
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "Everyday")).patch());
    const u = undo(s1.facts, s1.log);
    if (!u.ok) throw new Error("undo refused");
    const drifted = applyPatch(u.facts, editFacts(u.facts).put("accounts", account(0, "Other")).patch());
    const r = redo(drifted, u.log);
    expect(r.ok).toBe(false);
    if (!r.ok && r.conflict.kind === "rowsChanged") expect(r.conflict.rows[0]).toMatchObject({ expected: null, actual: account(0, "Other") });
  });

  it("says there is nothing to undo or redo on empty stacks", () => {
    expect(undo(start, emptyChangeLog())).toEqual({ ok: false, conflict: { kind: "nothingToUndo" } });
    expect(redo(start, emptyChangeLog())).toEqual({ ok: false, conflict: { kind: "nothingToRedo" } });
  });

  it("clears the redo stack when a new change is recorded", () => {
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "A")).patch());
    const u = undo(s1.facts, s1.log);
    if (!u.ok) throw new Error("undo refused");
    expect(u.log.undone).toHaveLength(1);
    const s2 = commit(u.facts, u.log, editFacts(u.facts).put("accounts", account(1, "B")).patch());
    expect(s2.log.undone).toEqual([]);
    expect(redo(s2.facts, s2.log)).toEqual({ ok: false, conflict: { kind: "nothingToRedo" } });
  });

  it("keeps the author, command and time on the record it hands back", () => {
    const by = { kind: "proposal", proposalId: proposalId("00000000-0000-7000-8000-0000000000a1") } as const;
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "A")).patch(), by);
    const u = undo(s1.facts, s1.log);
    expect(u.ok && u.record).toMatchObject({ by, at: "2026-11-09T10:00:00Z", command: s1.log.done[0]!.command });
  });

  it("does not mutate the facts or the log", () => {
    const s1 = commit(start, emptyChangeLog(), editFacts(start).put("accounts", account(0, "A")).patch());
    freeze(s1.facts);
    freeze(s1.log);
    const u = undo(s1.facts, s1.log);
    if (!u.ok) throw new Error("undo refused");
    expect(s1.log.done).toHaveLength(1);
    expect(s1.log.undone).toHaveLength(0);
    freeze(u.log);
    expect(redo(u.facts, u.log).ok).toBe(true);
  });
});
