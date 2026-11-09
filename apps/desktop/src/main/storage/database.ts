import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { z } from "zod";
import { type DataKey, type WrappedKey, WrappedKey as WrappedKeySchema, normaliseRecoveryCode, unwrapKey } from "./keys.ts";

export type Db = Database.Database;

/** Opens (or creates) the encrypted database. Throws if the key doesn't open it. */
export function openDatabase(file: string, key: DataKey): Db {
  const db = new Database(file);
  try {
    db.pragma(`hexkey='${key.toString("hex")}'`);
    // Reading the schema is the first access that needs the key.
    db.prepare("select count(*) from sqlite_master").get();
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const magic = Buffer.from("HOLTBACKUP\n", "ascii");

export const BackupHeader = z.object({
  version: z.literal(1),
  createdAt: z.iso.datetime(),
  /** The recovery-code copy of the data key, so the backup opens anywhere with the code alone (§14). */
  recovery: WrappedKeySchema,
});
export type BackupHeader = z.infer<typeof BackupHeader>;

function writeFileDurably(file: string, parts: Buffer[]): void {
  const fd = openSync(file, "w", 0o600);
  try {
    for (const part of parts) writeSync(fd, part);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes a new dated backup into `folder` and returns its path.
 * Everything is written under temporary names in the same folder and renamed into place last,
 * so a sync tool never uploads half a backup.
 */
export function writeBackup(db: Db, folder: string, recovery: WrappedKey, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const snapshot = join(folder, `.holt-${stamp}.snapshot.partial`);
  const partial = join(folder, `.holt-${stamp}.holtbackup.partial`);
  const final = join(folder, `holt-${stamp}.holtbackup`);
  try {
    // VACUUM INTO writes a consistent copy encrypted with the same key. The backup API can't: it opens the target without a key.
    db.prepare("vacuum into ?").run(snapshot);
    const header: BackupHeader = { version: 1, createdAt: now.toISOString(), recovery };
    const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerBytes.length);
    writeFileDurably(partial, [magic, length, headerBytes, readFileSync(snapshot)]);
    renameSync(partial, final);
    return final;
  } finally {
    rmSync(snapshot, { force: true });
    rmSync(partial, { force: true });
  }
}

export function readBackup(file: string): { header: BackupHeader; database: Buffer } {
  const bytes = readFileSync(file);
  if (!bytes.subarray(0, magic.length).equals(magic)) throw new Error("This file isn't a Holt backup.");
  const length = bytes.readUInt32BE(magic.length);
  const start = magic.length + 4;
  const header = BackupHeader.parse(JSON.parse(bytes.subarray(start, start + length).toString("utf8")));
  return { header, database: bytes.subarray(start + length) };
}

export type RestoreResult = { ok: true; key: DataKey } | { ok: false; reason: "not-a-code" | "wrong-code" };

/**
 * Restores a backup into `databaseFile` using only the recovery code.
 * The current database, if any, is replaced only after the backup has opened with the recovered key.
 */
export async function restoreBackup(backupFile: string, recoveryCode: string, databaseFile: string): Promise<RestoreResult> {
  const code = normaliseRecoveryCode(recoveryCode);
  if (code === null) return { ok: false, reason: "not-a-code" };
  const { header, database } = readBackup(backupFile);
  const key = await unwrapKey(header.recovery, code);
  if (key === null) return { ok: false, reason: "wrong-code" };

  const partial = `${databaseFile}.restore.partial`;
  writeFileDurably(partial, [database]);
  try {
    openDatabase(partial, key).close();
    for (const suffix of ["-wal", "-shm"]) rmSync(databaseFile + suffix, { force: true });
    renameSync(partial, databaseFile);
  } finally {
    rmSync(partial, { force: true });
    for (const suffix of ["-wal", "-shm"]) rmSync(partial + suffix, { force: true });
  }
  return { ok: true, key };
}
