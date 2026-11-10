import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import { type Command, apply, commit } from "../commands/apply.ts";
import { checkFacts } from "../commands/check-facts.ts";
import type { Facts, Transaction } from "../facts.ts";
import { type TransactionId, changeId } from "../ids.ts";
import { currency } from "../money.ts";
import { type ImportScenario, arbitraryImportScenario } from "../testing/arbitrary-import.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { commitPlan, importInput, today } from "../testing/synthetic-statement.ts";
import { matchKey } from "./matching.ts";
import { type ImportPlan, planImport } from "./plan.ts";
import type { StatementFile } from "./statement.ts";

const context = { asOf: today };
const runs = { numRuns: 300 };

function keyCounts(transactions: Iterable<Transaction>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of transactions) counts.set(matchKey(t), (counts.get(matchKey(t)) ?? 0) + 1);
  return counts;
}

/** Per key, the booked rows of household accounts in the file. */
function rowCounts(facts: Facts, file: StatementFile): Map<string, number> {
  const byNumber = new Map([...facts.accounts.values()].flatMap((a) => (a.number === undefined ? [] : [[a.number, a.id] as const])));
  const counts = new Map<string, number>();
  for (const row of file.rows) {
    const accountId = byNumber.get(row.account);
    if (accountId === undefined || row.pending) continue;
    const key = matchKey({ accountId, amount: row.amount, bookingDate: row.bookingDate, description: row.description });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function importBoth(s: ImportScenario) {
  const first = planImport(s.facts, s.files[0], importInput("first", 10_000));
  const afterFirst = first.ok ? commitPlan(s.facts, first) : s.facts;
  const second = planImport(afterFirst, s.files[1], importInput("second", 20_000));
  const afterBoth = second.ok ? commitPlan(afterFirst, second) : afterFirst;
  return { first, afterFirst, second, afterBoth };
}

function batchOf(plan: ImportPlan) {
  if (!plan.ok) throw new Error("expected a plan");
  return plan.preview.batchId;
}

describe("importing, as properties", () => {
  it("imports the same file twice only once, and the second time changes nothing", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const plan = planImport(s.facts, s.files[0], importInput("same", 10_000));
        if (!plan.ok) return;
        const after = commitPlan(s.facts, plan);
        expect(planImport(after, s.files[0], importInput("same", 20_000))).toEqual({ ok: false, blocked: { kind: "duplicateFile", batchId: plan.preview.batchId } });
        const replay = apply(after, plan.command, context);
        expect(replay.ok).toBe(false);
      }),
      runs,
    );
  });

  it("gives each key as many transactions as the file or the facts with the most of it, never more", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const { first, second, afterBoth } = importBoth(s);
        const before = keyCounts(s.facts.transactions.values());
        const n1 = first.ok ? rowCounts(s.facts, s.files[0]) : new Map<string, number>();
        const n2 = second.ok ? rowCounts(s.facts, s.files[1]) : new Map<string, number>();
        const after = keyCounts(afterBoth.transactions.values());
        for (const key of new Set([...before.keys(), ...n1.keys(), ...n2.keys()])) {
          expect(after.get(key) ?? 0).toBe(Math.max(before.get(key) ?? 0, n1.get(key) ?? 0, n2.get(key) ?? 0));
        }
        expect(checkFacts(afterBoth)).toEqual([]);
      }),
      runs,
    );
  });

  it("has every booked row back one transaction that exists, no pending row back any, and no file back a transaction twice", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const { afterBoth } = importBoth(s);
        const perBatch = new Set<string>();
        for (const row of afterBoth.importRows.values()) {
          if (row.pending) expect(row.backs).toBeNull();
          else {
            expect(row.backs !== null && afterBoth.transactions.has(row.backs)).toBe(true);
            const pair = `${row.batchId}/${row.backs}`;
            expect(perBatch.has(pair)).toBe(false);
            perBatch.add(pair);
          }
        }
      }),
      runs,
    );
  });

  it("puts the facts back when an import is undone straight away, apart from the batch marked undone, its rows released and transfer partners left waiting", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const plan = planImport(s.facts, s.files[0], importInput("first", 10_000));
        if (!plan.ok) return;
        const imported = commitPlan(s.facts, plan);
        const undone = apply(imported, { kind: "undoImport", batchId: plan.preview.batchId }, context);
        if (!undone.ok) throw new Error(undone.refusal.code);

        const pairedExisting = new Set(plan.preview.transfers.flatMap((t) => [t.outgoing, t.incoming]).filter((id) => s.facts.transactions.has(id)));
        const expectedTransactions = new Map(
          [...s.facts.transactions].map(([id, t]): [TransactionId, Transaction] => {
            if (!pairedExisting.has(id)) return [id, t];
            const { ruleId: _rule, ...rest } = t;
            return [id, { ...rest, treatment: { kind: "transfer", partner: null } }];
          }),
        );
        const batch = imported.importBatches.get(plan.preview.batchId);
        expect(undone.facts).toEqual({
          ...s.facts,
          transactions: expectedTransactions,
          importBatches: new Map([...s.facts.importBatches, [plan.preview.batchId, { ...batch, undone: true }]]),
          importRows: new Map([...imported.importRows].map(([id, row]) => [id, s.facts.importRows.get(id) ?? { ...row, backs: null }])),
        });
      }),
      runs,
    );
  });

  it("puts the facts back exactly when the whole change is undone from the change log", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const plan = planImport(s.facts, s.files[0], importInput("first", 10_000, [{ accountId: s.accounts[0]!, value: kr(1_234), asOf: today }]));
        if (!plan.ok) return;
        const saved = commit(s.facts, emptyChangeLog<Command>(), plan.command, { id: changeId(testId(99_000)), at: "2026-11-09T10:00:00Z", by: { kind: "family" } }, context);
        if (!saved.ok) throw new Error(saved.refusal.code);
        const reverted = undo(saved.facts, saved.log);
        expect(reverted.ok && reverted.facts).toEqual(s.facts);
      }),
      runs,
    );
  });

  it("never removes a transaction that a live row of another import backs", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const { first, second, afterBoth } = importBoth(s);
        if (!first.ok || !second.ok) return;
        for (const [undoing, staying] of [
          [batchOf(first), batchOf(second)],
          [batchOf(second), batchOf(first)],
        ] as const) {
          const undone = apply(afterBoth, { kind: "undoImport", batchId: undoing }, context);
          if (!undone.ok) throw new Error(undone.refusal.code);
          for (const row of afterBoth.importRows.values()) {
            if (row.batchId === staying && row.backs !== null) expect(undone.facts.transactions.has(row.backs)).toBe(true);
          }
          expect(checkFacts(undone.facts)).toEqual([]);
        }
      }),
      runs,
    );
  });

  it("lets a file be imported again once its import is undone, with the same result", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const plan = planImport(s.facts, s.files[0], importInput("again", 10_000));
        if (!plan.ok) return;
        const imported = commitPlan(s.facts, plan);
        const undone = apply(imported, { kind: "undoImport", batchId: plan.preview.batchId }, context);
        if (!undone.ok) throw new Error(undone.refusal.code);
        const again = planImport(undone.facts, s.files[0], importInput("again", 20_000));
        expect(again.ok).toBe(true);
        expect(keyCounts(commitPlan(undone.facts, again).transactions.values())).toEqual(keyCounts(imported.transactions.values()));
      }),
      runs,
    );
  });

  it("previews exactly what its command changes", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), fc.integer({ min: -100_000, max: 100_000 }), (s, typed) => {
        const plan = planImport(s.facts, s.files[0], importInput("first", 10_000, [{ accountId: s.accounts[0]!, value: kr(typed), asOf: today }]));
        if (!plan.ok) return;
        const result = apply(s.facts, plan.command, context);
        if (!result.ok) throw new Error(result.refusal.code);
        const { counts } = plan.preview;
        const inserted = <T extends string>(table: T) => result.patch.filter((c) => c.table === table && c.before === null);
        const newRows = result.patch.flatMap((c) => (c.table === "importRows" && c.before === null && c.after !== null ? [c.after] : []));

        expect(inserted("transactions").length).toBe(counts.created);
        expect(newRows.length).toBe(counts.rows - counts.leftOut);
        expect(newRows.filter((r) => r.pending).length).toBe(counts.pending);
        expect(newRows.filter((r) => r.backs !== null && s.facts.transactions.has(r.backs)).length).toBe(counts.matched);
        expect(inserted("enteredValues").length).toBe(1);
        expect(counts.rows).toBe(counts.created + counts.matched + counts.pending + counts.leftOut);
        expect(counts.created).toBe(counts.history + counts.byRule + counts.suggested + counts.chosen + counts.transfers + counts.needsYou);
        expect(plan.preview.leftOut.reduce((sum, l) => sum + l.rows, 0)).toBe(counts.leftOut);
        const lines = plan.preview.accounts;
        expect([lines.reduce((n, l) => n + l.rows, 0), lines.reduce((n, l) => n + l.created, 0), lines.reduce((n, l) => n + l.matched, 0)]).toEqual([
          counts.rows - counts.leftOut,
          counts.created,
          counts.matched,
        ]);

        const pairedIds = plan.preview.transfers.flatMap((t) => [t.outgoing, t.incoming]);
        const nowTransfers = [...result.facts.transactions.values()].filter((t) => t.treatment.kind === "transfer" && t.treatment.partner !== null);
        const wasPaired = (t: Transaction) => s.facts.transactions.get(t.id)?.treatment.kind === "transfer";
        expect(nowTransfers.filter((t) => !wasPaired(t)).map((t) => t.id).sort()).toEqual([...pairedIds].sort());
        const done = result.patch.filter((c) => c.table === "moves" && c.after !== null && "status" in c.after && c.after.status === "done");
        expect(done.length).toBe(plan.preview.completedMoves.length);
        expect(plan.preview.sample.length).toBe(Math.min(counts.created, 50));
      }),
      runs,
    );
  });

  it("plans the same way every time for the same input", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        expect(planImport(s.facts, s.files[1], importInput("x", 10_000))).toEqual(planImport(s.facts, s.files[1], importInput("x", 10_000)));
      }),
      runs,
    );
  });

  it("creates nothing from a file in another currency, whatever its rows", () => {
    fc.assert(
      fc.property(arbitraryImportScenario(), (s) => {
        const plan = planImport(s.facts, { ...s.files[0], accountCurrency: currency("EUR") }, importInput("eur", 10_000));
        expect(plan).toEqual({ ok: false, blocked: { kind: "wrongCurrency", file: "EUR", household: "NOK" } });
      }),
      runs,
    );
  });
});
