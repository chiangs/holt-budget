import { afterEach, describe, expect, it } from "vitest";
import { currentVersion, latestVersion, loadMigrations, migrate } from "../storage/migrations.ts";
import { openFactsStore } from "./index.ts";
import { storeDeps, testDatabase } from "./test-support.ts";

let database: ReturnType<typeof testDatabase> | undefined;
afterEach(() => database?.dispose());

const shipped = loadMigrations();
const columnsOf = (table: string): string[] => (database!.db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);

describe("P8: migrating a version 1 database", () => {
  it("replaces the empty household table and creates the facts and the change log", () => {
    database = testDatabase({ migrated: false });
    expect(migrate(database.db, shipped.slice(0, 1))).toBe(1);
    expect(columnsOf("household")).toContain("created_at");

    expect(migrate(database.db, shipped)).toBe(latestVersion(shipped));
    expect(currentVersion(database.db)).toBeGreaterThanOrEqual(2);
    expect(columnsOf("household")).toEqual(["id", "name", "currency", "plan_start", "even_out_step"]);
    const tables = (database.db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["accounts", "groups", "jobs", "budget_months", "assignments", "transactions", "moves", "entered_values", "import_batches", "import_rows", "rules", "changes", "people", "contribution_agreements", "bucket_transfers"]));
  });

  it("refuses to drop a household row, and changes nothing", () => {
    database = testDatabase({ migrated: false });
    migrate(database.db, shipped.slice(0, 1));
    database.db.prepare("insert into household (id, name, currency, created_at) values ('h', 'Home', 'NOK', '2026-11-09T00:00:00Z')").run();
    expect(() => migrate(database!.db, shipped)).toThrow(/CHECK/);
    expect(currentVersion(database.db)).toBe(1);
    expect(database.db.prepare("select name from household").get()).toEqual({ name: "Home" });
  });

  it("adds the tables of Milestone 4 to a version 2 database without touching a row that is there", () => {
    versionTwoDatabase();
    const { db } = database!;
    expect(currentVersion(db)).toBe(2);
    const before = { transactions: db.prepare("select * from transactions").all(), changes: db.prepare("select * from changes").all(), jobs: db.prepare("select * from jobs").all() };
    expect(migrate(db, shipped)).toBe(latestVersion(shipped));
    expect(currentVersion(db)).toBeGreaterThanOrEqual(3);
    for (const table of ["people", "contribution_agreements", "bucket_transfers"]) expect(db.prepare(`select count(*) as n from ${table}`).get()).toEqual({ n: 0 });
    expect({ transactions: db.prepare("select * from transactions").all(), changes: db.prepare("select * from changes").all(), jobs: db.prepare("select * from jobs").all() }).toEqual(before);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("numbers the shipped migrations without a gap", () => {
    expect(shipped.map((m) => m.version)).toEqual(shipped.map((_, i) => i + 1));
  });
});

/**
 * The database exactly as migration 0002 leaves it, with one change in the log, written as SQL so that this
 * file pins the stored format. A later migration that reshapes a table must also rewrite the records in
 * `changes` that touch it (see the header of 0002). This test migrates the fixture to the latest version and
 * undoes the record, so a migration that forgets fails here.
 */
const id = (n: number): string => `00000000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const [household, account, group, job, shop, change] = [1, 2, 3, 4, 5, 6].map(id) as [string, string, string, string, string, string];

const needsYouRow = { id: shop, accountId: account, bookingDate: "2026-03-05", amount: -12300, description: "Shop", treatment: { kind: "needsYou" } };
const splitTreatment = { kind: "split", allocations: [{ jobId: job, amount: -12300 }] };
const storedChange = {
  author: JSON.stringify({ kind: "family" }),
  command: JSON.stringify({ kind: "setTreatment", transactionId: shop, treatment: splitTreatment }),
  patch: JSON.stringify([{ table: "transactions", key: shop, before: needsYouRow, after: { ...needsYouRow, treatment: splitTreatment } }]),
};
const canonicalSplit = `{"allocations":[{"amount":-12300,"jobId":"${job}"}],"kind":"split"}`;

function versionTwoDatabase(): void {
  database = testDatabase({ migrated: false });
  const { db } = database;
  migrate(db, shipped.filter((m) => m.version <= 2));
  db.exec(`
    insert into household (id, name, currency, plan_start, even_out_step) values ('${household}', 'Home', 'NOK', '2026-01', 5000);
    insert into accounts (id, name, kind, scope, opening_balance, opening_date) values ('${account}', 'Everyday', 'everyday', 'shared', 0, '2025-12-31');
    insert into groups (id, name, position, counts_towards_savings_rate) values ('${group}', 'Living', 0, 0);
    insert into jobs (id, name, group_id, status, account_id, essential, opening, kind, role, target)
      values ('${job}', 'Buffer', '${group}', 'active', '${account}', 0, 0, 'saveUp', 'buffer', '{"kind":"bufferMonths","monthly":10000}');
    insert into transactions (id, account_id, booking_date, amount, description, treatment) values ('${shop}', '${account}', '2026-03-05', -12300, 'Shop', '${canonicalSplit}');
  `);
  db.prepare("insert into changes (id, at, kind, author, command, patch, status) values (?, '2026-06-15T09:00:00.000Z', 'setTreatment', ?, ?, ?, 'done')").run(change, storedChange.author, storedChange.command, storedChange.patch);
}

describe("P8: a change stored before a migration still undoes and redoes after it", () => {
  it("undoes the stored record on the migrated database", () => {
    versionTwoDatabase();
    migrate(database!.db, shipped);
    const store = openFactsStore(database!.db, storeDeps())!;
    expect(store.snapshot().head.undo).toMatchObject({ id: change, kind: "setTreatment", by: { kind: "family" } });
    expect(store.facts().transactions.get(shop as never)?.treatment).toEqual(splitTreatment);

    expect(store.step("undo").status).toBe("applied");
    expect(store.facts().transactions.get(shop as never)?.treatment).toEqual({ kind: "needsYou" });
    expect(database!.db.prepare("select treatment from transactions").get()).toEqual({ treatment: '{"kind":"needsYou"}' });

    const reopened = openFactsStore(database!.reopen(), storeDeps())!;
    expect(reopened.step("redo").status).toBe("applied");
    expect(database!.db.prepare("select treatment from transactions").get()).toEqual({ treatment: canonicalSplit });
  });
});
