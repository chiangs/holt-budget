/**
 * What the import and handler tests share: the invented household in a real encrypted database, an `Imports`
 * over it with a fake dialog and fake files, and a way to compare the whole database before and after.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AccountId, type Facts, type JobId, type LocalDate, localDate } from "@holt/core";
import { type IdMint, createMint } from "../../shared/ids.ts";
import type { Clock } from "../clock.ts";
import { seedHousehold, syntheticBankFiles } from "../dev/household.ts";
import { type FactsStore, createFactsStore } from "../facts/index.ts";
import { type Db, openDatabase } from "../storage/database.ts";
import { newDataKey } from "../storage/keys.ts";
import { migrate } from "../storage/migrations.ts";
import type { FileRead } from "./files.ts";
import { type Imports, createImports } from "./imports.ts";

export const today: LocalDate = localDate("2026-11-10");

export const clock: Clock = { today: () => today, now: () => new Date("2026-11-10T09:30:00.000Z") };

export interface Rig {
  readonly db: Db;
  readonly store: FactsStore;
  readonly mint: IdMint;
  readonly imports: Imports;
  /** Every synthetic bank export for the household, by file name. */
  readonly bytes: (name: string) => Uint8Array;
  readonly text: (name: string) => string;
  /** The path the fake dialog returns next, and what a read of it gives. `null` is a cancel. */
  readonly choose: (path: string | null, read?: FileRead) => void;
  /** How many times the after-import hook ran. */
  readonly hookRuns: () => number;
  /** Every row of every table, so two states can be compared exactly. */
  readonly dump: () => string;
  readonly facts: () => Facts;
  readonly account: (name: string) => AccountId;
  readonly job: (name: string) => JobId;
  /** Another `Imports` over the same store, as a second window would be. */
  readonly another: () => Imports;
  readonly dispose: () => void;
}

const files = syntheticBankFiles(today);
const encoder = new TextEncoder();

export function createRig(options: { readonly afterImport?: () => void } = {}): Rig {
  const dir = mkdtempSync(join(tmpdir(), "holt-imports-"));
  const db = openDatabase(join(dir, "holt.db"), newDataKey());
  migrate(db);
  const mint = createMint();
  const store = createFactsStore(db, seedHousehold(today), { clock, mint });

  let next: { path: string | null; read: FileRead | undefined } = { path: null, read: undefined };
  let hooks = 0;
  const deps = {
    clock,
    mint,
    pickFile: async () => next.path,
    readFile: async (): Promise<FileRead> => next.read ?? { kind: "unreadable", reason: "missing" },
    afterImport: () => {
      hooks += 1;
      options.afterImport?.();
    },
  };
  const named = (name: string) => {
    const file = files.find((f) => f.name === name);
    if (file === undefined) throw new Error(`No synthetic file called ${name}`);
    return file;
  };

  return {
    db,
    store,
    mint,
    imports: createImports(store, deps),
    bytes: (name) => encoder.encode(named(name).text),
    text: (name) => named(name).text,
    choose: (path, read) => {
      next = { path, read };
    },
    hookRuns: () => hooks,
    dump: () => {
      const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[];
      return JSON.stringify(tables.map(({ name }) => [name, db.prepare(`select * from "${name}" order by rowid`).all()]));
    },
    facts: () => store.facts(),
    account: (name) => {
      const found = [...store.facts().accounts.values()].find((a) => a.name === name);
      if (found === undefined) throw new Error(`No account called ${name}`);
      return found.id;
    },
    job: (name) => {
      const found = [...store.facts().jobs.values()].find((j) => j.name === name);
      if (found === undefined) throw new Error(`No job called ${name}`);
      return found.id;
    },
    another: () => createImports(store, deps),
    dispose: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
