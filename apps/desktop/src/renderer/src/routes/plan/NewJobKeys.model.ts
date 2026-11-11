/**
 * What a key does while the New job flow is on the screen. Typing always wins: nothing but Esc acts in a text
 * field, so a name with an N, a U or a J in it never starts anything. A letter the flow doesn't use is kept from
 * the shortcuts behind it, because a key pressed in the form must not move the table's selection or navigate away.
 */

import type { KeyPress } from "../transactions/keys.model.ts";

export type FlowKeyContext = {
  /** The flow is showing what Add job did, so U takes it back. */
  readonly added: boolean;
  /** A change is being saved. Another waits until it is done. */
  readonly busy: boolean;
};

export type FlowKeyIntent = { readonly kind: "close" } | { readonly kind: "undo" };

export function flowKey(press: KeyPress, context: FlowKeyContext): FlowKeyIntent | null {
  if (press.key === "Escape" && !press.ctrlKey && !press.metaKey && !press.altKey && !press.shiftKey && !press.repeat) return { kind: "close" };
  if (press.dialogOpen || press.target === "field" || press.ctrlKey || press.metaKey || press.altKey || press.shiftKey || press.repeat) return null;
  if (press.key.toLowerCase() === "u" && context.added && !context.busy) return { kind: "undo" };
  return null;
}

/** Whether a key press in the flow stays in the flow. Modified keys go on to the browser and the app, so Ctrl Z still works in a text field. */
export function keepsToFlow(press: Pick<KeyPress, "ctrlKey" | "metaKey" | "altKey">): boolean {
  return !press.ctrlKey && !press.metaKey && !press.altKey;
}
