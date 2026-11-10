import { type Facts, StoredChangeSchema, apply, localDate, planImport, tablesOf } from "@holt/core";
import { afterEach, describe, expect, it } from "vitest";
import { firstImport } from "../../../../../packages/core/src/testing/first-import.ts";
import { createFactsStore, openFactsStore } from "./index.ts";
import { differences, storeDeps, testDatabase } from "./test-support.ts";

let database: ReturnType<typeof testDatabase> | undefined;
afterEach(() => database?.dispose());

const day = "2026-11-09";

describe("the family's first import in the store: 2,000 transfer pairs among 6,000 rows, one change", () => {
  const scenario = firstImport({ rows: 6_000, pairs: 2_000, repeatGroups: 40 });
  const plan = planImport(scenario.facts, scenario.file, scenario.input());
  if (!plan.ok) throw new Error(`blocked: ${plan.blocked.kind}`);
  const expected = apply(scenario.facts, plan.command, { asOf: localDate(day) });
  if (!expected.ok) throw new Error(`refused: ${expected.refusal.code}`);
  const rowsAdded = 6_000 * 2 + 1 + scenario.balances.length;
  const changes = (): number => (database?.db.prepare("select count(*) as n from changes").get() as { n: number }).n;
  const paired = (facts: Facts): number => [...facts.transactions.values()].filter((t) => t.treatment.kind === "transfer" && t.treatment.partner !== null).length;

  it("is stored as one change, and a reopened store holds the same facts", () => {
    database = testDatabase();
    const store = createFactsStore(database.db, scenario.facts, storeDeps(day));
    const result = store.run(plan.command);
    expect(result).toMatchObject({ status: "applied", change: { kind: "batch" } });
    expect(changes()).toBe(1);
    expect(paired(store.facts())).toBe(4_000);
    expect(differences(store.facts(), expected.facts)).toEqual([]);

    const reopened = openFactsStore(database.reopen(), storeDeps(day));
    expect(reopened).not.toBeNull();
    expect(differences(reopened!.facts(), expected.facts)).toEqual([]);
    expect(reopened!.facts().transactions.size).toBe(6_000);
    expect(tablesOf(reopened!.facts()).importRows).toHaveLength(6_000);
  }, 60_000);

  it("is a record that reads back through the stored-change schema", () => {
    database = testDatabase();
    const store = createFactsStore(database.db, scenario.facts, storeDeps(day));
    store.run(plan.command);
    const raw = database.db.prepare("select id, at, author, command, patch from changes").get() as { id: string; at: string; author: string; command: string; patch: string };
    const read = StoredChangeSchema.safeParse({ id: raw.id, at: raw.at, by: JSON.parse(raw.author), command: JSON.parse(raw.command), patch: JSON.parse(raw.patch) });
    expect(read.success).toBe(true);
    expect(read.success && read.data.patch).toHaveLength(rowsAdded);
  }, 60_000);

  it("is taken back exactly by one undo, before and after a restart, and put back by one redo", () => {
    database = testDatabase();
    const store = createFactsStore(database.db, scenario.facts, storeDeps(day));
    store.run(plan.command);

    const undone = store.step("undo");
    expect(undone).toMatchObject({ status: "applied" });
    expect(differences(store.facts(), scenario.facts)).toEqual([]);
    expect(store.facts().transactions.size).toBe(0);

    const redone = store.step("redo");
    expect(redone).toMatchObject({ status: "applied" });
    expect(differences(store.facts(), expected.facts)).toEqual([]);

    const restarted = openFactsStore(database.reopen(), storeDeps(day))!;
    expect(restarted.step("undo")).toMatchObject({ status: "applied" });
    expect(differences(restarted.facts(), scenario.facts)).toEqual([]);
    const again = openFactsStore(database.reopen(), storeDeps(day))!;
    expect(differences(again.facts(), scenario.facts)).toEqual([]);
    expect(again.step("redo")).toMatchObject({ status: "applied" });
    expect(differences(again.facts(), expected.facts)).toEqual([]);
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
  }, 60_000);

  it("can be imported again after an undo, as a new change, because the file is no longer live", () => {
    database = testDatabase();
    const store = createFactsStore(database.db, scenario.facts, storeDeps(day));
    store.run(plan.command);
    store.step("undo");
    expect(store.run(plan.command)).toMatchObject({ status: "applied" });
    expect(changes()).toBe(1);
    expect(differences(store.facts(), expected.facts)).toEqual([]);
  }, 60_000);
});
