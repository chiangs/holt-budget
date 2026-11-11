import { type TableName, TableSchemas, tableNames } from "@holt/core";
import { afterEach, describe, expect, it } from "vitest";
import { type Col, bind, canonicalJson, changeLogColumns, columns, parseRow, sqlFor } from "./columns.ts";
import { factsBuilder, kr, testDatabase } from "./test-support.ts";

let database: ReturnType<typeof testDatabase> | undefined;
afterEach(() => database?.dispose());

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  hidden: number;
}

const describeColumns = (cols: readonly Col[]): Record<string, { type: string; notnull: number; pk: number }> =>
  Object.fromEntries(
    cols.map((c) => [
      c.column,
      { type: c.sql.toUpperCase(), notnull: c.key === true || (c.optional !== true && c.nullable !== true) ? 1 : 0, pk: c.key === true ? cols.filter((k) => k.key === true).indexOf(c) + 1 : 0 },
    ]),
  );

const actualColumns = (table: string): Record<string, { type: string; notnull: number; pk: number }> =>
  Object.fromEntries((database!.db.pragma(`table_xinfo(${table})`) as ColumnInfo[]).map((c) => [c.name, { type: c.type, notnull: c.notnull, pk: c.pk }]));

describe("P6: the column registry is the migration's tables", () => {
  it.each(tableNames)("%s has the same columns, types, nullability and key as PRAGMA table_xinfo", (name) => {
    database = testDatabase();
    expect(actualColumns(columns[name].sql)).toEqual(describeColumns(columns[name].columns));
  });

  it("covers the change log's table too", () => {
    database = testDatabase();
    expect(actualColumns("changes")).toEqual(describeColumns(changeLogColumns));
  });

  it("leaves no table in the database without columns", () => {
    database = testDatabase();
    const names = (database.db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual([...tableNames.map((t) => columns[t].sql), "changes"].sort());
  });

  /** The keys a row schema accepts, through a transform (`.in`) and across the variants of a union (`.options`). */
  function keysOf(schema: unknown): string[] {
    const s = schema as { options?: unknown[]; shape?: Record<string, unknown>; in?: unknown };
    if (s.options !== undefined) return s.options.flatMap(keysOf);
    if (s.shape !== undefined) return Object.keys(s.shape);
    if (s.in !== undefined) return keysOf(s.in);
    throw new Error("The test can't read the keys of this schema");
  }

  it.each(tableNames)("%s: every key of its row schema has a column, and every column has a key", (name) => {
    const schemaKeys = new Set(keysOf(TableSchemas[name]));
    const fieldRoots = new Set(columns[name].columns.map((c) => c.field.split(".")[0]));
    expect([...schemaKeys].sort()).toEqual([...fieldRoots].sort());
    // A nested field names a key the schema's own object has, such as a rule's match.
    for (const col of columns[name].columns.filter((c) => c.field.includes("."))) {
      const [root, leaf] = col.field.split(".") as [string, string];
      const nested = (TableSchemas[name] as unknown as { shape: Record<string, { shape?: Record<string, unknown> }> }).shape[root]?.shape;
      expect(Object.keys(nested ?? {}), col.field).toContain(leaf);
    }
  });

  // A round trip can't see two columns that swap fields, because what goes in one comes out of the same one. A column says what it holds
  // by its name, so each is the field's name in snake case unless it is one of these, which are renamed because the field's name is an SQL keyword or too short to say what it is.
  const renamed: Record<string, string> = {
    "groups.order": "position",
    "moves.from": "from_account",
    "moves.to": "to_account",
    "importBatches.from": "from_date",
    "importBatches.to": "to_date",
    "importBatches.rows": "row_count",
    "rules.match.counterparty": "counterparty",
    "rules.match.accountId": "account_id",
    "rules.match.min": "min_amount",
    "rules.match.max": "max_amount",
    "contributionAgreements.from": "from_month",
    "contributionAgreements.to": "to_month",
    "bucketTransfers.from": "from_job",
    "bucketTransfers.to": "to_job",
  };
  const snake = (field: string): string => field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

  it("names each column for the field it holds", () => {
    for (const name of tableNames) {
      for (const col of columns[name].columns) expect(col.column, `${name}.${col.field}`).toBe(renamed[`${name}.${col.field}`] ?? snake(col.field));
    }
  });

  it("gives every column a distinct name within its table", () => {
    for (const name of tableNames) {
      const names = columns[name].columns.map((c) => c.column);
      expect(new Set(names).size, name).toBe(names.length);
      const fields = columns[name].columns.map((c) => c.field);
      expect(new Set(fields).size, name).toBe(fields.length);
    }
  });
});

describe("every foreign key is deferrable and initially deferred", () => {
  it("in the shipped DDL, so a patch applies in any order and the database checks at commit", () => {
    database = testDatabase();
    const ddl = (database.db.prepare("select name, sql from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string; sql: string }[]).map((t) => ({
      table: t.name,
      references: (t.sql.match(/\breferences\b/gi) ?? []).length,
      deferred: (t.sql.match(/deferrable initially deferred/gi) ?? []).length,
    }));
    expect(ddl.filter((t) => t.references !== t.deferred)).toEqual([]);
    const declared = ddl.reduce((n, t) => n + (database!.db.pragma(`foreign_key_list(${t.table})`) as unknown[]).length, 0);
    expect(declared).toBeGreaterThan(0);
    expect(ddl.reduce((n, t) => n + t.deferred, 0)).toBe(declared);
  });
});

