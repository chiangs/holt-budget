import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { crashFacts, importOf, writesForImport } from "./crash-fixtures.ts";
import { createFactsStore, openFactsStore } from "./index.ts";
import { differences, storeDeps, testDatabase } from "./test-support.ts";
import { trapWrites } from "./trap-writes.ts";

let database: ReturnType<typeof testDatabase> | undefined;
afterEach(() => database?.dispose());

const changeCount = (db: ReturnType<typeof testDatabase>["db"]): number => (db.prepare("select count(*) as n from changes").get() as { n: number }).n;

function crashAt(rows: number, writes: readonly number[]): void {
  database = testDatabase();
  const before = createFactsStore(database.db, crashFacts(), storeDeps()).facts();
  for (const k of writes) {
    const trapped = trapWrites(database.db, (count) => {
      if (count === k) throw new Error(`The disk failed at write ${k}`);
    });
    const store = openFactsStore(trapped, storeDeps());
    expect(store).not.toBeNull();
    expect(() => store!.run(importOf(store!.facts(), rows))).toThrow(`write ${k}`);
    expect(differences(store!.facts(), before), `memory after a failure at write ${k}`).toEqual([]);
    expect(store!.revision).toBe(0);
    expect(differences(openFactsStore(database.db, storeDeps())!.facts(), before), `disk after a failure at write ${k}`).toEqual([]);
    expect(changeCount(database.db)).toBe(0);
  }
  const intact = openFactsStore(database.db, storeDeps())!;
  expect(intact.run(importOf(intact.facts(), rows)).status).toBe("applied");
  expect(intact.facts().transactions.size).toBe(rows);
  expect(intact.facts().importRows.size).toBe(rows);
  // The record of a big import reads back, so the whole import can be undone.
  expect(intact.step("undo").status).toBe("applied");
  expect(differences(intact.facts(), before)).toEqual([]);
  expect(differences(openFactsStore(database.db, storeDeps())!.facts(), before)).toEqual([]);
  expect(database.db.pragma("integrity_check", { simple: true })).toBe("ok");
}

describe("P4: a failure at any write leaves the old facts", () => {
  it("at every write of a 120-row import", () => {
    const rows = 120;
    crashAt(rows, Array.from({ length: writesForImport(rows) }, (_, i) => i + 1));
  }, 60_000);

  it("at the first, middle and last writes of a 4,000-row import", () => {
    const rows = 4_000;
    const last = writesForImport(rows);
    crashAt(rows, [1, 2, 2_000, rows + 1, rows + 2, 6_000, last - 3, last - 2, last - 1, last]);
  }, 60_000);
});

const child = fileURLToPath(new URL("./crash-child.ts", import.meta.url));

function killChildAt(killAt: number, rows: number) {
  database = testDatabase();
  const before = createFactsStore(database.db, crashFacts(), storeDeps()).facts();
  database.db.close();
  const run = spawnSync(process.execPath, [child, database.file, database.key.toString("hex"), String(killAt), String(rows)], { encoding: "utf8" });
  const reopened = openFactsStore(database.reopen(), storeDeps())!;
  return { run, before, reopened };
}

describe("P4: a process killed at a write leaves the old facts or the new, never a mix", () => {
  const rows = 400;

  it.each([1, 200, writesForImport(rows) - 1, writesForImport(rows)])("killed by SIGKILL before write %i of the first change: no trace of it", (killAt) => {
    const { run, before, reopened } = killChildAt(killAt, rows);
    expect(run.signal, run.stderr).toBe("SIGKILL");
    expect(differences(reopened.facts(), before)).toEqual([]);
    expect(changeCount(database!.db)).toBe(0);
    expect(database!.db.pragma("integrity_check", { simple: true })).toBe("ok");
  });

  it("killed before the first write of the second change: the whole first change, and nothing of the second", () => {
    const { run, before, reopened } = killChildAt(writesForImport(rows) + 1, rows);
    expect(run.signal, run.stderr).toBe("SIGKILL");
    expect(reopened.facts().transactions.size).toBe(rows);
    expect(reopened.facts().importRows.size).toBe(rows);
    expect(differences(reopened.facts(), before).sort()).toEqual(["importBatches", "importRows", "transactions"]);
    expect(changeCount(database!.db)).toBe(1);
    expect(reopened.step("undo").status).toBe("applied");
    expect(differences(reopened.facts(), before)).toEqual([]);
  });

  it("the second change completes when nothing kills the process", () => {
    const { run, reopened } = killChildAt(writesForImport(rows) + 3 + 1, rows);
    expect(run.status, run.stderr).toBe(0);
    expect(reopened.facts().transactions.size).toBe(rows + 1);
    expect(changeCount(database!.db)).toBe(2);
  });
});
