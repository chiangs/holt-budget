import type { ChangeConflict, Refusal } from "@holt/core";
import type { IntlShape } from "react-intl";
import type { LedgerOutcome } from "../../data/ledger.tsx";

/**
 * The words for a refusal. The message files hold one entry per refusal code (`refusal.<code>`), with core's
 * English text as the source; until a code has one, core's own text is shown. Owned by the Needs you work.
 */
export function refusalText(intl: IntlShape, refusal: Refusal): string {
  const id = `refusal.${refusal.code}`;
  return id in intl.messages ? intl.formatMessage({ id }) : refusal.message;
}

type Problem = Exclude<LedgerOutcome, { readonly status: "applied" }>;

function conflictText(intl: IntlShape, conflict: ChangeConflict, direction: "undo" | "redo" | null): string {
  switch (conflict.kind) {
    case "nothingToUndo":
      return intl.formatMessage({ id: "needsYou.problem.nothingToUndo" });
    case "nothingToRedo":
      return intl.formatMessage({ id: "needsYou.problem.nothingToRedo" });
    case "rowsChanged":
      return intl.formatMessage({ id: direction === "redo" ? "needsYou.problem.redoBlocked" : "needsYou.problem.undoBlocked" });
  }
}

/**
 * What to tell the family when a change did not happen: core's refusal in the message file's words, an undo
 * or redo that found the rows changed since, or a call that did not work. Nothing is ever swallowed.
 */
export function problemText(intl: IntlShape, outcome: Problem, direction: "undo" | "redo" | null = null): string {
  switch (outcome.status) {
    case "refused":
      return refusalText(intl, outcome.refusal);
    case "conflict":
      return conflictText(intl, outcome.conflict, direction);
    case "failed":
      return intl.formatMessage({ id: outcome.failure.code === "out-of-sync" ? "needsYou.problem.outOfSync" : "needsYou.problem.failed" });
  }
}