describe("indexes under the foreign keys of rows that can be deleted", () => {
  // Deleting a transaction, a job or a rule makes SQLite look for rows that refer to it. Without an index that is a scan of the child table for each deletion.
  it.each([
    ["import_rows", "backs"],
    ["moves", "completed_by"],
    ["assignments", "job_id"],
    ["transactions", "rule_id"],
    ["contribution_agreements", "person_id"],
    ["contribution_agreements", "account_id"],
    ["bucket_transfers", "from_job"],
    ["bucket_transfers", "to_job"],
  ])("%s.%s leads an index", (table, column) => {
    database = testDatabase();
    const leaders = (database.db.pragma(`index_list(${table})`) as { name: string }[]).map((index) => (database!.db.pragma(`index_info(${index.name})`) as { seqno: number; name: string }[]).find((c) => c.seqno === 0)?.name);
    expect(leaders).toContain(column);
  });
});

describe("every column that holds a foreign key leads an index", () => {
  // The four indexes above are the ones a deletion needs today. For the tables of Milestone 4, every child column of a foreign key leads an index, so a later delete command can't turn into a scan.
  it.each(["people", "contribution_agreements", "bucket_transfers"])("in %s", (table) => {
    database = testDatabase();
    const leaders = new Set((database.db.pragma(`index_list(${table})`) as { name: string }[]).map((index) => (database!.db.pragma(`index_info(${index.name})`) as { seqno: number; name: string }[]).find((c) => c.seqno === 0)?.name));
    const children = (database.db.pragma(`foreign_key_list(${table})`) as { from: string }[]).map((fk) => fk.from);
    expect(children.filter((column) => !leaders.has(column))).toEqual([]);
  });

  it("finds the foreign keys of the new tables", () => {
    database = testDatabase();
    const children = (table: string) => (database!.db.pragma(`foreign_key_list(${table})`) as { from: string; table: string }[]).map((fk) => `${fk.from}>${fk.table}`).sort();
    expect(children("contribution_agreements")).toEqual(["account_id>accounts", "person_id>people"]);
    expect(children("bucket_transfers")).toEqual(["from_job>jobs", "to_job>jobs"]);
    expect(children("people")).toEqual([]);
  });
});

describe("binding and reading rows", () => {
  it("writes absent optional fields as NULL, and null fields as NULL", () => {
    const b = factsBuilder();
    const account = b.account();
    const bound = bind("accounts", b.facts().accounts.get(account)!);
    expect(bound.number).toBeNull();
    expect(bound.import_rhythm).toBeNull();
    const move = bind("moves", { id: "m", from: "a", to: "b", amount: 1, month: "2026-03", reason: "r", status: "todo", completedBy: null });
    expect(move.completed_by).toBeNull();
  });

  it("writes the new rows' fields to the columns they are named for, so no two columns can swap", () => {
    expect(bind("bucketTransfers", { id: "t", month: "2026-11", from: "job-a", to: "job-b", amount: 410_000, reason: "Start" })).toEqual({
      id: "t",
      month: "2026-11",
      from_job: "job-a",
      to_job: "job-b",
      amount: 410_000,
      reason: "Start",
    });
    expect(bind("contributionAgreements", { id: "a", personId: "p", accountId: "acc", amount: 900_000, day: 20, from: "2026-10" })).toEqual({
      id: "a",
      person_id: "p",
      account_id: "acc",
      amount: 900_000,
      day: 20,
      from_month: "2026-10",
      to_month: null,
    });
    expect(bind("people", { id: "p", name: "Mia", kind: "child", birthMonth: "2018-04" })).toEqual({ id: "p", name: "Mia", kind: "child", birth_month: "2018-04" });
  });

  it("writes booleans as 0 or 1 and unions as JSON with sorted keys", () => {
    const bound = bind("groups", { id: "g", name: "n", order: 3, countsTowardsSavingsRate: true });
    expect(bound).toEqual({ id: "g", name: "n", position: 3, counts_towards_savings_rate: 1 });
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("reads a row back through core's schema, restoring brands, optional keys and a split", () => {
    const b = factsBuilder();
    const job = b.buffer({ monthly: kr(10) });
    const id = b.spend({ date: "2026-03-05", amount: kr(-5), jobId: job });
    const row = b.facts().transactions.get(id)!;
    const parsed = parseRow("transactions", { ...bind("transactions", row) });
    expect(parsed).toEqual(row);
    expect("note" in parsed).toBe(false);
  });

  it("refuses a row whose columns break a rule", () => {
    const row = bind("household", { id: "00000000-0000-7000-8000-000000000001", name: "Home", currency: "NOK", planStart: "2026-01", evenOutStep: 5000 });
    expect(() => parseRow("household", { ...row, currency: "nok" })).toThrow();
    expect(() => parseRow("household", { ...row, id: "not an id" })).toThrow();
    expect(() => parseRow("household", { ...row, even_out_step: 1.5 })).toThrow();
    expect(() => parseRow("household", { ...row, name: null })).toThrow();
  });

  it("refuses a boolean column that holds neither 0 nor 1", () => {
    const row = bind("groups", { id: "00000000-0000-7000-8000-000000000001", name: "n", order: 0, countsTowardsSavingsRate: false });
    expect(() => parseRow("groups", { ...row, counts_towards_savings_rate: 2 })).toThrow();
  });

  it("generates SQL that names every column once", () => {
    for (const name of tableNames) {
      const sql = sqlFor(name as TableName);
      const count = columns[name].columns.length;
      expect(sql.insert.match(/\?/g)).toHaveLength(count);
      const keys = columns[name].columns.filter((c) => c.key === true).length;
      expect(sql.update.match(/\?/g)).toHaveLength(count - keys + count);
      expect(sql.delete.match(/\?/g)).toHaveLength(count);
    }
  });
});
