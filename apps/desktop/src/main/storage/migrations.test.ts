import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDatabase } from "./database.ts";
import { newDataKey } from "./keys.ts";
import { DatabaseTooNewError, type Migration, currentVersion, loadMigrations, migrate } from "./migrations.ts";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "holt-migrations-"));
  db = openDatabase(join(dir, "test.db"), newDataKey());
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const tables = (): string[] =>
  (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((r) => r.name);

const two: Migration[] = [
  { version: 1, name: "a", sql: "create table a (x integer);" },
  { version: 2, name: "b", sql: "create table b (y integer);" },
];

describe("B4: migrations apply in order and only once", () => {
  it("sets user_version to the highest applied and creates the tables", () => {
    expect(migrate(db, two)).toBe(2);
    expect(currentVersion(db)).toBe(2);
    expect(tables()).toEqual(["a", "b"]);
  });

  it("applies only the pending ones from an older version", () => {
    migrate(db, two.slice(0, 1));
    expect(tables()).toEqual(["a"]);
    migrate(db, two);
    expect(tables()).toEqual(["a", "b"]);
  });

  it("does nothing on a second run", () => {
    migrate(db, two);
    db.exec("insert into a values (1)");
    migrate(db, two);
    expect(currentVersion(db)).toBe(2);
    expect(db.prepare("select count(*) as n from a").get()).toEqual({ n: 1 });
  });

  it("the shipped migrations load in numbered order and apply", () => {
    const shipped = loadMigrations();
    expect(shipped.map((m) => m.version)).toEqual(shipped.map((_, i) => i + 1));
    expect(migrate(db, shipped)).toBe(shipped.length);
  });

  it("refuses a gap in the numbering", () => {
    expect(() => loadMigrations({ "./migrations/0001_a.sql": "", "./migrations/0003_c.sql": "" })).toThrow(/no gap/);
  });
});

describe("B5: a failing migration changes nothing", () => {
  it("keeps the previous version and none of its own changes", () => {
    const bad: Migration[] = [...two, { version: 3, name: "bad", sql: "create table c (z integer); insert into missing values (1);" }];
    expect(() => migrate(db, bad)).toThrow();
    expect(currentVersion(db)).toBe(2);
    expect(tables()).toEqual(["a", "b"]);
  });
});

describe("B6: a database newer than the app is refused", () => {
  it("throws before changing anything", () => {
    migrate(db, two);
    expect(() => migrate(db, two.slice(0, 1))).toThrow(DatabaseTooNewError);
    expect(currentVersion(db)).toBe(2);
    expect(tables()).toEqual(["a", "b"]);
  });
});

describe("B8: the household currency CHECK", () => {
  const insert = (currency: string) =>
    db.prepare("insert into household (id, name, currency, plan_start, even_out_step) values ('h', 'Home', ?, '2026-11', 5000)").run(currency);

  it("accepts three capital letters", () => {
    migrate(db);
    expect(() => insert("NOK")).not.toThrow();
  });

  it.each(["nok", "Nok", "NO", "NOKK", "N0K", "NO ", "", "ÆØÅ"])("rejects %j", (currency) => {
    migrate(db);
    expect(() => insert(currency)).toThrow(/CHECK/);
  });

  it("keeps a row it accepted", () => {
    migrate(db);
    insert("NOK");
    expect(db.prepare("select currency from household").get()).toEqual({ currency: "NOK" });
  });
});
