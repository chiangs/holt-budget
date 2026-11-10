/**
 * The family's facts: SQLite is the durable copy and this store is the only writer. `run` applies a command
 * with core's `commit` against an empty log, then writes the patch's rows and the change record in one
 * `BEGIN IMMEDIATE` transaction, and only after that commits swaps the facts in memory. A crash leaves the
 * old state or the new state, never a mix. The log has no copy in memory (see `changes.ts`), so what must
 * stay equal between memory and disk is the facts, and every write checks the rows it replaces.
 */

import {
  type ChangeAuthor,
  type Command,
  type Facts,
  type LocalDate,
  type Patch,
  type RowChange,
  type StoredChange,
  StoredChangeSchema,
  type TableName,
  type Tables,
  commit,
  emptyChangeLog,
  factsOf,
  invertPatch,
  redo,
  tableNames,
  tablesOf,
  undo,
} from "@holt/core";
import type Database from "better-sqlite3-multiple-ciphers";
import type { IdMint } from "../../shared/ids.ts";
import type { RunResult, Snapshot, StepDirection } from "../../shared/ledger-types.ts";
import type { Db } from "../storage/database.ts";
import { type ChangeLogStore, openChangeLog, summaryOf } from "./changes.ts";
import { type SqlValue, deleteParams, insertParams, parseRow, sqlFor, updateParams } from "./columns.ts";
import { HouseholdExistsError, StoreDivergence, UnstorableChangeError } from "./errors.ts";

export { HouseholdExistsError, StoreDivergence, UnstorableChangeError } from "./errors.ts";

export interface StoreDeps {
  readonly clock: { today(): LocalDate; now(): Date };
  /** Makes the IDs of change records. */
  readonly mint: IdMint;
}

export interface FactsStore {
  /** Counts the changes this process has made. A page that holds a replica compares it to see if it missed one. */
  readonly revision: number;
  snapshot(): Snapshot;
  /** For code in the main process that reads the facts. Never write through it. */
  facts(): Facts;
  /** Applies the command, writes the rows and the change record in one transaction, then swaps the facts. The author is the family unless main says otherwise. */
  run(command: Command, by?: ChangeAuthor): RunResult;
  /** Undoes the newest change or redoes the one undone last, from the stored record. */
  step(direction: StepDirection): RunResult;
}

type Statement = Database.Statement<SqlValue[]>;
interface TableStatements {
  readonly selectAll: Statement;
  readonly insert: Statement;
  readonly update: Statement;
  readonly delete: Statement;
}
export type Statements = { readonly [T in TableName]: TableStatements };

export function prepareStatements(db: Db): Statements {
  const prepare = (sql: string): Statement => db.prepare<SqlValue[]>(sql);
  const entries = tableNames.map((name) => {
    const sql = sqlFor(name);
    return [name, { selectAll: prepare(sql.selectAll), insert: prepare(sql.insert), update: prepare(sql.update), delete: prepare(sql.delete) }] as const;
  });
  return Object.fromEntries(entries) as Statements;
}

function expectOne(changes: number, change: RowChange): void {
  if (changes !== 1) throw new StoreDivergence(change.table, change.key);
}

/**
 * Writes the rows of a patch. Deletes go first, then updates, then inserts, so a value one row gives up
 * (an account number, a live file fingerprint) is free for the row that takes it, whatever order the patch
 * lists them in. Each update and delete must find exactly the row the patch expects.
 */
export function writePatch(statements: Statements, patch: Patch): void {
  const deletes: RowChange[] = [];
  const updates: RowChange[] = [];
  const inserts: RowChange[] = [];
  for (const change of patch) (change.before === null ? inserts : change.after === null ? deletes : updates).push(change);
  for (const change of deletes) expectOne(statements[change.table].delete.run(...deleteParams(change.table, change.before as object)).changes, change);
  for (const change of updates) expectOne(statements[change.table].update.run(...updateParams(change.table, change.before as object, change.after as object)).changes, change);
  for (const change of inserts) statements[change.table].insert.run(...insertParams(change.table, change.after as object));
}

