import { type ImportBatchId, householdOf } from "@holt/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useFactsView, useLedger } from "../../data/ledger.tsx";
import { formatDay } from "../../i18n/dates.ts";
import { formatMoney } from "../../i18n/money.ts";
import { ImportModal } from "./ImportModal.tsx";
import { type UndoDescription, type UndoLine, firstOf, undoView } from "./ImportUndo.model.ts";
import { refusalText } from "./refusal.ts";
import kit from "./ImportKit.module.css";
import styles from "./ImportUndoDialog.module.css";

export interface ImportUndoDialogProps {
  readonly batchId: ImportBatchId;
  readonly onClose: () => void;
  /** The undo was applied. The parent closes this dialog and says what happened. */
  readonly onUndone: (removed: number, fileName: string) => void;
}

const showFirst = 5;
const showChanged = 50;

/** What undoing a whole import would remove, keep and change, worked out on the page's own copy of the facts before anything happens. */
export function ImportUndoDialog({ batchId, onClose, onUndone }: ImportUndoDialogProps) {
  const intl = useIntl();
  const ledger = useLedger();
  const view = useFactsView();
  const titleId = useId();
  const shell = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const [working, setWorking] = useState(false);
  const [held, setHeld] = useState<UndoDescription | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const live = useMemo(() => (view === null ? null : undoView(view.facts, batchId)), [view?.facts, batchId]);
  // Once the app has applied the undo the facts say it is done, and this dialog still shows what it was asked to do.
  const description = held ?? live;
  const currency = view === null ? "NOK" : householdOf(view.facts).currency;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  if (description === null) return null;

  const finish = (): void => {
    shell.current?.close();
    onClose();
  };

  const confirm = async (): Promise<void> => {
    if (!description.ok || working) return;
    setHeld(description);
    setWorking(true);
    setProblem(null);
    const outcome = await ledger.run({ kind: "undoImport", batchId });
    if (!alive.current) return;
    if (outcome.status === "applied") {
      shell.current?.close();
      onUndone(description.view.removed, description.view.fileName);
      return;
    }
    setWorking(false);
    setHeld(null);
    setProblem(
      outcome.status === "refused"
        ? refusalText(intl, outcome.refusal)
        : outcome.status === "conflict"
          ? intl.formatMessage({ id: "import.undo.conflict" })
          : intl.formatMessage({ id: outcome.failure.code === "unreachable" || outcome.failure.code === "bad-reply" || outcome.failure.code === "out-of-sync" ? "import.undo.unsure" : "import.undo.failed" }),
    );
  };

  const line = (item: UndoLine, extra?: string) => (
    <li key={item.transactionId} className={styles.line}>
      <span className={kit.mono}>{formatDay(item.date, intl.locale)}</span>
      <span className={styles.description}>{item.description}</span>
      <span className={kit.mono}>{formatMoney(item.amount, currency, intl.locale)}</span>
      {extra !== undefined && <span className={kit.muted}>{extra}</span>}
    </li>
  );
  const more = (count: number) => count > 0 && <li className={kit.muted}>{intl.formatMessage({ id: "import.undo.more" }, { count })}</li>;

  return (
    <ImportModal labelId={titleId} dialogRef={shell} size="narrow" onRequestClose={() => (working ? undefined : finish())}>
      <div className={kit.head}>
        <div>
          <h2 id={titleId} ref={heading} tabIndex={-1} className={kit.title}>
            {description.ok ? intl.formatMessage({ id: "import.undo.title" }, { fileName: description.view.fileName }) : intl.formatMessage({ id: "import.list.undo" })}
          </h2>
        </div>
      </div>
      <div className={`${kit.body} ${kit.focusable}`} role="group" aria-labelledby={titleId} aria-busy={working} tabIndex={0}>
        {description.ok ? (
          <>
            <p className={kit.strong}>{intl.formatMessage({ id: "import.undo.removes" }, { count: description.view.removed })}</p>
            {description.view.changed.length > 0 ? (
              <section className={styles.section} aria-labelledby={`${titleId}-changed`}>
                <h3 id={`${titleId}-changed`} className={kit.sectionTitle}>
                  {intl.formatMessage({ id: "import.undo.changed" }, { count: description.view.changed.length })}
                </h3>
                <ul className={styles.lines}>
                  {firstOf(description.view.changed, showChanged).shown.map((item) =>
                    line(
                      item,
                      item.changes.map((change) => intl.formatMessage({ id: change === "note" ? "import.undo.changeNote" : "import.undo.changeTreatment" })).join(" · "),
                    ),
                  )}
                  {more(firstOf(description.view.changed, showChanged).more)}
                </ul>
              </section>
            ) : (
              <p className={kit.muted}>{intl.formatMessage({ id: "import.undo.noneChanged" })}</p>
            )}
            {description.view.keptByAnotherImport.length > 0 && (
              <section className={styles.section}>
                <p>{intl.formatMessage({ id: "import.undo.keptAnother" }, { count: description.view.keptByAnotherImport.length })}</p>
                <ul className={styles.lines}>
                  {firstOf(description.view.keptByAnotherImport, showFirst).shown.map((item) => line(item))}
                  {more(firstOf(description.view.keptByAnotherImport, showFirst).more)}
                </ul>
              </section>
            )}
            {description.view.keptRecordedByHand.length > 0 && (
              <section className={styles.section}>
                <p>{intl.formatMessage({ id: "import.undo.keptHand" }, { count: description.view.keptRecordedByHand.length })}</p>
                <ul className={styles.lines}>
                  {firstOf(description.view.keptRecordedByHand, showFirst).shown.map((item) => line(item))}
                  {more(firstOf(description.view.keptRecordedByHand, showFirst).more)}
                </ul>
              </section>
            )}
            {description.view.moves.length > 0 && (
              <section className={styles.section}>
                <p>{intl.formatMessage({ id: "import.undo.moves" }, { count: description.view.moves.length })}</p>
                <ul className={styles.lines}>
                  {firstOf(description.view.moves, showFirst).shown.map((move) => (
                    <li key={move.moveId} className={styles.line}>
                      <span>{intl.formatMessage({ id: "import.undo.moveLine" }, { amount: formatMoney(move.amount, currency, intl.locale), from: move.from, to: move.to })}</span>
                      {move.reason !== "" && <span className={kit.muted}>{move.reason}</span>}
                    </li>
                  ))}
                  {more(firstOf(description.view.moves, showFirst).more)}
                </ul>
              </section>
            )}
            {description.view.partners.length > 0 && (
              <section className={styles.section}>
                <p>{intl.formatMessage({ id: "import.undo.partners" }, { count: description.view.partners.length })}</p>
                <ul className={styles.lines}>
                  {firstOf(description.view.partners, showFirst).shown.map((item) => line(item))}
                  {more(firstOf(description.view.partners, showFirst).more)}
                </ul>
              </section>
            )}
          </>
        ) : (
          <p>{refusalText(intl, description.refusal)}</p>
        )}
        {problem !== null && (
          <div className={`${kit.notice} ${kit.noticeProblem}`} role="alert">
            <p className={kit.noticeBody}>{problem}</p>
          </div>
        )}
      </div>
      <div className={kit.foot}>
        {description.ok && (
          <button type="button" className={kit.primary} aria-disabled={working} onClick={() => void confirm()}>
            {intl.formatMessage({ id: working ? "import.undo.working" : "import.undo.confirm" })}
          </button>
        )}
        <button type="button" className={kit.secondary} disabled={working} onClick={finish}>
          {intl.formatMessage({ id: description.ok ? "import.undo.keep" : "import.close" })}
        </button>
      </div>
    </ImportModal>
  );
}
