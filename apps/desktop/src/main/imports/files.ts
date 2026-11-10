import { open } from "node:fs/promises";
import type { ImportOpened } from "../../shared/import-types.ts";

export type UnreadableReason = Extract<ImportOpened, { kind: "unreadable" }>["reason"];

export type FileRead = { readonly kind: "bytes"; readonly bytes: Uint8Array } | { readonly kind: "unreadable"; readonly reason: UnreadableReason };

/** A bank export for a household is a few hundred kilobytes. Anything past this is not one. */
export const maxStatementBytes = 32 * 1024 * 1024;

function unreadable(reason: UnreadableReason): FileRead {
  return { kind: "unreadable", reason };
}

/** Reads a file the family chose, and says why it can't when it can't. It never reads more than the cap. */
export async function readStatementFile(path: string): Promise<FileRead> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    switch ((error as NodeJS.ErrnoException).code) {
      case "ENOENT":
      case "ENOTDIR":
        return unreadable("missing");
      case "EACCES":
      case "EPERM":
        return unreadable("denied");
      default:
        throw error;
    }
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return unreadable("notText");
    if (info.size > maxStatementBytes) return unreadable("tooLarge");
    const bytes = await handle.readFile();
    return bytes.length > maxStatementBytes ? unreadable("tooLarge") : { kind: "bytes", bytes };
  } finally {
    await handle.close();
  }
}
