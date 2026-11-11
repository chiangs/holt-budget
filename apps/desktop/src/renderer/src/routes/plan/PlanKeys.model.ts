/**
 * What each key does on Plan (information-architecture-and-glossary.md, Keyboard). Typing always wins: nothing
 * fires in a text field or while a dialog is open, so the amount field and the dialogs take every key. A key
 * that a focused button already uses (Enter) is left to the button. Held keys repeat only to move through the
 * rows. The navigation letters A O T P R M I S are never used here, which is why moving money has a button and no key.
 */

import type { KeyPress } from "../transactions/keys.model.ts";

export interface PlanKeyContext {
  /** The table has a selected row. */
  readonly row: boolean;
  /** The selected row's amount can be changed: the month is open. */
  readonly canEdit: boolean;
  readonly panelOpen: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** A change is being saved. Another waits until it is done. */
  readonly busy: boolean;
}

export type PlanIntent =
  | { readonly kind: "newJob" }
  | { readonly kind: "move"; readonly step: 1 | -1 }
  | { readonly kind: "open" }
  | { readonly kind: "edit" }
  | { readonly kind: "closePanel" }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" };

export function planKey(press: KeyPress, context: PlanKeyContext): PlanIntent | null {
  if (press.dialogOpen || press.target === "field" || press.altKey) return null;

  if (press.ctrlKey || press.metaKey) {
    if (press.key.toLowerCase() !== "z" || press.repeat || context.busy) return null;
    if (press.shiftKey) return context.canRedo ? { kind: "redo" } : null;
    return context.canUndo ? { kind: "undo" } : null;
  }

  const letter = press.key.toLowerCase();
  if (press.key === "ArrowDown" || (letter === "j" && !press.shiftKey)) return context.row ? { kind: "move", step: 1 } : null;
  if (press.key === "ArrowUp" || (letter === "k" && !press.shiftKey)) return context.row ? { kind: "move", step: -1 } : null;
  if (press.repeat) return null;

  if (press.key === "Escape") return context.panelOpen ? { kind: "closePanel" } : null;
  if (letter === "n" && !press.shiftKey) return { kind: "newJob" };

  if (context.busy) return null;
  if (letter === "u") {
    if (press.shiftKey) return context.canRedo ? { kind: "redo" } : null;
    return context.canUndo ? { kind: "undo" } : null;
  }
  if (!context.row || press.shiftKey) return null;
  if (press.key === "Enter") return press.target === "control" ? null : { kind: "open" };
  if (letter === "e") return context.canEdit ? { kind: "edit" } : null;
  return null;
}

/** The row `step` away from the current one, stopping at the first and last. Nothing selected starts from the first row. */
export function moveSelection<T>(ids: readonly T[], current: T | null, step: 1 | -1): T | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return ids[0] ?? null;
  return ids[Math.min(ids.length - 1, Math.max(0, at + step))] ?? null;
}
