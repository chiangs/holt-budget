import { describe, expect, it } from "vitest";
import { emptyChangeLog, redo, undo } from "../change-log.ts";
import { type Command, commit } from "../commands/apply.ts";
import { checkFacts } from "../commands/check-facts.ts";
import { rowsEqual } from "../patch.ts";
import { StoredChangeSchema } from "../schema/index.ts";
import { firstImport } from "../testing/first-import.ts";
import { today } from "../testing/synthetic-statement.ts";
import { planImport } from "./plan.ts";

const pairing = (command: Command) => (command.kind === "batch" ? command.commands.filter((c) => c.kind === "pairTransfers") : []);

describe("the family's first import: thousands of rows and thousands of transfer pairs in one change", () => {
  const scenario = firstImport({ rows: 6_000, pairs: 2_000, repeatGroups: 40 });
  const plan = planImport(scenario.facts, scenario.file, scenario.input());
  if (!plan.ok) throw new Error(`blocked: ${plan.blocked.kind}`);
  const meta = { id: "00000000-0000-7000-8000-00000000f001" as never, at: "2026-11-09T10:00:00.000Z", by: { kind: "family" } as const };
  const done = commit(scenario.facts, emptyChangeLog(), plan.command, meta, { asOf: today });
  if (!done.ok) throw new Error(`refused: ${done.refusal.code}`);

  it("pairs every transfer that has exactly one other side, and no other", () => {
    expect(plan.preview.transfers).toHaveLength(2_000);
    const paired = [...done.facts.transactions.values()].filter((t) => t.treatment.kind === "transfer" && t.treatment.partner !== null);
    expect(paired).toHaveLength(4_000);
    for (const t of paired) {
      const partner = t.treatment.kind === "transfer" && t.treatment.partner !== null ? done.facts.transactions.get(t.treatment.partner) : undefined;
      expect(partner?.treatment).toEqual({ kind: "transfer", partner: t.id });
      expect([partner?.amount, partner?.accountId === t.accountId]).toEqual([-t.amount, false]);
    }
    expect(plan.preview.counts).toMatchObject({ rows: 6_000, created: 6_000, transfers: 4_000 });
  });

  it("makes a change whose size doesn't grow with the pairs, so a page-sized limit never stops it", () => {
    expect(plan.command.commands.length).toBeLessThan(20);
    expect(pairing(plan.command)).toHaveLength(1);
  });

  it("leaves the facts sound and only adds rows: the batch, a row and a transaction for each line, and the typed balances", () => {
    expect(checkFacts(done.facts)).toEqual(checkFacts(scenario.facts));
    expect(done.record.patch.every((change) => change.before === null)).toBe(true);
    expect(done.record.patch).toHaveLength(6_000 * 2 + 1 + scenario.balances.length);
  });

  it("is a record the store can read back: it survives JSON and the stored-change schema unchanged", () => {
    const stored = StoredChangeSchema.safeParse(JSON.parse(JSON.stringify(done.record)));
    expect(stored.success).toBe(true);
    expect(stored.success && rowsEqual(stored.data, done.record)).toBe(true);
  });

  it("is taken back exactly by one undo, and put back exactly by one redo", () => {
    const undone = undo(done.facts, done.log);
    if (!undone.ok) throw new Error(`undo refused: ${undone.conflict.kind}`);
    expect(undone.facts).toEqual(scenario.facts);
    const redone = redo(undone.facts, undone.log);
    expect(redone.ok && redone.facts).toEqual(done.facts);
  });
});
