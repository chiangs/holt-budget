/**
 * Undo and redo on Transactions apply to the changes the family made here. The log is shared by every screen,
 * so the change an undo would reverse may belong to another screen, such as an import, and a key pressed in
 * the list must never take that back. A change is offered for undo only while it is still the one an undo
 * would reverse, and for redo only while it is the one a redo would apply again.
 */

import type { ChangeId } from "@holt/core";
import type { IntlShape } from "react-intl";
import type { LedgerOutcome } from "../../data/ledger.tsx";
import type { LogHead, StepDirection } from "../../../../shared/ledger-types.ts";
import { problemText } from "./refusal.ts";

export function canStep(direction: StepDirection, head: LogHead | null, made: ReadonlySet<ChangeId>): boolean {
  const next = direction === "undo" ? head?.undo : head?.redo;
  return next !== undefined && next !== null && made.has(next.id);
}

export interface Message {
  /** "said" is a change that happened, and can be undone. "hint" is a word to the family that is not about a change. */
  readonly kind: "said" | "hint" | "problem";
  readonly text: string;
}

export interface Report {
  /** What to tell the family, always: a change that happened says so, and one that didn't says why. */
  readonly message: Message;
  /** The change that was saved, or null when nothing was. */
  readonly made: ChangeId | null;
  /** The change was saved but the page couldn't catch up, so it should take a new snapshot. */
  readonly refresh: boolean;
}

/** What a finished call means for the family. `done` is what to say when it worked. */
export function report(intl: IntlShape, outcome: LedgerOutcome, done: string, direction: StepDirection | null = null): Report {
  if (outcome.status === "applied") return { message: { kind: "said", text: done }, made: outcome.change.id, refresh: false };
  return {
    message: { kind: "problem", text: problemText(intl, outcome, direction) },
    made: null,
    refresh: outcome.status === "failed" && outcome.failure.code === "out-of-sync",
  };
}
