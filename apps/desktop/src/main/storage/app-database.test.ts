import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "./app-database.ts";
import { openDatabase } from "./database.ts";
import { newDataKey } from "./keys.ts";
import { currentVersion, latestVersion, loadMigrations } from "./migrations.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "holt-appdb-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("opening the app database", () => {
  it("reports not-set-up when there is no key, and creates nothing", async () => {
    const result = await openAppDatabase(dir, () => false, async () => {
      throw new Error("must not unlock");
    });
    expect(result).toEqual({ state: { state: "not-set-up" }, db: null });
    expect(existsSync(join(dir, "holt.db"))).toBe(false);
  });

  it("reports why it is locked", async () => {
    const result = await openAppDatabase(dir, () => true, async () => ({ ok: false, reason: "needs-passphrase" }));
    expect(result).toEqual({ state: { state: "locked", reason: "needs-passphrase" }, db: null });
  });

  it("opens, migrates and is ready", async () => {
    const key = newDataKey();
    const result = await openAppDatabase(dir, () => true, async () => ({ ok: true, key }));
    expect(result.state).toEqual({ state: "ready" });
    expect(currentVersion(result.db!)).toBe(latestVersion(loadMigrations()));
    result.db!.close();
  });

  it("refuses a database from a newer Holt without opening it", async () => {
    const key = newDataKey();
    const db = openDatabase(join(dir, "holt.db"), key);
    db.pragma("user_version = 999");
    db.close();
    const result = await openAppDatabase(dir, () => true, async () => ({ ok: true, key }));
    expect(result.state).toMatchObject({ state: "refused", reason: "newer-than-app", found: 999 });
    expect(result.db).toBeNull();
  });
});
