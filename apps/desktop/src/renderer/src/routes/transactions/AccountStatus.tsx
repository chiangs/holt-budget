import type { Facts, ImportRhythm, ImportState, ImportStatusFigures, LocalDate } from "@holt/core";
import { useIntl } from "react-intl";
import { formatDay } from "../../i18n/dates.ts";
import { type BankKey, accountChips } from "./transactions.model.ts";
import styles from "./Transactions.module.css";

const stateLabels: Record<ImportState, string> = {
  upToDate: "tx.chip.state.upToDate",
  due: "tx.chip.state.due",
  notImported: "tx.chip.state.notImported",
};

const bankLabels: Record<BankKey, string> = {
  bulder: "tx.bank.bulder",
  sparebank1: "tx.bank.sparebank1",
  generic: "tx.bank.generic",
};

const rhythmLabels: Record<ImportRhythm, string> = {
  weekly: "tx.rhythm.weekly",
  fortnightly: "tx.rhythm.fortnightly",
  monthly: "tx.rhythm.monthly",
};

export interface AccountStatusProps {
  readonly facts: Facts;
  readonly status: ImportStatusFigures;
  readonly today: LocalDate;
}

/** Whether every imported account is up to date: its name, its state, the bank and rhythm, and how far its data reaches. */
export function AccountStatus({ facts, status, today }: AccountStatusProps) {
  const intl = useIntl();
  const chips = accountChips(facts, status, today);
  if (chips.length === 0) return null;
  return (
    <section className={styles["status"]} aria-labelledby="tx-status-title">
      <h2 id="tx-status-title" className="type-title-section">
        {intl.formatMessage({ id: "tx.status.heading" })}
      </h2>
      <ul className={styles["cards"]}>
        {chips.map((chip) => {
          const rhythm = intl.formatMessage({ id: rhythmLabels[chip.rhythm] });
          return (
            <li key={chip.accountId} className={styles["card"]} data-state={chip.state}>
              <div className={styles["cardHead"]}>
                <h3 className={styles["cardName"]}>{chip.name}</h3>
                <span className={styles["state"]} data-state={chip.state}>
                  {intl.formatMessage({ id: stateLabels[chip.state] })}
                </span>
              </div>
              <div className={styles["bank"]}>
                {chip.bank === null
                  ? intl.formatMessage({ id: "tx.chip.rhythmOnly" }, { rhythm })
                  : intl.formatMessage({ id: "tx.chip.line" }, { bank: intl.formatMessage({ id: bankLabels[chip.bank] }), rhythm })}
              </div>
              <div className={styles["covers"]}>
                {chip.coversTo === null || chip.daysSinceImport === null
                  ? intl.formatMessage({ id: "tx.chip.none" })
                  : intl.formatMessage({ id: "tx.chip.covers" }, { date: formatDay(chip.coversTo, intl.locale), days: chip.daysSinceImport })}
              </div>
              {chip.coversTo !== null && (
                <div className={styles["covers"]} data-checked={chip.checkedOn === null ? "no" : "yes"}>
                  {chip.checkedOn === null
                    ? intl.formatMessage({ id: "tx.chip.notChecked" })
                    : intl.formatMessage({ id: "tx.chip.checked" }, { date: formatDay(chip.checkedOn, intl.locale) })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
