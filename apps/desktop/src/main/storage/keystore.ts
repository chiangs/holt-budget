import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { type DataKey, KeyFile, type WrappedKey, dataKeyFromBytes, newDataKey, newRecoveryCode, unwrapKey, wrapKey } from "./keys.ts";

/** `$XDG_DATA_HOME/holt`, or `holt-dev` when running from source, so development never opens the family's data (§13). */
export function dataFolder(): string {
  const base = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
  return join(base, app.isPackaged ? "holt" : "holt-dev");
}

/** The keyring Electron chose, or null when it would fall back to `basic_text`, which protects nothing (§5). */
export async function keyringBackend(): Promise<string | null> {
  const backend = safeStorage.getSelectedStorageBackend();
  if (backend === "basic_text" || backend === "unknown") return null;
  return (await safeStorage.isAsyncEncryptionAvailable()) ? backend : null;
}

function keyFilePath(folder: string): string {
  return join(folder, "keys.json");
}

function writeKeyFile(folder: string, keys: KeyFile): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const partial = `${keyFilePath(folder)}.partial`;
  const fd = openSync(partial, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(keys, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(partial, keyFilePath(folder));
}

export function hasKeys(folder: string): boolean {
  return existsSync(keyFilePath(folder));
}

export function readKeyFile(folder: string): KeyFile {
  return KeyFile.parse(JSON.parse(readFileSync(keyFilePath(folder), "utf8")));
}

/** The daily copy: the keyring when there is one, otherwise the passphrase. */
async function dailyCopy(key: DataKey, passphrase: string | null): Promise<Pick<KeyFile, "keyring" | "passphrase">> {
  if ((await keyringBackend()) !== null) {
    return { keyring: (await safeStorage.encryptStringAsync(key.toString("base64"))).toString("base64") };
  }
  if (passphrase === null) throw new Error("No keyring is available, so Holt needs a passphrase.");
  return { passphrase: await wrapKey(key, passphrase) };
}

/** Setup: a new data key, its recovery code, and both protected copies. The recovery code is shown once and never stored. */
export async function createKeys(folder: string, passphrase: string | null): Promise<{ key: DataKey; recoveryCode: string }> {
  const key = newDataKey();
  const recoveryCode = newRecoveryCode();
  writeKeyFile(folder, { version: 1, ...(await dailyCopy(key, passphrase)), recovery: await wrapKey(key, recoveryCode) });
  return { key, recoveryCode };
}

/** After a restore: this account's daily copy, and the recovery copy from the backup, so the same code keeps working. */
export async function adoptKey(folder: string, key: DataKey, recovery: WrappedKey, passphrase: string | null): Promise<void> {
  writeKeyFile(folder, { version: 1, ...(await dailyCopy(key, passphrase)), recovery });
}

export type Unlock =
  | { ok: true; key: DataKey; via: "keyring" | "passphrase" }
  | { ok: false; reason: "needs-passphrase" | "wrong-passphrase" | "keyring-unavailable" };

/** The daily unlock at start-up. */
export async function unlock(folder: string, passphrase: string | null): Promise<Unlock> {
  const keys = readKeyFile(folder);
  if (keys.keyring !== undefined) {
    if ((await keyringBackend()) === null) return { ok: false, reason: "keyring-unavailable" };
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(keys.keyring, "base64"));
    const key = dataKeyFromBytes(Buffer.from(result, "base64"));
    // The keyring rotated its own key: store the daily copy again under the new one.
    if (shouldReEncrypt) writeKeyFile(folder, { ...keys, ...(await dailyCopy(key, null)) });
    return { ok: true, key, via: "keyring" };
  }
  if (keys.passphrase === undefined) throw new Error("keys.json has no daily copy of the data key.");
  if (passphrase === null) return { ok: false, reason: "needs-passphrase" };
  const key = await unwrapKey(keys.passphrase, passphrase);
  return key === null ? { ok: false, reason: "wrong-passphrase" } : { ok: true, key, via: "passphrase" };
}
