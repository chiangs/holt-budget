import { useEffect, useEffectEvent } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import type { Decisions } from "../transactions/decisions.ts";
import type { Message } from "../transactions/decisions.model.ts";
import { pressOf } from "../transactions/keys.ts";
import styles from "./MoneyIn.module.css";
import { planKey } from "./PlanKeys.model.ts";

/** The reason a dialog shows for a change that did not happen: a problem that came after the dialog opened. */
export function refusalSince(message: Message | null, opened: Message | null): string | null {
  return message?.kind === "problem" && message !== opened ? message.text : null;
}

/** U undoes and Shift U redoes what the family changed in these panels, by the same rules as the rest of Plan: never in a field or a dialog. */
export function useUndoKeys({ canUndo, canRedo, busy, stepBy }: Pick<Decisions, "canUndo" | "canRedo" | "busy" | "stepBy">): void {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const intent = planKey(pressOf(event), { row: false, canEdit: false, panelOpen: false, canUndo, canRedo, busy });
    if (intent?.kind !== "undo" && intent?.kind !== "redo") return;
    event.preventDefault();
    void stepBy(intent.kind);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}

export interface FeedbackProps {
  readonly decisions: Decisions;
  /** A dialog is open and shows its own refusals, so the panel does not say them twice. */
  readonly dialogOpen: boolean;
  /** The last change was made in this panel. The region stays on the page either way, so a screen reader hears it when it fills. */
  readonly active: boolean;
}

/** What the last change did, with Undo and Redo while the change is still the one they would reverse, and why a change did not happen. */
export function Feedback({ decisions, dialogOpen, active }: FeedbackProps) {
  const intl = useIntl();
  const { busy, canUndo, canRedo, stepBy } = decisions;
  const message = active ? decisions.message : null;
  const said = message?.kind === "said";
  return (
    <div className={styles["notices"]}>
      <div className={styles["feedback"]} role="status" aria-live="polite">
        {message !== null && message.kind !== "problem" && <p className={styles["said"]}>{message.text}</p>}
        {said && canUndo && (
          <button type="button" className={controls["button"]} aria-keyshortcuts="U" disabled={busy} onClick={() => void stepBy("undo")}>
            {intl.formatMessage({ id: "plan.undo" })}
            <span className={controls["key"]} aria-hidden="true">
              {intl.formatMessage({ id: "plan.key.u" })}
            </span>
          </button>
        )}
        {said && canRedo && (
          <button type="button" className={controls["button"]} aria-keyshortcuts="Shift+U" disabled={busy} onClick={() => void stepBy("redo")}>
            {intl.formatMessage({ id: "plan.redo" })}
            <span className={controls["key"]} aria-hidden="true">
              {intl.formatMessage({ id: "plan.key.shiftU" })}
            </span>
          </button>
        )}
      </div>
      <div role="alert" className={styles["alert"]}>
        {message?.kind === "problem" && !dialogOpen && <p className={styles["problem"]}>{message.text}</p>}
      </div>
    </div>
  );
}
