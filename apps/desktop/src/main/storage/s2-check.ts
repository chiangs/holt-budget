// Spike S2: runs the storage sequence inside the app, packaged or not, with no window.
//   holt --holt-s2-check=full --holt-s2-dir=<empty folder>
//   holt --holt-s2-check=restore --holt-s2-dir=<empty folder> --holt-s2-backup=<file>   (HOLT_RECOVERY_CODE set)
// HOLT_PASSPHRASE supplies the passphrase when there is no keyring.
import { mkdirSync, readdirSync, writeSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { openDatabase, readBackup, restoreBackup, writeBackup } from "./database.ts";
import type { DataKey } from "./keys.ts";
import { adoptKey, createKeys, keyringBackend, readKeyFile, unlock } from "./keystore.ts";

const row = "Electricity, 3050 kr, December";

function readRow(file: string, key: DataKey): string | undefined {
  const db = openDatabase(file, key);
  try {
    return (db.prepare("select text from note").get() as { text: string } | undefined)?.text;
  } finally {
    db.close();
  }
}

async function full(dir: string, passphrase: string | null) {
  const data = join(dir, "data");
  const backups = join(dir, "backups");
  mkdirSync(backups, { recursive: true });

  const { key, recoveryCode } = await createKeys(data, passphrase);
  const db = openDatabase(join(data, "holt.db"), key);
  db.exec("create table note (text text)");
  db.prepare("insert into note values (?)").run(row);
  const journal = db.pragma("journal_mode", { simple: true });
  const backup = writeBackup(db, backups, readKeyFile(data).recovery, new Date());
  db.close();

  const unlocked = await unlock(data, passphrase);
  if (!unlocked.ok) return { ok: false, step: "unlock", unlocked };
  const reopened = readRow(join(data, "holt.db"), unlocked.key);

  const restored = await restoreBackup(backup, recoveryCode, join(dir, "restored.db"));
  if (!restored.ok) return { ok: false, step: "restore", restored };

  return {
    ok: reopened === row && readRow(join(dir, "restored.db"), restored.key) === row && journal === "wal",
    journal,
    unlockedVia: unlocked.via,
    backup,
    backupFolder: readdirSync(backups),
    recoveryCode,
  };
}

async function restore(dir: string, backup: string, recoveryCode: string, passphrase: string | null) {
  const data = join(dir, "data");
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const restored = await restoreBackup(backup, recoveryCode, join(data, "holt.db"));
  if (!restored.ok) return { ok: false, step: "restore", restored };
  await adoptKey(data, restored.key, readBackup(backup).header.recovery, passphrase);

  const unlocked = await unlock(data, passphrase);
  if (!unlocked.ok) return { ok: false, step: "unlock", unlocked };
  const text = readRow(join(data, "holt.db"), unlocked.key);
  return { ok: text === row, text, unlockedVia: unlocked.via };
}

export async function runS2Check(mode: string): Promise<number> {
  const switchValue = (name: string) => app.commandLine.getSwitchValue(name) || null;
  const dir = switchValue("holt-s2-dir");
  const passphrase = process.env["HOLT_PASSPHRASE"] ?? null;
  const base = {
    mode,
    packaged: app.isPackaged,
    electron: process.versions.electron,
    selectedBackend: safeStorage.getSelectedStorageBackend(),
    keyring: await keyringBackend(),
  };
  let result: object;
  try {
    if (dir === null) throw new Error("--holt-s2-dir is required");
    if (mode === "full") result = await full(dir, passphrase);
    else if (mode === "restore") {
      const backup = switchValue("holt-s2-backup");
      const code = process.env["HOLT_RECOVERY_CODE"];
      if (backup === null || code === undefined) throw new Error("restore needs --holt-s2-backup and HOLT_RECOVERY_CODE");
      result = await restore(dir, backup, code, passphrase);
    } else throw new Error(`Unknown mode: ${mode}`);
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  // Synchronous, because app.exit follows at once and would drop a buffered write to a pipe.
  writeSync(1, `HOLT-S2 ${JSON.stringify({ ...base, ...result })}\n`);
  return "ok" in result && result.ok === true ? 0 : 1;
}
