/**
 * What the tests in this folder share. Core's generators are not in a package export yet, so they come by
 * path, and `fast-check` comes from here so there is one place to change when the desktop app depends on it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Command, type Facts, type LocalDate, type TableName, localDate, rowsEqual, tableNames, tablesOf } from "@holt/core";
import { createMint } from "../../shared/ids.ts";
import { type Db, openDatabase } from "../storage/database.ts";
import { type DataKey, newDataKey } from "../storage/keys.ts";
import { migrate } from "../storage/migrations.ts";
import type { StoreDeps } from "./store.ts";

export { default as fc } from "fast-check";
export { arbitraryFacts } from "../../../../../packages/core/src/testing/arbitrary-facts.ts";
export { type CommandScript, arbitraryScript, playScript } from "../../../../../packages/core/src/testing/arbitrary-commands.ts";
export * from "../../../../../packages/core/src/testing/facts-builder.ts";

export interface TestDatabase {
  readonly db: Db;
  readonly file: string;
  readonly key: DataKey;
  /** Closes the connection and opens the same file again, as a restart would. */
  reopen(): Db;
  dispose(): void;
}

const folders: string[] = [];

/** A real encrypted database in a temporary folder, with every shipped migration applied. */
export function testDatabase(options: { migrated?: boolean; parent?: string } = {}): TestDatabase {
  const folder = mkdtempSync(join(options.parent ?? tmpdir(), "holt-facts-"));
  folders.push(folder);
  const file = join(folder, "holt.db");
  const key = newDataKey();
  let current = openDatabase(file, key);
  if (options.migrated !== false) migrate(current);
  const handle: TestDatabase = {
    get db() {
      return current;
    },
    file,
    key,
    reopen() {
      current.close();
      current = openDatabase(file, key);
      return current;
    },
    dispose() {
      if (current.open) current.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
  return handle;
}

export function storeDeps(today = "2026-06-15", start = Date.parse("2026-06-15T09:00:00Z")): StoreDeps {
  let tick = 0;
  return { clock: { today: () => localDate(today) as LocalDate, now: () => new Date(start + tick++ * 1000) }, mint: createMint() };
}

/** The tables whose rows differ, empty when the facts are the same. Compares rows by value, so a Map's order doesn't count. */
export function differences(a: Facts, b: Facts): TableName[] {
  const left = tablesOf(a);
  const right = tablesOf(b);
  return tableNames.filter((name) => !rowsEqual(left[name], right[name]));
}

export type { Command };
