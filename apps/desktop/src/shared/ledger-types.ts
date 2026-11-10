/**
 * What crosses the bridge about the family's facts and their change log. Domain types only: no SQL rows and
 * no shapes that exist for one screen. The store in the main process produces them and the page's replica
 * reads them.
 */

import type { ChangeAuthor, ChangeConflict, ChangeId, CommandKind, LocalDate, Patch, Refusal, Tables } from "@holt/core";

export type StepDirection = "undo" | "redo";

/** One change in the log, without its command and patch. */
export interface ChangeSummary {
  readonly id: ChangeId;
  /** ISO datetime. */
  readonly at: string;
  readonly kind: CommandKind;
  readonly by: ChangeAuthor;
}

/** The change an undo would reverse, and the one a redo would apply again. */
export interface LogHead {
  readonly undo: ChangeSummary | null;
  readonly redo: ChangeSummary | null;
}

/** All the facts as arrays, as of one revision. */
export interface Snapshot {
  readonly revision: number;
  readonly today: LocalDate;
  readonly tables: Tables;
  readonly head: LogHead;
}

/** Empty means no household exists yet: Setup (Milestone 6) or the development seed creates it. */
export type SnapshotResult = { readonly kind: "empty" } | { readonly kind: "ready"; readonly snapshot: Snapshot };

export type RunResult =
  /** `patch` is what the store wrote: the inverse of the change's patch for an undo. `base` is the revision it applies to. */
  | {
      readonly status: "applied";
      readonly base: number;
      readonly revision: number;
      readonly today: LocalDate;
      readonly patch: Patch;
      readonly change: ChangeSummary;
      readonly head: LogHead;
    }
  | { readonly status: "refused"; readonly refusal: Refusal }
  /** An undo or redo found the rows changed since, or nothing to undo or redo. Nothing was written. */
  | { readonly status: "conflict"; readonly conflict: ChangeConflict };
