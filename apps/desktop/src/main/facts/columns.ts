/**
 * The one place that knows how a Facts row sits in SQLite: which column holds which field, and how a value
 * is bound and read back. It is typed over `TableName`, so a new Facts table fails to compile until it has
 * its columns, and over each row's keys, so a column can't name a field the row doesn't have. A test
 * compares it with `PRAGMA table_xinfo`, so the migration and this list can't drift apart.
 *
 * Reading goes through core's `TableSchemas`, so a row that breaks a rule never reaches the facts.
 */

import { type RowOf, type RuleMatch, type TableName, TableSchemas } from "@holt/core";
import type { z } from "zod";

export type SqlValue = string | number | null;

export interface Col<Field extends string = string> {
  /** Where the value sits in the row. A dot goes into a nested object. */
  readonly field: Field;
  readonly column: string;
  readonly sql: "text" | "integer" | "real";
  /** Part of the primary key, in the order listed. */
  readonly key?: true;
  /** A tagged union that only travels whole, stored as canonical JSON. */
  readonly json?: true;
  /** Stored as 0 or 1. */
  readonly bool?: true;
  /** The field may be absent, and then the column is NULL. */
  readonly optional?: true;
  /** The field may be null, and then the column is NULL. */
  readonly nullable?: true;
}

export interface TableDef<Field extends string = string> {
  readonly sql: string;
  readonly columns: readonly Col<Field>[];
}

type KeysOfUnion<U> = U extends unknown ? keyof U & string : never;
type FieldOf<T extends TableName> = KeysOfUnion<RowOf<T>> | (T extends "rules" ? `match.${keyof RuleMatch}` : never);

function table<T extends TableName>(_name: T, sql: string, columns: readonly Col<FieldOf<T>>[]): TableDef<FieldOf<T>> {
  return { sql, columns };
}

type Flags = Pick<Col, "key" | "optional" | "nullable">;
const text = <F extends string>(field: F, column: string, flags: Flags = {}): Col<F> => ({ field, column, sql: "text", ...flags });
const int = <F extends string>(field: F, column: string, flags: Flags = {}): Col<F> => ({ field, column, sql: "integer", ...flags });
const real = <F extends string>(field: F, column: string, flags: Flags = {}): Col<F> => ({ field, column, sql: "real", ...flags });
const bool = <F extends string>(field: F, column: string, flags: Flags = {}): Col<F> => ({ field, column, sql: "integer", bool: true, ...flags });
const json = <F extends string>(field: F, column: string, flags: Flags = {}): Col<F> => ({ field, column, sql: "text", json: true, ...flags });

const key = { key: true } as const;
const optional = { optional: true } as const;
const nullable = { nullable: true } as const;

