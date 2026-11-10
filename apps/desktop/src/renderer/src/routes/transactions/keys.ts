import type { KeyPress, KeyTarget } from "./keys.model.ts";

const textFields = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const controls = "button, a[href], summary, [role='tab'], [role='menuitem'], [role='option']";

/** What the key was pressed on: a place the family types, a control that acts on Space and Enter, or neither. */
export function targetOf(target: EventTarget | null): KeyTarget {
  if (!(target instanceof HTMLElement)) return "plain";
  if (target.isContentEditable || textFields.has(target.tagName)) return "field";
  return target.closest(controls) === null ? "plain" : "control";
}

/** Any modal on the page, whoever opened it: a native dialog, or one marked as a dialog. */
export function anyDialogOpen(): boolean {
  return document.querySelector("dialog[open], [role='dialog'], [aria-modal='true']") !== null;
}

export function pressOf(event: KeyboardEvent): KeyPress {
  return {
    key: event.key,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    repeat: event.repeat,
    target: targetOf(event.target),
    dialogOpen: anyDialogOpen(),
  };
}
