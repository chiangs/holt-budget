import { type Transaction, type TransactionId, householdOf } from "@holt/core";
import { useId, useState } from "react";
import { useIntl } from "react-intl";
import { useFactsView } from "../../data/ledger.tsx";
import { formatFullDay } from "../../i18n/dates.ts";
import { AllModal } from "./AllModal.tsx";
import controls from "./AllControls.module.css";
import { signedMoney, titleOf } from "./AllLabels.model.ts";
import styles from "./TransferDialog.module.css";
import { orderCandidates } from "./TransferDialog.model.ts";

export interface TransferDialogProps {
  readonly transaction: Transaction;
  /** The transactions in other accounts it could pair with: core's `transferCandidates`, asked for any transaction, not only one that waits. */
  readonly candidates: readonly Transaction[];
  readonly accountName: (transaction: Transaction) => string;
  /** The partner the family chose, or null for "the other side isn't imported yet". */
  readonly onSubmit: (partner: TransactionId | null) => void;
  readonly onClose: () => void;
}

const noPartner = "none";

/**
 * Marks a transaction as a transfer and pairs it. The best candidate, the one booked nearest in time, comes
 * first and is chosen to begin with. Holt never moves money, and the dialog says so.
 */
export function TransferDialog({ transaction, candidates, accountName, onSubmit, onClose }: TransferDialogProps) {
  const intl = useIntl();
  const view = useFactsView();
  const titleId = useId();
  const groupName = useId();
  const ordered = orderCandidates(transaction, candidates);
  const [choice, setChoice] = useState<TransactionId | typeof noPartner>(ordered[0]?.id ?? noPartner);
  const currency = view === null ? null : householdOf(view.facts).currency;
  if (currency === null) return null;

  const current = transaction.treatment.kind === "transfer" ? transaction.treatment.partner : null;
  const money = (t: Transaction): string => signedMoney(t.amount, currency, intl.locale);

  return (
    <AllModal labelledBy={titleId} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(choice === noPartner ? null : choice);
        }}
      >
        <h2 id={titleId} className={controls.title}>
          {intl.formatMessage({ id: transaction.treatment.kind === "transfer" ? "browse.transfer.titleChange" : "browse.transfer.title" })}
        </h2>
        <p className={controls.lead}>
          {intl.formatMessage(
            { id: "browse.transfer.about" },
            { name: titleOf(transaction), account: accountName(transaction), date: formatFullDay(transaction.bookingDate, intl.locale), amount: money(transaction) },
          )}
        </p>
        <p className={styles.explain}>{intl.formatMessage({ id: "browse.transfer.explain" })}</p>

        <fieldset className={styles.group}>
          <legend className={controls.label}>{intl.formatMessage({ id: ordered.length === 0 ? "browse.transfer.legendNone" : "browse.transfer.legend" })}</legend>
          {ordered.length === 0 && <p className={styles.none}>{intl.formatMessage({ id: "browse.transfer.none" })}</p>}
          {ordered.map((candidate, i) => (
            <label key={candidate.id} className={styles.option}>
              <input type="radio" name={groupName} value={candidate.id} checked={choice === candidate.id} onChange={() => setChoice(candidate.id)} autoFocus={i === 0} />
              <span className={styles.text}>
                <span className={styles.line}>
                  <span className={styles.account}>{accountName(candidate)}</span>
                  <span className={`${controls.figure} ${styles.amount}`}>{money(candidate)}</span>
                </span>
                <span className={styles.meta}>
                  {formatFullDay(candidate.bookingDate, intl.locale)}
                  <span aria-hidden="true"> · </span>
                  {candidate.description}
                </span>
                {(i === 0 && ordered.length > 1) || candidate.id === current ? (
                  <span className={styles.tags}>
                    {i === 0 && ordered.length > 1 && <span className={styles.tag}>{intl.formatMessage({ id: "browse.transfer.closest" })}</span>}
                    {candidate.id === current && <span className={styles.tag}>{intl.formatMessage({ id: "browse.transfer.current" })}</span>}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          <label className={styles.option}>
            <input type="radio" name={groupName} value={noPartner} checked={choice === noPartner} onChange={() => setChoice(noPartner)} autoFocus={ordered.length === 0} />
            <span className={styles.text}>
              <span className={styles.account}>{intl.formatMessage({ id: "browse.transfer.notImported" })}</span>
              <span className={styles.meta}>{intl.formatMessage({ id: "browse.transfer.notImportedHelp" })}</span>
            </span>
          </label>
        </fieldset>

        <div className={controls.actions}>
          <button type="button" className={controls.button} onClick={onClose}>
            {intl.formatMessage({ id: "browse.transfer.cancel" })}
          </button>
          <button type="submit" className={`${controls.button} ${controls.primary}`}>
            {intl.formatMessage({ id: choice === noPartner ? "browse.transfer.saveWaiting" : "browse.transfer.savePair" })}
          </button>
        </div>
      </form>
    </AllModal>
  );
}
