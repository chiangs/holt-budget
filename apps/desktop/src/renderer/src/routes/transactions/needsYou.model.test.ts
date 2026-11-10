import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FamilyCommand, NeedsYouItem, TransactionId } from "@holt/core";
import { acceptAll, actionsFor, moveSelection, needsYouRows, reselect, visibleCount } from "./needsYou.model.ts";
import { buildWorld } from "./test-support.ts";

const world = buildWorld();
const rows = needsYouRows(world.facts, world.figures.needsYou);
const rowOf = (id: TransactionId) => {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`No row for ${id}`);
  return row;
};

describe("needsYouRows", () => {
  it("has one row for each waiting transaction, in the order the figure gives: newest first", () => {
    expect(rows.map((r) => r.id)).toEqual(world.figures.needsYou.map((item) => item.transaction.id));
    expect(rows).toHaveLength(10);
    const dates = rows.map((r) => r.transaction.bookingDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("names the account, and the payee or, without one, the bank's description", () => {
    expect(rowOf(world.tx.lyse).accountName).toBe("Everyday");
    expect(rowOf(world.tx.lyse).who).toBe("Lyse Energi AS");
    expect(rowOf(world.tx.lyse).detail).toBeNull();
    expect(rowOf(world.tx.shopOne).who).toBe("Nærbutikken Fjord");
    expect(rowOf(world.tx.shopOne).detail).toBe("NAERBUTIKKEN FJORD");
    expect(rowOf(world.tx.nameless).who).toBe("KORTKJOP 4455");
    expect(rowOf(world.tx.nameless).detail).toBeNull();
    expect(rowOf(world.tx.moveIn).accountName).toBe("Savings");
  });

  it("tells money out from money in", () => {
    expect(rowOf(world.tx.lyse).direction).toBe("out");
    expect(rowOf(world.tx.salary).direction).toBe("in");
  });

  it("carries the suggestion's own command, with the job it would give and the earlier payment it rests on", () => {
    const item = world.figures.needsYou.find((i) => i.transaction.id === world.tx.lyse);
    const suggestion = rowOf(world.tx.lyse).suggestion;
    expect(suggestion?.kind).toBe("sameAsLast");
    expect(suggestion?.command).toBe(item?.suggestion?.command);
    expect(suggestion?.result).toEqual({ kind: "job", name: "Electricity" });
    expect(suggestion?.jobs).toEqual([world.jobs.electricity]);
    expect(suggestion?.basis).toEqual({ date: "2026-10-05", description: "Lyse Energi AS" });
  });

  it("has no suggestion where the app has nothing to go on", () => {
    expect(rowOf(world.tx.viaplay).suggestion).toBeNull();
    expect(rowOf(world.tx.nameless).suggestion).toBeNull();
    expect(rowOf(world.tx.salary).suggestion).toBeNull();
  });

  it("describes a merge as removing this transaction, and rests it on the one it keeps", () => {
    const [first] = world.figures.needsYou;
    if (first === undefined) throw new Error("no items");
    const kept = world.facts.transactions.get(world.tx.lyseEarlier);
    if (kept === undefined) throw new Error("no kept");
    const items: readonly NeedsYouItem[] = [{ ...first, suggestion: { kind: "merge", command: { kind: "mergeTransactions", keep: kept.id, drop: first.transaction.id } } }];
    const [row] = needsYouRows(world.facts, items);
    expect(row?.suggestion).toMatchObject({ kind: "merge", result: null, jobs: [], shares: null, basis: { date: "2026-10-05" } });
    expect(row?.suggestion?.command).toEqual({ kind: "mergeTransactions", keep: kept.id, drop: first.transaction.id });
  });

  it("lists the transfer candidates it could pair with", () => {
    expect(rowOf(world.tx.moveOut).candidates.map((t) => t.id)).toEqual([world.tx.moveIn]);
    expect(rowOf(world.tx.moveIn).candidates.map((t) => t.id)).toEqual([world.tx.moveOut]);
    expect(rowOf(world.tx.viaplay).candidates).toEqual([]);
  });

  it("reads shares off a split suggestion, so a rule can remember the proportions", () => {
    const [first] = world.figures.needsYou;
    if (first === undefined) throw new Error("no items");
    const [a, b] = [world.jobs.electricity, world.jobs.phones];
    const split: NeedsYouItem = {
      ...first,
      suggestion: {
        kind: "sameAsLast",
        from: world.tx.lyseEarlier,
        command: { kind: "setTreatment", transactionId: first.transaction.id, treatment: { kind: "split", allocations: [{ jobId: a, amount: -700 as never }, { jobId: b, amount: -300 as never }] } },
      },
    };
    const [row] = needsYouRows(world.facts, [split]);
    expect(row?.suggestion?.result).toEqual({ kind: "split", jobs: 2 });
    expect(row?.suggestion?.shares).toEqual([{ jobId: a, weight: 700 }, { jobId: b, weight: 300 }]);
  });
});

describe("actionsFor", () => {
  it("offers a job, a split, a transfer, a note and a rule for money out, with Accept only when there is a suggestion", () => {
    expect(rowOf(world.tx.viaplay).actions).toEqual(["chooseJob", "split", "transfer", "note", "alwaysDoThis"]);
    expect(rowOf(world.tx.lyse).actions).toEqual(["accept", "chooseJob", "split", "transfer", "note", "alwaysDoThis"]);
  });

  it("offers income and refund for money in, and never a job picked as if it were a cost", () => {
    expect(rowOf(world.tx.salary).actions).toEqual(["income", "refund", "split", "transfer", "note", "alwaysDoThis"]);
    expect(rowOf(world.tx.salary).actions).not.toContain("chooseJob");
    expect(rowOf(world.tx.viaplay).actions).not.toContain("income");
    expect(rowOf(world.tx.viaplay).actions).not.toContain("refund");
  });

  it("offers no rule when the bank gave no payee to match", () => {
    expect(rowOf(world.tx.nameless).actions).not.toContain("alwaysDoThis");
    expect(actionsFor({ ...rowOf(world.tx.viaplay).transaction, counterparty: "  " }, null)).not.toContain("alwaysDoThis");
  });
});

describe("acceptAll", () => {
  const withSuggestion = rows.filter((r) => r.suggestion !== null);

  it("is one batch of exactly the suggestions' own commands, in list order", () => {
    const all = acceptAll(rows);
    expect(withSuggestion.length).toBeGreaterThan(1);
    expect(all.command).toEqual({ kind: "batch", commands: withSuggestion.map((r) => r.suggestion?.command) });
    expect(all.count).toBe(withSuggestion.length);
    expect(all.total).toBe(withSuggestion.length);
  });

  it("leaves out the rows with no suggestion", () => {
    const all = acceptAll(rows);
    const batch = all.command as Extract<FamilyCommand, { kind: "batch" }>;
    const touched = batch.commands.flatMap((c) => (c.kind === "setTreatment" ? [c.transactionId] : []));
    expect(touched).not.toContain(world.tx.viaplay);
  });

  it("is nothing when no row has a suggestion", () => {
    expect(acceptAll(rows.filter((r) => r.suggestion === null))).toEqual({ command: null, count: 0, total: 0 });
  });

  it("stops at what one batch may hold and says how many there were", () => {
    const capped = acceptAll(rows, 1);
    expect(capped.count).toBe(1);
    expect(capped.total).toBe(withSuggestion.length);
    expect((capped.command as Extract<FamilyCommand, { kind: "batch" }>).commands).toHaveLength(1);
  });
});

const ids = (n: number): TransactionId[] => Array.from({ length: n }, (_, i) => `id-${i}` as TransactionId);

describe("reselect", () => {
  const before = ids(5);

  it("keeps the selected row while it is there", () => {
    expect(reselect(before, before.slice(1), before[2] ?? null)).toBe(before[2]);
  });

  it("moves to the row that followed the removed one", () => {
    expect(reselect(before, before.filter((id) => id !== before[2]), before[2] ?? null)).toBe(before[3]);
  });

  it("moves to the nearest row above when the last one goes", () => {
    expect(reselect(before, before.slice(0, 4), before[4] ?? null)).toBe(before[3]);
    expect(reselect(before, before.slice(0, 3), before[4] ?? null)).toBe(before[2]);
  });

  it("selects nothing when nothing is left, and the first row when nothing was selected", () => {
    expect(reselect(before, [], before[1] ?? null)).toBeNull();
    expect(reselect(before, before, null)).toBe(before[0]);
  });

  it("always lands on a row that is still there", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), fc.nat(11), (n, keep, at) => {
        const old = ids(n);
        const selected = old[at % n] ?? null;
        const now = old.filter((_, i) => keep[i]);
        const next = reselect(old, now, selected);
        if (now.length === 0) expect(next).toBeNull();
        else {
          expect(now).toContain(next);
          if (selected !== null && now.includes(selected)) expect(next).toBe(selected);
        }
      }),
    );
  });
});

describe("moveSelection", () => {
  const list = ids(4);
  it("steps down and up and stops at the ends", () => {
    expect(moveSelection(list, list[0] ?? null, 1)).toBe(list[1]);
    expect(moveSelection(list, list[3] ?? null, 1)).toBe(list[3]);
    expect(moveSelection(list, list[0] ?? null, -1)).toBe(list[0]);
    expect(moveSelection(list, list[2] ?? null, -1)).toBe(list[1]);
  });
  it("starts at the first row when nothing is selected, and has none to move to in an empty list", () => {
    expect(moveSelection(list, null, 1)).toBe(list[0]);
    expect(moveSelection([], null, 1)).toBeNull();
  });
});

describe("visibleCount", () => {
  it("draws a page at a time, and always the selected row", () => {
    expect(visibleCount(500, 50, 3)).toBe(50);
    expect(visibleCount(500, 50, 120)).toBe(121);
    expect(visibleCount(20, 50, 3)).toBe(20);
  });
});
