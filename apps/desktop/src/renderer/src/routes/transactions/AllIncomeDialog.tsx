import type { IncomeSource, Month, Transaction } from "@holt/core";
import { useId, useState } from "react";
import { useIntl } from "react-intl";
import { AllModal } from "./AllModal.tsx";
import controls from "./AllControls.module.css";
import { defaultFundsMonth, fundsMonthChoices } from "./AllDetail.model.ts";
import { titleOf } from "./AllLabels.model.ts";

export interface AllIncomeDialogProps {
  readonly transaction: Transaction;
  readonly monthLabel: (month: Month) => string;
  readonly onSubmit: (fundsMonth: Month, source: IncomeSource) => void;
  readonly onClose: () => void;
}

const sources = [
  ["other", "browse.income.source.other"],
  ["contribution", "browse.income.source.contribution"],
  ["recurring", "browse.income.source.recurring"],
] as const satisfies readonly (readonly [IncomeSource, string])[];

/** Money in that funds a month. It is not a refund: a refund reduces what a job spent, and income pays for a month's plan. */
export function AllIncomeDialog({ transaction, monthLabel, onSubmit, onClose }: AllIncomeDialogProps) {
  const intl = useIntl();
  const titleId = useId();
  const current = transaction.treatment.kind === "income" ? transaction.treatment : null;
  const [month, setMonth] = useState<Month>(current?.fundsMonth ?? defaultFundsMonth(transaction));
  const [source, setSource] = useState<IncomeSource>(current?.source ?? "other");
  const choices = fundsMonthChoices(transaction);
  const monthChoices = choices.includes(month) ? choices : [month, ...choices];

  return (
    <AllModal labelledBy={titleId} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(month, source);
        }}
      >
        <h2 id={titleId} className={controls.title}>
          {intl.formatMessage({ id: "browse.income.title" })}
        </h2>
        <p className={controls.lead}>{intl.formatMessage({ id: "browse.income.about" }, { name: titleOf(transaction) })}</p>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${titleId}-month`}>
            {intl.formatMessage({ id: "browse.income.month" })}
          </label>
          <select id={`${titleId}-month`} className={controls.input} value={month} autoFocus onChange={(event) => setMonth(event.target.value as Month)}>
            {monthChoices.map((choice) => (
              <option key={choice} value={choice}>
                {monthLabel(choice)}
              </option>
            ))}
          </select>
        </div>
        <p className={controls.lead}>{intl.formatMessage({ id: "browse.income.monthHelp" })}</p>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${titleId}-source`}>
            {intl.formatMessage({ id: "browse.income.source" })}
          </label>
          <select id={`${titleId}-source`} className={controls.input} value={source} onChange={(event) => setSource(event.target.value as IncomeSource)}>
            {sources.map(([value, messageId]) => (
              <option key={value} value={value}>
                {intl.formatMessage({ id: messageId })}
              </option>
            ))}
          </select>
        </div>
        <div className={controls.actions}>
          <button type="button" className={controls.button} onClick={onClose}>
            {intl.formatMessage({ id: "browse.income.cancel" })}
          </button>
          <button type="submit" className={`${controls.button} ${controls.primary}`}>
            {intl.formatMessage({ id: "browse.income.save" })}
          </button>
        </div>
      </form>
    </AllModal>
  );
}
