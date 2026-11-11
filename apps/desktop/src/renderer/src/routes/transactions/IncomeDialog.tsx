import type { AgreementId, IncomeSource, Month, Transaction } from "@holt/core";
import { type FormEvent, useState } from "react";
import { useIntl } from "react-intl";
import { defaultFundsMonth, fundsMonthChoices, incomeSources } from "./commands.model.ts";
import type { AgreementOption, ContributionSuggestion } from "./needsYou.model.ts";
import controls from "./Controls.module.css";
import styles from "./Dialogs.module.css";
import { Modal } from "./Modal.tsx";

export interface IncomeDialogProps {
  readonly transaction: Transaction;
  readonly subject: string;
  /** The agreement is only ever set for a contribution, and is null for no one in particular. */
  readonly onSubmit: (fundsMonth: Month, source: IncomeSource, agreement: AgreementId | null) => void;
  readonly onClose: () => void;
  /** The agreements a payment for a month could be a payment of. Without it the dialog offers no choice of person. */
  readonly agreementsFor?: (fundsMonth: Month) => readonly AgreementOption[];
  /** What the app suggested for this payment, when it suggested a contribution: the dialog starts from it. */
  readonly suggested?: ContributionSuggestion;
}

const sourceLabels: Record<IncomeSource, string> = {
  contribution: "needsYou.income.source.contribution",
  recurring: "needsYou.income.source.recurring",
  other: "needsYou.income.source.other",
};

/** Money in that is income: the month it funds, usually the month after it arrives, and where it comes from. */
export function IncomeDialog({ transaction, subject, onSubmit, onClose, agreementsFor, suggested }: IncomeDialogProps) {
  const intl = useIntl();
  const [fundsMonth, setFundsMonth] = useState<Month>(() => suggested?.fundsMonth ?? defaultFundsMonth(transaction.bookingDate));
  const [source, setSource] = useState<IncomeSource>("contribution");
  const [chosen, setChosen] = useState<AgreementId | null>(suggested?.agreementId ?? null);
  const options = source === "contribution" && agreementsFor !== undefined ? agreementsFor(fundsMonth) : [];
  const agreement = options.some((option) => option.agreementId === chosen) ? chosen : null;
  const months = fundsMonthChoices(transaction.bookingDate);
  const monthName = (m: Month) => {
    const [year, month] = m.split("-").map(Number) as [number, number];
    return intl.formatDate(new Date(Date.UTC(year, month - 1, 1)), { month: "long", year: "numeric", timeZone: "UTC" });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(fundsMonth, source, agreement);
  };

  return (
    <Modal title={intl.formatMessage({ id: "needsYou.income.title" })} subject={subject} hint={intl.formatMessage({ id: "needsYou.income.hint" })} onClose={onClose}>
      <form className={styles["form"]} onSubmit={submit}>
        <div className={styles["group"]}>
          <label htmlFor="income-month" className={styles["label"]}>
            {intl.formatMessage({ id: "needsYou.income.month" })}
          </label>
          <select id="income-month" className={`${controls["field"]} ${styles["select"]}`} value={fundsMonth} onChange={(event) => setFundsMonth(event.target.value as Month)}>
            {(months.includes(fundsMonth) ? months : [fundsMonth, ...months]).map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </div>
        <fieldset className={styles["group"]}>
          <legend className={styles["legend"]}>{intl.formatMessage({ id: "needsYou.income.source" })}</legend>
          {incomeSources.map((option) => (
            <label key={option} className={styles["choice"]}>
              <input type="radio" name="income-source" value={option} checked={source === option} onChange={() => setSource(option)} />
              {intl.formatMessage({ id: sourceLabels[option] })}
            </label>
          ))}
        </fieldset>
        {options.length > 0 && (
          <fieldset className={styles["group"]}>
            <legend className={styles["legend"]}>{intl.formatMessage({ id: "needsYou.income.agreement" })}</legend>
            <label className={styles["choice"]}>
              <input type="radio" name="income-agreement" checked={agreement === null} onChange={() => setChosen(null)} />
              {intl.formatMessage({ id: "needsYou.income.agreement.none" })}
            </label>
            {options.map((option) => (
              <label key={option.agreementId} className={styles["choice"]}>
                <input type="radio" name="income-agreement" value={option.agreementId} checked={agreement === option.agreementId} onChange={() => setChosen(option.agreementId)} />
                {option.personName}
              </label>
            ))}
            <p className={styles["help"]}>{intl.formatMessage({ id: "needsYou.income.agreement.help" })}</p>
          </fieldset>
        )}
        <div className={styles["actions"]}>
          <button type="button" className={controls["button"]} onClick={onClose}>
            {intl.formatMessage({ id: "needsYou.cancel" })}
          </button>
          <button type="submit" className={`${controls["button"]} ${controls["primary"]}`}>
            {intl.formatMessage({ id: "needsYou.income.submit" })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
