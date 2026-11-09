import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseState } from "../../shared/channels.ts";
import { type Db, openDatabase } from "./database.ts";
import type { DataKey } from "./keys.ts";
import { DatabaseTooNewError, migrate } from "./migrations.ts";

export type Unlocker = (folder: string) => Promise<{ ok: true; key: DataKey } | { ok: false; reason: "needs-passphrase" | "wrong-passphrase" | "keyring-unavailable" }>;

export type AppDatabase = { state: DatabaseState; db: Db | null };

/**
 * Opens `holt.db` in `folder` and brings it up to date. Setup is Milestone 6, so with no key file this reports
 * "not-set-up" and creates nothing: it never invents a key.
 */
export async function openAppDatabase(folder: string, hasKeys: (folder: string) => boolean, unlock: Unlocker): Promise<AppDatabase> {
  if (!hasKeys(folder)) return { state: { state: "not-set-up" }, db: null };
  const unlocked = await unlock(folder);
  if (!unlocked.ok) return { state: { state: "locked", reason: unlocked.reason }, db: null };
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const db = openDatabase(join(folder, "holt.db"), unlocked.key);
  try {
    migrate(db);
  } catch (error) {
    db.close();
    if (error instanceof DatabaseTooNewError) {
      return { state: { state: "refused", reason: "newer-than-app", found: error.found, supported: error.supported }, db: null };
    }
    throw error;
  }
  return { state: { state: "ready" }, db };
}

let current: AppDatabase = { state: { state: "not-set-up" }, db: null };

export function databaseState(): DatabaseState {
  return current.state;
}

export function appDb(): Db | null {
  return current.db;
}

/** Called once from the main process after the app is ready. Never runs on import. */
export async function initAppDatabase(): Promise<void> {
  const { dataFolder, hasKeys, unlock } = await import("./keystore.ts");
  current = await openAppDatabase(dataFolder(), hasKeys, (folder) => unlock(folder, null));
}
