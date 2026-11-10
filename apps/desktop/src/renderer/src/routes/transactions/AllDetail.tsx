import type { Rule, Transaction } from "@holt/core";
import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { localDateOf } from "../../data/replica.ts";
import { formatFullDay } from "../../i18n/dates.ts";
import controls from "./AllControls.module.css";
import { type ActionId, type Source, actionLabel, availableActions } from "./AllDetail.model.ts";
import styles from "./AllDetail.module.css";
import { type Names, decidedWords, signedMoney, titleOf, treatmentWords } from "./AllLabels.model.ts";

export interface AllDetailProps {
  readonly transaction: Transaction;
  readonly names: Names;
  readonly currency: string;
  /** The rule that decided it, when one did. */
  readonly rule: Rule | undefined;
  /** The import rows that back it. */
  readonly sources: readonly Source[];
  readonly onAction: (action: Exclude<ActionId, "note">) => void;
  readonly onSaveNote: (note: string) => void;
  readonly onClose: () => void;
}

/** One transaction in full: what the bank said, how it was decided, where it came from, and what you can do about it. */
export function AllDetail({ transaction, names, currency, rule, sources, onAction, onSaveNote, onClose }: AllDetailProps) {
  const intl = useIntl();
  const titleId = useId();
  const noteField = useRef<HTMLTextAreaElement>(null);
  const saved = transaction.note ?? "";
  const [draft, setDraft] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setDraft(saved);
  }

  const treatment = treatmentWords(transaction, names);
  const decided = decidedWords(transaction, rule);
  const edited = draft.trim() !== saved;
  const day = (date: Transaction["bookingDate"]): string => formatFullDay(date, intl.locale);

  return (
    <aside className={styles.panel} aria-labelledby={titleId} data-testid="transaction-detail">
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 id={titleId} className={styles.title}>
            {titleOf(transaction)}
          </h2>
          <p className={`${styles.amount} ${controls.figure}`}>{signedMoney(transaction.amount, currency, intl.locale)}</p>
        </div>
        <button type="button" className={controls.iconButton} onClick={onClose} aria-label={intl.formatMessage({ id: "browse.detail.close" })}>
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>

      <p className={styles.treatment}>{intl.formatMessage({ id: treatment.id }, treatment.values)}</p>

      <section className={styles.section} aria-labelledby={`${titleId}-actions`}>
        <h3 id={`${titleId}-actions`} className={styles.heading}>
          {intl.formatMessage({ id: "browse.detail.actions" })}
        </h3>
        <ul className={styles.actions}>
          {availableActions(transaction).map((action) => (
            <li key={action}>
              <button
                type="button"
                className={`${controls.button} ${styles.action}`}
                onClick={() => {
                  if (action === "note") noteField.current?.focus();
                  else onAction(action);
                }}
              >
                {intl.formatMessage({ id: actionLabel(action, transaction) })}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <dl className={styles.facts}>
        <div>
          <dt>{intl.formatMessage({ id: "browse.detail.bank" })}</dt>
          <dd>{transaction.description}</dd>
        </div>
        <div>
          <dt>{intl.formatMessage({ id: "browse.detail.name" })}</dt>
          <dd>{transaction.counterparty ?? intl.formatMessage({ id: "browse.detail.noName" })}</dd>
        </div>
        <div>
          <dt>{intl.formatMessage({ id: "browse.detail.booked" })}</dt>
          <dd>{day(transaction.bookingDate)}</dd>
        </div>
        {transaction.transactionDate !== undefined && (
          <div>
            <dt>{intl.formatMessage({ id: "browse.detail.purchased" })}</dt>
            <dd>{day(transaction.transactionDate)}</dd>
          </div>
        )}
        <div>
          <dt>{intl.formatMessage({ id: "browse.detail.account" })}</dt>
          <dd>{names.account(transaction.accountId)}</dd>
        </div>
        {transaction.reference !== undefined && (
          <div>
            <dt>{intl.formatMessage({ id: "browse.detail.reference" })}</dt>
            <dd className={controls.figure}>{transaction.reference}</dd>
          </div>
        )}
        <div>
          <dt>{intl.formatMessage({ id: "browse.detail.decided" })}</dt>
          <dd>{intl.formatMessage({ id: decided.id }, decided.values)}</dd>
        </div>
      </dl>

      <section className={styles.section} aria-labelledby={`${titleId}-source`}>
        <h3 id={`${titleId}-source`} className={styles.heading}>
          {intl.formatMessage({ id: "browse.detail.source" })}
        </h3>
        {sources.length === 0 ? (
          <p className={styles.quiet}>{intl.formatMessage({ id: "browse.detail.noSource" })}</p>
        ) : (
          <ul className={styles.sources}>
            {sources.map((source) => (
              <li key={source.rowId} data-source={source.rowId}>
                {intl.formatMessage({ id: "browse.detail.sourceRow" }, { file: source.fileName, line: source.line, date: day(localDateOf(new Date(source.importedAt))) })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby={`${titleId}-note`}>
        <h3 id={`${titleId}-note`} className={styles.heading}>
          {intl.formatMessage({ id: "browse.detail.note" })}
        </h3>
        <textarea
          ref={noteField}
          className={controls.input}
          rows={3}
          value={draft}
          aria-labelledby={`${titleId}-note`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className={styles.noteActions}>
          <button type="button" className={`${controls.button} ${controls.primary}`} disabled={!edited} onClick={() => onSaveNote(draft)}>
            {intl.formatMessage({ id: draft.trim() === "" && saved !== "" ? "browse.detail.removeNote" : "browse.detail.saveNote" })}
          </button>
        </div>
      </section>

    </aside>
  );
}
