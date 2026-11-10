import type { IncomeSource, Month, Transaction } from "@holt/core";
import { type FormEvent, useState } from "react";
import { useIntl } from "react-intl";
import { defaultFundsMonth, fundsMonthChoices, incomeSources } from "./commands.model.ts";
import controls from "./Controls.module.css";
import styles from "./Dialogs.module.css";
import { Modal } from "./Modal.tsx";

export interface IncomeDialogProps {
  readonly transaction: Transaction;
  readonly subject: string;
  readonly onSubmit: (fundsMonth: Month, source: IncomeSource) => void;
  readonly onClose: () => void;
}

const sourceLabels: Record<IncomeSource, string> = {
  contribution: "needsYou.income.source.contribution",
  recurring: "needsYou.income.source.recurring",
  other: "needsYou.income.source.other",
};

/** Money in that is income: the month it funds, usually the month after it arrives, and where it comes from. */
export function IncomeDialog({ transaction, subject, onSubmit, onClose }: IncomeDialogProps) {
  const intl = useIntl();
  const [fundsMonth, setFundsMonth] = useState<Month>(() => defaultFundsMonth(transaction.bookingDate));
  const [source, setSource] = useState<IncomeSource>("contribution");
  const monthName = (m: Month) => {
    const [year, month] = m.split("-").map(Number) as [number, number];
    return intl.formatDate(new Date(Date.UTC(year, month - 1, 1)), { month: "long", year: "numeric", timeZone: "UTC" });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(fundsMonth, source);
  };

  return (
    <Modal title={intl.formatMessage({ id: "needsYou.income.title" })} subject={subject} hint={intl.formatMessage({ id: "needsYou.income.hint" })} onClose={onClose}>
      <form className={styles["form"]} onSubmit={submit}>
        <div className={styles["group"]}>
          <label htmlFor="income-month" className={styles["label"]}>
            {intl.formatMessage({ id: "needsYou.income.month" })}
          </label>
          <select id="income-month" className={`${controls["field"]} ${styles["select"]}`} value={fundsMonth} onChange={(event) => setFundsMonth(event.target.value as Month)}>
            {fundsMonthChoices(transaction.bookingDate).map((m) => (
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
