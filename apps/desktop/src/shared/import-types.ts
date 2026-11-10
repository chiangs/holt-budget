/**
 * What crosses the bridge about importing a file. The path, the bytes and the parsed rows stay in the main
 * process; the page sees a session token and a preview. Domain types only (decision 0047, part 2).
 */

import type { AccountId, ImportBlock, ImportPreview, LocalDate, Money, TreatmentInput } from "@holt/core";
import type { RunResult } from "./ledger-types.ts";

/** An opaque token for the one import the main process is holding. */
export type SessionId = string;

/** What the family has told the app since the file was read. */
export interface ImportEntry {
  /** The balance the bank shows for an account on a date. Optional per account: an unchecked account shows "not checked". */
  readonly balances: readonly { readonly accountId: AccountId; readonly value: Money; readonly asOf: LocalDate }[];
  /** The job the family picked for a new row, by its line in the file. */
  readonly choices: readonly { readonly line: number; readonly treatment: TreatmentInput }[];
  /** Whether "same as last time" suggestions apply on Add. True by default. */
  readonly suggest: boolean;
}

export type ImportOpened =
  | { readonly kind: "cancelled" }
  | { readonly kind: "unreadable"; readonly fileName: string; readonly reason: "missing" | "denied" | "tooLarge" | "notText" }
  | { readonly kind: "unrecognised"; readonly fileName: string }
  /** `line` is the line in the file the parser stopped at, when it knows. */
  | { readonly kind: "unparseable"; readonly fileName: string; readonly line: number | null; readonly message: string }
  /** The file was read but the import can't go ahead, for example because it is in another currency. */
  | { readonly kind: "blocked"; readonly fileName: string; readonly block: ImportBlock }
  | { readonly kind: "opened"; readonly session: SessionId; readonly fileName: string; readonly preview: ImportPreview };

export type ImportPlanned =
  | { readonly kind: "planned"; readonly preview: ImportPreview }
  | { readonly kind: "blocked"; readonly block: ImportBlock }
  /** The session is gone: a newer file replaced it, it was added, or the app restarted. */
  | { readonly kind: "expired" };

/** The change itself when it was made, or why it wasn't. */
export type ImportCommitted = RunResult | { readonly status: "blocked"; readonly block: ImportBlock } | { readonly status: "expired" };