export const columns = {
  household: table("household", "household", [
    text("id", "id", key),
    text("name", "name"),
    text("currency", "currency"),
    text("planStart", "plan_start"),
    int("evenOutStep", "even_out_step"),
  ]),
  accounts: table("accounts", "accounts", [
    text("id", "id", key),
    text("name", "name"),
    text("kind", "kind"),
    text("scope", "scope"),
    int("openingBalance", "opening_balance"),
    text("openingDate", "opening_date"),
    text("number", "number", optional),
    text("importRhythm", "import_rhythm", optional),
  ]),
  groups: table("groups", "groups", [text("id", "id", key), text("name", "name"), int("order", "position"), bool("countsTowardsSavingsRate", "counts_towards_savings_rate")]),
  jobs: table("jobs", "jobs", [
    text("id", "id", key),
    text("name", "name"),
    text("groupId", "group_id"),
    text("status", "status"),
    text("accountId", "account_id"),
    bool("essential", "essential"),
    int("opening", "opening"),
    text("kind", "kind"),
    bool("keepsMoney", "keeps_money", optional),
    json("plan", "plan", optional),
    text("seasonality", "seasonality", optional),
    text("role", "role", optional),
    json("target", "target", optional),
    int("monthly", "monthly", optional),
    text("payInto", "pay_into", optional),
  ]),
  budgetMonths: table("budgetMonths", "budget_months", [text("month", "month", key), text("state", "state")]),
  assignments: table("assignments", "assignments", [text("month", "month", key), text("jobId", "job_id", key), int("amount", "amount")]),
  transactions: table("transactions", "transactions", [
    text("id", "id", key),
    text("accountId", "account_id"),
    text("bookingDate", "booking_date"),
    int("amount", "amount"),
    text("description", "description"),
    json("treatment", "treatment"),
    text("counterparty", "counterparty", optional),
    text("transactionDate", "transaction_date", optional),
    text("reference", "reference", optional),
    text("note", "note", optional),
    text("ruleId", "rule_id", optional),
  ]),
  moves: table("moves", "moves", [
    text("id", "id", key),
    text("from", "from_account"),
    text("to", "to_account"),
    int("amount", "amount"),
    text("month", "month"),
    text("reason", "reason"),
    text("status", "status"),
    text("completedBy", "completed_by", nullable),
  ]),
  enteredValues: table("enteredValues", "entered_values", [
    text("id", "id", key),
    text("kind", "kind"),
    text("subject", "subject"),
    real("value", "value"),
    text("unit", "unit"),
    text("asOf", "as_of"),
    text("source", "source"),
  ]),
  importBatches: table("importBatches", "import_batches", [
    text("id", "id", key),
    text("fileName", "file_name"),
    text("fingerprint", "fingerprint"),
    text("format", "format"),
    text("importedAt", "imported_at"),
    text("from", "from_date"),
    text("to", "to_date"),
    int("rows", "row_count"),
    int("created", "created"),
    int("matched", "matched"),
    int("pending", "pending"),
    bool("undone", "undone"),
  ]),
  importRows: table("importRows", "import_rows", [
    text("id", "id", key),
    text("batchId", "batch_id"),
    int("line", "line"),
    text("accountId", "account_id"),
    text("bookingDate", "booking_date"),
    text("interestDate", "interest_date", optional),
    text("description", "description"),
    int("amount", "amount"),
    text("counterpartAccount", "counterpart_account", optional),
    text("counterpartName", "counterpart_name", optional),
    text("reference", "reference", optional),
    text("bankType", "bank_type", optional),
    json("original", "original", optional),
    text("fingerprint", "fingerprint"),
    bool("pending", "pending"),
    text("backs", "backs", nullable),
  ]),
  rules: table("rules", "rules", [
    text("id", "id", key),
    text("match.counterparty", "counterparty"),
    text("match.accountId", "account_id", optional),
    int("match.min", "min_amount", optional),
    int("match.max", "max_amount", optional),
    json("result", "result"),
    text("origin", "origin"),
    int("priority", "priority"),
  ]),
  people: table("people", "people", [text("id", "id", key), text("name", "name"), text("kind", "kind"), text("birthMonth", "birth_month", optional)]),
  contributionAgreements: table("contributionAgreements", "contribution_agreements", [
    text("id", "id", key),
    text("personId", "person_id"),
    text("accountId", "account_id"),
    int("amount", "amount"),
    int("day", "day"),
    text("from", "from_month"),
    text("to", "to_month", optional),
  ]),
  bucketTransfers: table("bucketTransfers", "bucket_transfers", [
    text("id", "id", key),
    text("month", "month"),
    text("from", "from_job"),
    text("to", "to_job"),
    int("amount", "amount"),
    text("reason", "reason"),
  ]),
} as const satisfies { readonly [T in TableName]: TableDef<FieldOf<T>> };

const defs: Readonly<Record<TableName, TableDef>> = columns;

/** The change log's own columns. Its rows are not Facts, so they have no fields; `changes.ts` reads them by name. */
export const changeLogColumns: readonly Col[] = [
  int("seq", "seq", key),
  text("id", "id"),
  text("at", "at"),
  text("kind", "kind"),
  json("by", "author"),
  json("command", "command"),
  json("patch", "patch"),
  text("status", "status"),
];

