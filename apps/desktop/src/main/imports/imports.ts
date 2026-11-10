/**
 * Importing a bank file (decision 0047, Part 2, "The import session"). The path, the bytes and the parsed rows
 * stay in this module. The page gets a session token and a preview, and every preview and every commit plans
 * again on the facts as they are now.
 */

import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { type ImportIds, type ImportPlan, type StatementFile, planImport } from "@holt/core";
import { ImportError, decodeStatement, recogniseFormat } from "@holt/importers";
import type { IdMint } from "../../shared/ids.ts";
import type { ImportCommitted, ImportEntry, ImportOpened, ImportPlanned, SessionId } from "../../shared/import-types.ts";
import type { Clock } from "../clock.ts";
import type { FactsStore } from "../facts/index.ts";
import type { FileRead } from "./files.ts";

export interface ImportsDeps {
  readonly clock: Clock;
  readonly mint: IdMint;
  /** The file the family chose, or null when they cancelled. */
  readonly pickFile: () => Promise<string | null>;
  readonly readFile: (path: string) => Promise<FileRead>;
  /** Runs after an import is stored. Backups use it from Milestone 6. A failure here never changes the import's result. */
  readonly afterImport?: () => void;
}

export interface Imports {
  /** Shows the file dialog, reads the file and plans it. Cancelling changes nothing, not even a preview the page already holds. */
  open(): Promise<ImportOpened>;
  /** Plans a file's bytes. `open` calls it, and so does the development seed. */
  planBytes(bytes: Uint8Array, fileName: string): ImportOpened;
  plan(session: SessionId, entry: ImportEntry): ImportPlanned;
  commit(session: SessionId, entry: ImportEntry): ImportCommitted;
}

/** The one file the main process is holding between choosing it and adding it. */
interface Pending {
  readonly id: SessionId;
  readonly fileName: string;
  readonly fingerprint: string;
  readonly parsed: StatementFile;
}

const untouched: ImportEntry = { balances: [], choices: [], suggest: true };

/** An `ImportError` puts its line in front of its message. The page has the line separately. */
function messageOf(error: ImportError): string {
  const prefix = `Line ${error.line}: `;
  return error.line !== undefined && error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
}

export function createImports(store: FactsStore, deps: ImportsDeps): Imports {
  let pending: Pending | null = null;
  const ids: ImportIds = { batch: () => deps.mint("importBatch"), row: () => deps.mint("importRow"), enteredValue: () => deps.mint("enteredValue") };

  function replan(held: Pending, entry: ImportEntry): ImportPlan {
    return planImport(store.facts(), held.parsed, {
      fileName: held.fileName,
      fingerprint: held.fingerprint,
      importedAt: deps.clock.now().toISOString(),
      balances: entry.balances,
      asOf: deps.clock.today(),
      ids,
      choices: entry.choices,
      suggest: entry.suggest,
    });
  }

  function held(session: SessionId): Pending | null {
    return pending !== null && pending.id === session ? pending : null;
  }

  function planBytes(bytes: Uint8Array, fileName: string): ImportOpened {
    pending = null;
    let text: string;
    try {
      text = decodeStatement(bytes).text;
    } catch (error) {
      if (error instanceof ImportError) return { kind: "unreadable", fileName, reason: "notText" };
      throw error;
    }
    const format = recogniseFormat(text);
    if (format === null) return { kind: "unrecognised", fileName };
    let parsed: StatementFile;
    try {
      parsed = format.parse(text);
    } catch (error) {
      if (error instanceof ImportError) return { kind: "unparseable", fileName, line: error.line ?? null, message: messageOf(error) };
      throw error;
    }
    const candidate: Pending = { id: randomUUID(), fileName, fingerprint: createHash("sha256").update(bytes).digest("hex"), parsed };
    const plan = replan(candidate, untouched);
    if (!plan.ok) return { kind: "blocked", fileName, block: plan.blocked };
    pending = candidate;
    return { kind: "opened", session: candidate.id, fileName, preview: plan.preview };
  }

  return {
    async open() {
      const path = await deps.pickFile();
      if (path === null) return { kind: "cancelled" };
      const fileName = basename(path);
      const read = await deps.readFile(path);
      if (read.kind === "unreadable") {
        pending = null;
        return { kind: "unreadable", fileName, reason: read.reason };
      }
      return planBytes(read.bytes, fileName);
    },

    planBytes,

    plan(session, entry) {
      const file = held(session);
      if (file === null) return { kind: "expired" };
      const plan = replan(file, entry);
      return plan.ok ? { kind: "planned", preview: plan.preview } : { kind: "blocked", block: plan.blocked };
    },

    commit(session, entry) {
      const file = held(session);
      if (file === null) return { status: "expired" };
      const plan = replan(file, entry);
      if (!plan.ok) return { status: "blocked", block: plan.blocked };
      const result = store.run(plan.command);
      if (result.status === "applied") {
        pending = null;
        try {
          deps.afterImport?.();
        } catch (error) {
          console.error("[holt] the after-import hook failed", error);
        }
      }
      return result;
    },
  };
}