function loadFacts(statements: Statements): Facts {
  const tables = Object.fromEntries(tableNames.map((name) => [name, (statements[name].selectAll.all() as Record<string, unknown>[]).map((row) => parseRow(name, row))]));
  return factsOf(tables as unknown as Tables);
}

function hasHousehold(db: Db): boolean {
  return (db.prepare("select exists (select 1 from household) as present").get() as { present: number }).present === 1;
}

/** Deferred foreign keys are only a wall when foreign keys are on, and a commit is only as safe as its sync. */
function makeSafe(db: Db): void {
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = FULL");
}

/** The store over the facts in `db`, or null when no household exists yet. Throws if a stored row breaks a rule. */
export function openFactsStore(db: Db, deps: StoreDeps): FactsStore | null {
  if (!hasHousehold(db)) return null;
  makeSafe(db);
  const statements = prepareStatements(db);
  return makeStore(db, statements, loadFacts(statements), deps);
}

/**
 * The first population, in one transaction: what the development seed and Setup use. Throws if a household
 * exists. The store holds the facts as the database gives them back, so memory is what a reopen would load.
 */
export function createFactsStore(db: Db, initial: Facts, deps: StoreDeps): FactsStore {
  if (initial.household.size !== 1) throw new Error("The first population needs exactly one household.");
  makeSafe(db);
  const statements = prepareStatements(db);
  const tables = tablesOf(initial);
  db.transaction(() => {
    if (hasHousehold(db)) throw new HouseholdExistsError();
    for (const name of tableNames) for (const row of tables[name]) statements[name].insert.run(...insertParams(name, row));
  }).immediate();
  return makeStore(db, statements, loadFacts(statements), deps);
}

function makeStore(db: Db, statements: Statements, initial: Facts, deps: StoreDeps): FactsStore {
  const log: ChangeLogStore = openChangeLog(db);
  let facts = initial;
  let revision = 0;

  function applied(patch: Patch, record: StoredChange, today: LocalDate): RunResult {
    const base = revision;
    revision += 1;
    return { status: "applied", base, revision, today, patch, change: summaryOf(record), head: log.heads() };
  }

  return {
    get revision() {
      return revision;
    },
    snapshot: () => ({ revision, today: deps.clock.today(), tables: tablesOf(facts), head: log.heads() }),
    facts: () => facts,

    run(command, by = { kind: "family" }) {
      const today = deps.clock.today();
      const meta = { id: deps.mint("change"), at: deps.clock.now().toISOString(), by };
      const result = commit(facts, emptyChangeLog(), command, meta, { asOf: today });
      if (!result.ok) return { status: "refused", refusal: result.refusal };
      // What is written must read back, or the next start fails on a row and undo fails on the record, which then blocks every older change.
      const readable = StoredChangeSchema.safeParse(result.record);
      if (!readable.success) throw new UnstorableChangeError(readable.error);
      db.transaction(() => {
        writePatch(statements, result.record.patch);
        log.discardUndone();
        log.append(result.record);
      }).immediate();
      facts = result.facts;
      return applied(result.record.patch, result.record, today);
    },

    step(direction) {
      const top = log.top(direction === "undo" ? "done" : "undone");
      if (top === null) return { status: "conflict", conflict: { kind: direction === "undo" ? "nothingToUndo" : "nothingToRedo" } };
      const result = direction === "undo" ? undo(facts, { done: [top.record], undone: [] }) : redo(facts, { done: [], undone: [top.record] });
      if (!result.ok) return { status: "conflict", conflict: result.conflict };
      const patch = direction === "undo" ? invertPatch(top.record.patch) : top.record.patch;
      db.transaction(() => {
        writePatch(statements, patch);
        if (direction === "undo") log.move(top.seq, "done", "undone");
        else log.move(top.seq, "undone", "done");
      }).immediate();
      facts = result.facts;
      return applied(patch, top.record, deps.clock.today());
    },
  };
}
