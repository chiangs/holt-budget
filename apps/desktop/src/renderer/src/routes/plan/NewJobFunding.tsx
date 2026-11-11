import { type Currency, type Facts, type JobId, type Month, addMonths } from "@holt/core";
import { Check } from "lucide-react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import styles from "./NewJob.module.css";
import { type Funding, fundingKey } from "./NewJob.model.ts";
import { fundingNote, optionLabel, skippedNote } from "./NewJob.text.ts";

export interface NewJobFundingProps {
  /** Null until the amount can be read. */
  readonly funding: Funding | null;
  readonly facts: Facts;
  readonly currency: Currency;
  /** The month Plan shows. */
  readonly month: Month;
  readonly onChoose: (key: string) => void;
}

/** "Where does the money come from?": the money with no job first, then the options for the rest. Nothing is taken from another job until Add job. */
export function NewJobFunding({ funding, facts, currency, month, onChoose }: NewJobFundingProps) {
  const intl = useIntl();
  const jobName = (id: JobId) => facts.jobs.get(id)?.name ?? "";
  const options = funding?.kind === "options" ? funding.options.options : [];
  const choosing = options.some((option) => option.kind !== "unassigned");

  return (
    <fieldset className={styles["group"]}>
      <legend className={styles["legend"]}>{intl.formatMessage({ id: "plan.new.from.legend" })}</legend>
      {funding === null && <p className={styles["help"]}>{intl.formatMessage({ id: "plan.new.from.waiting" })}</p>}
      {funding?.kind === "skipped" && <p className={styles["help"]}>{skippedNote(intl, funding.access, month, addMonths(month, 1))}</p>}
      {funding?.kind === "options" && <p className={styles["help"]}>{fundingNote(intl, funding, currency)}</p>}
      {funding?.kind === "options" && choosing && (
        <div role="group" aria-label={intl.formatMessage({ id: "plan.new.from.take" })} className={styles["pills"]}>
          {options.map((option) => {
            const key = fundingKey(option);
            const chosen = funding.chosen === option;
            return (
              <button key={key} type="button" className={`${controls["button"]} ${styles["pill"]}`} aria-pressed={chosen} onClick={() => onChoose(key)}>
                <Check className={styles["tick"]} size={16} strokeWidth={2} aria-hidden="true" />
                {optionLabel(intl, option, jobName)}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