// ── Values ───────────────────────────────────────────────────────────────────

/** JSON with every object's keys in order, so the same value is always the same text and a column can be compared by its text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

function read(row: object, field: string): unknown {
  let value: unknown = row;
  for (const part of field.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function write(target: Record<string, unknown>, field: string, value: unknown): void {
  const parts = field.split(".");
  const last = parts.pop() as string;
  let at = target;
  for (const part of parts) at = (at[part] ??= {}) as Record<string, unknown>;
  at[last] = value;
}

function encode(col: Col, value: unknown): SqlValue {
  if (col.json === true) return canonicalJson(value);
  if (col.bool === true) return value === true ? 1 : 0;
  return value as SqlValue;
}

function decode(col: Col, raw: unknown): unknown {
  if (col.json === true) return JSON.parse(raw as string);
  // Anything but 0 or 1 stays as it is, so the row schema refuses it.
  if (col.bool === true) return raw === 1 ? true : raw === 0 ? false : raw;
  return raw;
}

/** The row as column values, by column name. An absent or null field is NULL. */
export function bind(name: TableName, row: object): Record<string, SqlValue> {
  const bound: Record<string, SqlValue> = {};
  for (const col of defs[name].columns) {
    const value = read(row, col.field);
    bound[col.column] = value === undefined || value === null ? null : encode(col, value);
  }
  return bound;
}

/** A row read from SQLite, checked by core's schema for its table. Throws if the row breaks a rule. */
export function parseRow<T extends TableName>(name: T, sqlRow: Readonly<Record<string, unknown>>): RowOf<T> {
  const object: Record<string, unknown> = {};
  for (const col of defs[name].columns) {
    const raw = sqlRow[col.column];
    if (raw === null || raw === undefined) {
      if (col.nullable === true) write(object, col.field, null);
      continue;
    }
    write(object, col.field, decode(col, raw));
  }
  return (TableSchemas[name] as z.ZodType).parse(object) as RowOf<T>;
}

// ── Statements ───────────────────────────────────────────────────────────────

export interface TableSql {
  readonly selectAll: string;
  readonly insert: string;
  /** Sets the new values where the key and every old value match, so a row changed behind the store's back matches nothing. */
  readonly update: string;
  readonly delete: string;
}

const list = (cols: readonly Col[], pick: (c: Col) => string, glue = ", "): string => cols.map(pick).join(glue);

export function sqlFor(name: TableName): TableSql {
  const { sql, columns: cols } = defs[name];
  const keys = cols.filter((c) => c.key === true);
  const rest = cols.filter((c) => c.key !== true);
  const where = `${list(keys, (c) => `${c.column} = ?`, " and ")} and ${list(rest, (c) => `${c.column} is ?`, " and ")}`;
  return {
    selectAll: `select ${list(cols, (c) => c.column)} from ${sql} order by ${list(keys, (c) => c.column)}`,
    insert: `insert into ${sql} (${list(cols, (c) => c.column)}) values (${list(cols, () => "?")})`,
    update: `update ${sql} set ${list(rest, (c) => `${c.column} = ?`)} where ${where}`,
    delete: `delete from ${sql} where ${where}`,
  };
}

function values(name: TableName, bound: Readonly<Record<string, SqlValue>>, part: "all" | "key" | "rest"): SqlValue[] {
  return defs[name].columns.filter((c) => part === "all" || (part === "key") === (c.key === true)).map((c) => bound[c.column] as SqlValue);
}

export function insertParams(name: TableName, row: object): SqlValue[] {
  return values(name, bind(name, row), "all");
}

export function updateParams(name: TableName, before: object, after: object): SqlValue[] {
  const was = bind(name, before);
  return [...values(name, bind(name, after), "rest"), ...values(name, was, "key"), ...values(name, was, "rest")];
}

export function deleteParams(name: TableName, before: object): SqlValue[] {
  const was = bind(name, before);
  return [...values(name, was, "key"), ...values(name, was, "rest")];
}
