import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, readBackup, restoreBackup, writeBackup } from "./database.ts";
import { type Argon2Params, newDataKey, newRecoveryCode, normaliseRecoveryCode, unwrapKey, wrapKey } from "./keys.ts";

// The smallest settings the schema allows, so the tests stay fast. The app uses defaultArgon2.
const fast: Argon2Params = { memory: 19_456, passes: 2, parallelism: 1 };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "holt-storage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("recovery codes", () => {
  it("are six groups of five Crockford base32 characters", () => {
    expect(newRecoveryCode()).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){5}[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it("are different each time", () => {
    expect(new Set(Array.from({ length: 100 }, newRecoveryCode)).size).toBe(100);
  });

  it("accept lower case, spaces and letters mistaken for digits", () => {
    const code = "01ABC-DEF1G-HJKMN-PQRST-VWXYZ-23456";
    expect(normaliseRecoveryCode("o1abc defig hjkmn pqrst vwxyz 23456")).toBe(code);
    expect(normaliseRecoveryCode("O1ABCDEFLGHJKMNPQRSTVWXYZ23456")).toBe(code);
  });

  it("reject the wrong length or characters outside the alphabet", () => {
    expect(normaliseRecoveryCode("01ABC-DEF1G")).toBeNull();
    expect(normaliseRecoveryCode("01ABC-DEF1G-HJKMN-PQRST-VWXYZ-2345U")).toBeNull();
  });
});

describe("wrapped keys", () => {
  it("unwrap with the secret they were wrapped with", async () => {
    const key = newDataKey();
    const unwrapped = await unwrapKey(await wrapKey(key, "the family's passphrase", fast), "the family's passphrase");
    expect(unwrapped?.equals(key)).toBe(true);
  });

  it("don't unwrap with another secret", async () => {
    const wrapped = await wrapKey(newDataKey(), "the family's passphrase", fast);
    expect(await unwrapKey(wrapped, "a guess")).toBeNull();
  });

  it("don't contain the key", async () => {
    const key = newDataKey();
    const wrapped = await wrapKey(key, "secret", fast);
    expect(JSON.stringify(wrapped)).not.toContain(key.toString("base64"));
    expect(JSON.stringify(wrapped)).not.toContain(key.toString("hex"));
  });
});

describe("the encrypted database", () => {
  it("opens again with its key", () => {
    const key = newDataKey();
    const file = join(dir, "holt.db");
    const db = openDatabase(file, key);
    db.exec("create table note (text text); insert into note values ('Electricity')");
    db.close();
    expect(openDatabase(file, key).prepare("select text from note").get()).toEqual({ text: "Electricity" });
  });

  it("is in WAL mode", () => {
    const db = openDatabase(join(dir, "holt.db"), newDataKey());
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
  });

  it("doesn't open with another key", () => {
    const file = join(dir, "holt.db");
    openDatabase(file, newDataKey()).close();
    expect(() => openDatabase(file, newDataKey())).toThrow();
  });

  it("has no plain SQLite header on disk", () => {
    const file = join(dir, "holt.db");
    const db = openDatabase(file, newDataKey());
    db.exec("create table note (text text)");
    db.close();
    expect(readFileSync(file).subarray(0, 15).toString("latin1")).not.toBe("SQLite format 3");
  });
});

describe("backups", () => {
  async function databaseWithBackup() {
    const key = newDataKey();
    const code = newRecoveryCode();
    const db = openDatabase(join(dir, "holt.db"), key);
    db.exec("create table note (text text); insert into note values ('Electricity')");
    const backups = join(dir, "backups");
    mkdirSync(backups);
    const file = writeBackup(db, backups, await wrapKey(key, code, fast), new Date("2026-11-09T08:00:00Z"));
    db.close();
    return { key, code, file, backups };
  }

  it("leave one dated file and no temporary files", async () => {
    const { backups } = await databaseWithBackup();
    expect(readdirSync(backups)).toEqual(["holt-2026-11-09T08-00-00-000Z.holtbackup"]);
  });

  it("carry the database encrypted, not in plain text", async () => {
    const { file } = await databaseWithBackup();
    const { database } = readBackup(file);
    expect(database.subarray(0, 15).toString("latin1")).not.toBe("SQLite format 3");
    expect(database.includes(Buffer.from("Electricity"))).toBe(false);
  });

  it("restore into a new place with only the recovery code", async () => {
    const { key, code, file } = await databaseWithBackup();
    const target = join(dir, "fresh.db");
    const result = await restoreBackup(file, code.toLowerCase().replace(/-/g, " "), target);
    expect(result.ok && result.key.equals(key)).toBe(true);
    expect(openDatabase(target, key).prepare("select text from note").get()).toEqual({ text: "Electricity" });
  });

  it("refuse the wrong code and leave the current database alone", async () => {
    const { file } = await databaseWithBackup();
    const target = join(dir, "current.db");
    writeFileSync(target, "the family's current database");
    expect(await restoreBackup(file, newRecoveryCode(), target)).toEqual({ ok: false, reason: "wrong-code" });
    expect(await restoreBackup(file, "not a code", target)).toEqual({ ok: false, reason: "not-a-code" });
    expect(readFileSync(target, "utf8")).toBe("the family's current database");
    expect(readdirSync(dir).filter((f) => f.includes("partial"))).toEqual([]);
  });

  it("refuse a file that isn't a backup", () => {
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello");
    expect(() => readBackup(file)).toThrow("This file isn't a Holt backup.");
  });
});
