import type { Currency, Facts, FamilyCommand } from "@holt/core";
import { Check, Info, Minus } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import type { Message } from "../transactions/decisions.model.ts";
import { type Words, say } from "../transactions/ImportSay.ts";
import cards from "./Cards.module.css";
import { refusalSince } from "./MoneyInFeedback.tsx";
import {
  type MoveRow,
  type MovesView,
  markDone,
  markedDoneWords,
  moveWords,
  proofWords,
  skip,
  skippedWords,
  statusWords,
  unmovedWords,
} from "./Moves.model.ts";
import { MovesAddDialog } from "./MovesAddDialog.tsx";
import styles from "./Moves.module.css";

export interface MovesPanelProps {
  readonly facts: Facts;
  readonly view: MovesView;
  readonly currency: Currency;
  readonly busy: boolean;
  readonly message: Message | null;
  /** Runs one command and says `done` once it is saved. True when it was. */
  readonly onSubmit: (command: FamilyCommand, done: string) => Promise<boolean>;
  /** What the last change did, and Undo. */
  readonly feedback: ReactNode;
  readonly onDialog: (open: boolean) => void;
}

function StatusIcon({ row }: { readonly row: MoveRow }) {
  if (row.status.kind === "done") return <Check size={14} strokeWidth={2.2} aria-hidden="true" />;
  if (row.status.kind === "skipped") return <Minus size={14} strokeWidth={2.2} aria-hidden="true" />;
  return null;
}

/** Moves at the bank: the transfers this month needs between the family's accounts, whether an import has shown each one done, and one-off moves the family adds. Holt never moves money. */
export function MovesPanel({ facts, view, currency, busy, message, onSubmit, feedback, onDialog }: MovesPanelProps) {
  const intl = useIntl();
  const titleId = useId();
  const [adding, setAdding] = useState<{ readonly opened: Message | null } | null>(null);
  const rowElements = useRef(new Map<string, HTMLLIElement>());
  const focusRow = useRef<string | null>(null);
  const words = (value: Words) => say(intl, currency, value);

  // After a move is marked done or skipped its buttons are gone, so focus goes to the move itself.
  useEffect(() => {
    if (focusRow.current === null) return;
    rowElements.current.get(focusRow.current)?.focus();
    focusRow.current = null;
  });

  const act = async (row: MoveRow, command: FamilyCommand, done: string) => {
    if (await onSubmit(command, done)) focusRow.current = row.key;
  };

  const refusal = adding === null ? null : refusalSince(message, adding.opened);

  return (
    <section className={cards["card"]} aria-labelledby={titleId}>
      <div className={styles["head"]}>
        <h2 id={titleId} className="type-title-section">
          {intl.formatMessage({ id: "plan.moves.title" })}
        </h2>
        <p className={cards["lead"]}>{intl.formatMessage({ id: "plan.moves.intro" })}</p>
      </div>

      {view.rows.length === 0 ? (
        <p className={styles["empty"]}>{intl.formatMessage({ id: "plan.moves.empty" })}</p>
      ) : (
        <ul className={styles["list"]} aria-label={intl.formatMessage({ id: "plan.moves.list" })}>
          {view.rows.map((row) => {
            const proof = proofWords(row.status);
            const sentence = words(moveWords(row));
            const { moveId } = row;
            return (
              <li
                key={row.key}
                ref={(element) => {
                  if (element === null) rowElements.current.delete(row.key);
                  else rowElements.current.set(row.key, element);
                }}
                tabIndex={-1}
                className={styles["move"]}
                data-status={row.status.kind}
              >
                <p className={styles["sentence"]}>{sentence}</p>
                <div className={styles["status"]}>
                  <span className={`${controls["pill"]} ${styles["pill"]} ${row.status.kind === "done" ? controls["good"] : ""}`}>
                    <StatusIcon row={row} />
                    {words(statusWords(row.status))}
                  </span>
                  {proof !== null && <span className={styles["detail"]}>{words(proof)}</span>}
                  {row.reason !== null && <span className={styles["detail"]}>{intl.formatMessage({ id: "plan.moves.why" }, { reason: row.reason })}</span>}
                </div>
                {row.canAct && moveId !== null && (
                  <div className={styles["actions"]}>
                    <button
                      type="button"
                      className={controls["button"]}
                      disabled={busy}
                      aria-label={intl.formatMessage({ id: "plan.moves.markDoneFor" }, { move: sentence })}
                      onClick={() => void act(row, markDone(moveId), words(markedDoneWords(row)))}
                    >
                      {intl.formatMessage({ id: "plan.moves.markDone" })}
                    </button>
                    <button
                      type="button"
                      className={controls["button"]}
                      disabled={busy}
                      aria-label={intl.formatMessage({ id: "plan.moves.skipFor" }, { move: sentence })}
                      onClick={() => void act(row, skip(moveId), words(skippedWords(row)))}
                    >
                      {intl.formatMessage({ id: "plan.moves.skip" })}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {view.unmoved.map((note) => (
        <p key={`${note.accountId}-${note.kind}`} className={styles["note"]}>
          <Info size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{words(unmovedWords(note))}</span>
        </p>
      ))}

      {feedback}

      <div className={styles["actions"]}>
        <button
          type="button"
          className={controls["button"]}
          aria-haspopup="dialog"
          onClick={() => {
            setAdding({ opened: message });
            onDialog(true);
          }}
        >
          {intl.formatMessage({ id: "plan.moves.add" })}
        </button>
      </div>

      {adding !== null && (
        <MovesAddDialog
          facts={facts}
          month={view.month}
          currency={currency}
          busy={busy}
          refusal={refusal}
          onSubmit={onSubmit}
          onClose={() => {
            setAdding(null);
            onDialog(false);
          }}
        />
      )}
    </section>
  );
}
