/**
 * The change log (domain model, "Change record"). Each saved command leaves a record holding its patch,
 * so undo can put the rows back as they were, as long as nothing has touched them since.
 */

import type { ChangeId, ProposalId } from "./ids.ts";
import type { Facts } from "./facts.ts";
import { type Patch, type RowMismatch, invertPatch, tryApplyPatch } from "./patch.ts";

export type ChangeAuthor = { readonly kind: "family" } | { readonly kind: "proposal"; readonly proposalId: ProposalId };

export interface ChangeRecord<C> {
  readonly id: ChangeId;
  /** ISO datetime, given by the caller because core has no clock. */
  readonly at: string;
  readonly by: ChangeAuthor;
  readonly command: C;
  readonly patch: Patch;
}

/** Both stacks keep the most recent record last. */
export interface ChangeLog<C> {
  readonly done: readonly ChangeRecord<C>[];
  readonly undone: readonly ChangeRecord<C>[];
}

export function emptyChangeLog<C>(): ChangeLog<C> {
  return { done: [], undone: [] };
}

/** Save a change. A new change ends any redo. */
export function record<C>(log: ChangeLog<C>, entry: ChangeRecord<C>): ChangeLog<C> {
  return { done: [...log.done, entry], undone: [] };
}

export type ChangeConflict =
  | { readonly kind: "nothingToUndo" }
  | { readonly kind: "nothingToRedo" }
  /** Something changed these rows since. `expected` is how the change left them (undo) or how they were before it (redo). */
  | { readonly kind: "rowsChanged"; readonly changeId: ChangeId; readonly rows: readonly RowMismatch[] };

export type ChangeResult<C> =
  | { readonly ok: true; readonly facts: Facts; readonly log: ChangeLog<C>; readonly record: ChangeRecord<C> }
  | { readonly ok: false; readonly conflict: ChangeConflict };

export function undo<C>(facts: Facts, log: ChangeLog<C>): ChangeResult<C> {
  const last = log.done.at(-1);
  if (last === undefined) return { ok: false, conflict: { kind: "nothingToUndo" } };
  const result = tryApplyPatch(facts, invertPatch(last.patch));
  if (!result.ok) return { ok: false, conflict: { kind: "rowsChanged", changeId: last.id, rows: result.mismatches } };
  return { ok: true, facts: result.facts, record: last, log: { done: log.done.slice(0, -1), undone: [...log.undone, last] } };
}

export function redo<C>(facts: Facts, log: ChangeLog<C>): ChangeResult<C> {
  const next = log.undone.at(-1);
  if (next === undefined) return { ok: false, conflict: { kind: "nothingToRedo" } };
  const result = tryApplyPatch(facts, next.patch);
  if (!result.ok) return { ok: false, conflict: { kind: "rowsChanged", changeId: next.id, rows: result.mismatches } };
  return { ok: true, facts: result.facts, record: next, log: { done: [...log.done, next], undone: log.undone.slice(0, -1) } };
}
