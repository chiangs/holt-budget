/**
 * What each key does on Transactions (information-architecture-and-glossary.md, Keyboard). Typing always wins:
 * nothing fires in a text field or while a dialog is open. A key that a focused button already uses (Space and
 * Enter) is left to the button. Held keys repeat only to move through the list, so holding Space can't accept
 * every row. The navigation letters A O T P R M I S are never used here.
 */

export type KeyTarget =
  /** A text field, a select or anything the family types into. */
  | "field"
  /** A button, link or tab, which acts on Space and Enter by itself. */
  | "control"
  | "plain";

export interface KeyPress {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  readonly target: KeyTarget;
  /** A modal dialog is open, so the page behind it takes no keys. */
  readonly dialogOpen: boolean;
}

/** What the selected row allows, or null when there is no row. */
export interface RowKeys {
  readonly hasSuggestion: boolean;
  readonly canChooseJob: boolean;
}

export interface KeyContext {
  readonly row: RowKeys | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** A change is being saved. Another decision waits until it is done. */
  readonly busy: boolean;
}

export type KeyIntent =
  | { readonly kind: "move"; readonly step: 1 | -1 }
  | { readonly kind: "accept" }
  /** Space on a row with nothing to accept. */
  | { readonly kind: "noSuggestion" }
  | { readonly kind: "openActions" }
  | { readonly kind: "chooseJob" }
  | { readonly kind: "undo" }
  | { readonly kind: "redo" };

const bare = (press: KeyPress): boolean => !press.ctrlKey && !press.metaKey && !press.altKey;

/** The Import key (N). It works on every tab and, like every letter, never while the family is typing. */
export function isImportKey(press: KeyPress): boolean {
  return press.key.toLowerCase() === "n" && bare(press) && !press.shiftKey && !press.repeat && press.target !== "field" && !press.dialogOpen;
}

export function rowKey(press: KeyPress, context: KeyContext): KeyIntent | null {
  if (press.dialogOpen || press.target === "field" || press.altKey) return null;

  if (press.ctrlKey || press.metaKey) {
    if (press.key.toLowerCase() !== "z" || press.repeat || context.busy) return null;
    if (press.shiftKey) return context.canRedo ? { kind: "redo" } : null;
    return context.canUndo ? { kind: "undo" } : null;
  }

  const { row } = context;
  if (press.key === "ArrowDown" || (press.key.toLowerCase() === "j" && !press.shiftKey)) return row === null ? null : { kind: "move", step: 1 };
  if (press.key === "ArrowUp" || (press.key.toLowerCase() === "k" && !press.shiftKey)) return row === null ? null : { kind: "move", step: -1 };
  if (press.repeat || context.busy) return null;

  if (press.key.toLowerCase() === "u") {
    if (press.shiftKey) return context.canRedo ? { kind: "redo" } : null;
    return context.canUndo ? { kind: "undo" } : null;
  }
  if (row === null || press.shiftKey) return null;

  switch (press.key.toLowerCase()) {
    case " ":
      return press.target === "control" ? null : row.hasSuggestion ? { kind: "accept" } : { kind: "noSuggestion" };
    case "enter":
      return press.target === "control" ? null : { kind: "openActions" };
    case "e":
      return row.canChooseJob ? { kind: "chooseJob" } : null;
    default:
      return null;
  }
}
