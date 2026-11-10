/**
 * A patch is the list of rows a change touched, each with the row before and after. Applying it needs
 * every row to still match its `before`, so a patch never overwrites something that changed since.
 */

import { type Facts, type KeyOf, type RowOf, type TableName, keyOfRow, tableNames } from "./facts.ts";

export type RowChange = {
  readonly [T in TableName]: {
    readonly table: T;
    readonly key: KeyOf<T>;
    /** Null means the row did not exist: the change inserts it. */
    readonly before: RowOf<T> | null;
    /** Null means the row no longer exists: the change deletes it. */
    readonly after: RowOf<T> | null;
  };
}[TableName];

export type Patch = readonly RowChange[];

/** A row that was not as the patch expected. */
export interface RowMismatch {
  readonly table: TableName;
  readonly key: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export class PatchConflict extends Error {
  override name = "PatchConflict";
  readonly mismatches: readonly RowMismatch[];
  constructor(mismatches: readonly RowMismatch[]) {
    super(`${mismatches.length} row(s) no longer match: ${mismatches.map((m) => `${m.table}/${m.key}`).join(", ")}`);
    this.mismatches = mismatches;
  }
}

type LooseTable = Map<string, unknown>;

function looseTable(facts: Facts, table: TableName): ReadonlyMap<string, unknown> {
  return facts[table] as ReadonlyMap<string, unknown>;
}

/** Structural equality for plain rows. Brands are types only, so they never take part. */
export function rowsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => rowsEqual(x, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((k) => Object.hasOwn(right, k) && rowsEqual(left[k], right[k]));
}

export type PatchResult =
  | { readonly ok: true; readonly facts: Facts }
  | { readonly ok: false; readonly mismatches: readonly RowMismatch[] };

/**
 * A private copy of the facts that patches apply to one after another. A table is copied the first time a
 * patch touches it and changed in place after that, so many patches cost the rows they change plus one copy
 * of each table they touch, not a copy of the table for every patch.
 */
export interface PatchBuilder {
  /** Applies the changes in order, each checked against the rows as earlier changes left them. Returns the rows that were not as the patch expected. After any, the builder holds a half-applied patch and is only to be dropped. */
  apply(patch: Patch): RowMismatch[];
  /** The facts so far. The tables the patches never touched are the ones the builder started from. */
  facts(): Facts;
}

export function patchBuilder(start: Facts): PatchBuilder {
  const copies = new Map<TableName, LooseTable>();
  return {
    apply(patch) {
      const mismatches: RowMismatch[] = [];
      for (const change of patch) {
        let table = copies.get(change.table);
        if (table === undefined) {
          table = new Map(looseTable(start, change.table));
          copies.set(change.table, table);
        }
        const actual = table.get(change.key) ?? null;
        if (!rowsEqual(actual, change.before)) {
          mismatches.push({ table: change.table, key: change.key, expected: change.before, actual });
          continue;
        }
        if (change.after === null) table.delete(change.key);
        else table.set(change.key, change.after);
      }
      return mismatches;
    },
    facts: () => ({ ...start, ...Object.fromEntries(copies) }) as Facts,
  };
}

/** Apply a patch without throwing. Changes apply in order, each checked against the rows as earlier changes left them. */
export function tryApplyPatch(facts: Facts, patch: Patch): PatchResult {
  const builder = patchBuilder(facts);
  const mismatches = builder.apply(patch);
  return mismatches.length > 0 ? { ok: false, mismatches } : { ok: true, facts: builder.facts() };
}

/** Returns new facts and leaves the input alone. Throws a `PatchConflict` naming every row that does not match. */
export function applyPatch(facts: Facts, patch: Patch): Facts {
  const result = tryApplyPatch(facts, patch);
  if (!result.ok) throw new PatchConflict(result.mismatches);
  return result.facts;
}

export function invertPatch(patch: Patch): Patch {
  return patch
    .map((c) => ({ ...c, before: c.after, after: c.before }) as RowChange)
    .reverse();
}

/** The patch that turns `before` into `after`. */
export function diffFacts(before: Facts, after: Facts): Patch {
  const changes: RowChange[] = [];
  for (const table of tableNames) {
    const was = looseTable(before, table);
    const now = looseTable(after, table);
    for (const [key, row] of was) {
      const next = now.get(key) ?? null;
      if (!rowsEqual(row, next)) changes.push({ table, key, before: row, after: next } as RowChange);
    }
    for (const [key, row] of now) {
      if (!was.has(key)) changes.push({ table, key, before: null, after: row } as RowChange);
    }
  }
  return changes;
}

export interface FactsEditor {
  /** Insert the row, or replace the row with the same key. Putting a row equal to the existing one changes nothing. */
  put<T extends TableName>(table: T, row: RowOf<T>): FactsEditor;
  /** Delete the row. Removing a row that is not there changes nothing. */
  remove<T extends TableName>(table: T, key: KeyOf<T>): FactsEditor;
  /** The changes made so far, against the facts the editor started from. */
  patch(): Patch;
}

export function editFacts(facts: Facts): FactsEditor {
  const changes: RowChange[] = [];
  const touched = new Set<string>();

  function claim(table: TableName, key: string): void {
    const id = `${table}\u0000${key}`;
    if (touched.has(id)) throw new Error(`Two changes to one row: ${table}/${key}`);
    touched.add(id);
  }

  const editor: FactsEditor = {
    put(table, row) {
      const key = keyOfRow(table, row);
      claim(table, key);
      const existing = looseTable(facts, table).get(key) ?? null;
      if (!rowsEqual(existing, row)) changes.push({ table, key, before: existing, after: row } as RowChange);
      return editor;
    },
    remove(table, key) {
      claim(table, key);
      const existing = looseTable(facts, table).get(key) ?? null;
      if (existing !== null) changes.push({ table, key, before: existing, after: null } as RowChange);
      return editor;
    },
    patch: () => [...changes],
  };
  return editor;
}
