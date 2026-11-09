// Node's crypto.argon2 exists inside Electron but fails: Electron builds Node against BoringSSL, which has no Argon2.
// hash-wasm is WebAssembly, so it adds no second native module (technical-decisions.md §5).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { argon2id } from "hash-wasm";
import { z } from "zod";

/** The 256-bit key that encrypts the database and every backup (technical-decisions.md §5). */
export type DataKey = Buffer & { readonly __brand: "DataKey" };

export function newDataKey(): DataKey {
  return randomBytes(32) as DataKey;
}

export function dataKeyFromBytes(bytes: Buffer): DataKey {
  if (bytes.length !== 32) throw new Error(`A data key is 32 bytes, not ${bytes.length}`);
  return bytes as DataKey;
}

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const Argon2Params = z.object({
  memory: z.number().int().min(19_456),
  passes: z.number().int().min(2),
  parallelism: z.number().int().min(1),
});
export type Argon2Params = z.infer<typeof Argon2Params>;

/** 256 MiB of memory and 3 passes, in KiB as Argon2 counts memory. */
export const defaultArgon2: Argon2Params = { memory: 262_144, passes: 3, parallelism: 4 };

/** The data key, encrypted with a key derived from a secret the family knows (a passphrase or the recovery code). */
export const WrappedKey = z.object({
  kdf: z.literal("argon2id"),
  params: Argon2Params,
  salt: base64,
  cipher: z.literal("aes-256-gcm"),
  nonce: base64,
  ciphertext: base64,
  tag: base64,
});
export type WrappedKey = z.infer<typeof WrappedKey>;

async function deriveKey(secret: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  const hash = await argon2id({
    password: secret,
    salt,
    memorySize: params.memory,
    iterations: params.passes,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return Buffer.from(hash);
}

export async function wrapKey(key: DataKey, secret: string, params: Argon2Params = defaultArgon2): Promise<WrappedKey> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(secret, salt, params), nonce);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  return {
    kdf: "argon2id",
    params,
    salt: salt.toString("base64"),
    cipher: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Returns null when the secret is wrong: the GCM tag doesn't match. */
export async function unwrapKey(wrapped: WrappedKey, secret: string): Promise<DataKey | null> {
  const derived = await deriveKey(secret, Buffer.from(wrapped.salt, "base64"), wrapped.params);
  const decipher = createDecipheriv("aes-256-gcm", derived, Buffer.from(wrapped.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
  try {
    return dataKeyFromBytes(Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, "base64")), decipher.final()]));
  } catch {
    return null;
  }
}

// Crockford base32: no I, L, O or U, so the code survives being read aloud or copied by hand.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Six groups of five characters: 150 random bits. */
export function newRecoveryCode(): string {
  const chars = [...randomBytes(30)].map((b) => alphabet[b % 32]).join("");
  return chars.match(/.{5}/g)!.join("-");
}

/** Accepts lower case, spaces and the letters people mistake for digits; returns the code as `newRecoveryCode` writes it, or null. */
export function normaliseRecoveryCode(input: string): string | null {
  const chars = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (chars.length !== 30 || [...chars].some((c) => !alphabet.includes(c))) return null;
  return chars.match(/.{5}/g)!.join("-");
}

/** The protected copies of the data key, stored in `keys.json` next to the database. */
export const KeyFile = z.object({
  version: z.literal(1),
  /** safeStorage's encryption of the data key, when the keyring holds the daily copy. */
  keyring: base64.optional(),
  /** The passphrase copy, when no keyring is available. */
  passphrase: WrappedKey.optional(),
  /** The recovery-code copy. Always present; every backup carries it too. */
  recovery: WrappedKey,
});
export type KeyFile = z.infer<typeof KeyFile>;
