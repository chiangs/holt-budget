/**
 * Facts as plain arrays, one per table, for the places that can't hold a `Map`: a snapshot sent to the page,
 * rows read from or written to the database. The rows come out in the order of their keys, so the same
 * facts always give the same arrays.
 */

import { type Facts, type KeyOf, type RowOf, type TableName, keyOfRow } from "./facts.ts";

export type Tables = { readonly [T in TableName]: readonly RowOf<T>[] };

export class DuplicateRowError extends Error {
  override name = "DuplicateRowError";
  readonly table: TableName;
  readonly key: string;
  constructor(table: TableName, key: string) {
    super(`${table} holds two rows with the key ${key}`);
    this.table = table;
    this.key = key;
  }
}

function rowsByKey<T extends TableName>(table: ReadonlyMap<KeyOf<T>, RowOf<T>>): readonly RowOf<T>[] {
  return [...table].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
}

function mapOfRows<T extends TableName>(name: T, rows: readonly RowOf<T>[]): ReadonlyMap<KeyOf<T>, RowOf<T>> {
  const map = new Map<KeyOf<T>, RowOf<T>>();
  for (const row of rows) {
    const key = keyOfRow(name, row);
    if (map.has(key)) throw new DuplicateRowError(name, key);
    map.set(key, row);
  }
  return map;
}

export function tablesOf(facts: Facts): Tables {
  return {
    household: rowsByKey<"household">(facts.household),
    accounts: rowsByKey<"accounts">(facts.accounts),
    groups: rowsByKey<"groups">(facts.groups),
    jobs: rowsByKey<"jobs">(facts.jobs),
    budgetMonths: rowsByKey<"budgetMonths">(facts.budgetMonths),
    assignments: rowsByKey<"assignments">(facts.assignments),
    transactions: rowsByKey<"transactions">(facts.transactions),
    moves: rowsByKey<"moves">(facts.moves),
    enteredValues: rowsByKey<"enteredValues">(facts.enteredValues),
    importBatches: rowsByKey<"importBatches">(facts.importBatches),
    importRows: rowsByKey<"importRows">(facts.importRows),
    rules: rowsByKey<"rules">(facts.rules),
    people: rowsByKey<"people">(facts.people),
    contributionAgreements: rowsByKey<"contributionAgreements">(facts.contributionAgreements),
    bucketTransfers: rowsByKey<"bucketTransfers">(facts.bucketTransfers),
  };
}

/** Rebuilds the facts. Throws a `DuplicateRowError` when two rows of a table have the same key. */
export function factsOf(tables: Tables): Facts {
  return {
    household: mapOfRows("household", tables.household),
    accounts: mapOfRows("accounts", tables.accounts),
    groups: mapOfRows("groups", tables.groups),
    jobs: mapOfRows("jobs", tables.jobs),
    budgetMonths: mapOfRows("budgetMonths", tables.budgetMonths),
    assignments: mapOfRows("assignments", tables.assignments),
    transactions: mapOfRows("transactions", tables.transactions),
    moves: mapOfRows("moves", tables.moves),
    enteredValues: mapOfRows("enteredValues", tables.enteredValues),
    importBatches: mapOfRows("importBatches", tables.importBatches),
    importRows: mapOfRows("importRows", tables.importRows),
    rules: mapOfRows("rules", tables.rules),
    people: mapOfRows("people", tables.people),
    contributionAgreements: mapOfRows("contributionAgreements", tables.contributionAgreements),
    bucketTransfers: mapOfRows("bucketTransfers", tables.bucketTransfers),
  };
}
