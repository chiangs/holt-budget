import type { Currency } from "@holt/core";
import { CircleAlert } from "lucide-react";
import { useId } from "react";
import { useIntl } from "react-intl";
import { formatDay } from "../../i18n/dates.ts";
import controls from "../transactions/Controls.module.css";
import cards from "./Cards.module.css";
import styles from "./PlanAccounts.module.css";
import type { AccountRow, Cause, WhereTheMoneySits } from "./PlanAccounts.model.ts";
import { monthOnly } from "./PlanFormat.ts";
import { moneyText } from "./PlanStatus.ts";

export interface PlanAccountsProps {
  readonly where: WhereTheMoneySits;
  readonly currency: Currency;
  /** Opens the New job flow on a job that pays into an account the household adds. The button waits until the screen gives it one. */
  readonly onAddAccount?: (opener: Element) => void;
  /** Opens the New job flow on a job that keeps its money, as a bucket. The button waits until the screen gives it one. */
  readonly onAddBucket?: (opener: Element) => void;
}

/** Where the money sits: each shared account with its buckets, then the accounts the household pays into. Add an account and Add a bucket open the New job flow. */
export function PlanAccounts({ where, currency, onAddAccount, onAddBucket }: PlanAccountsProps) {
  const intl = useIntl();
  const titleId = useId();
  const noteId = useId();
  const money = (amount: Parameters<typeof moneyText>[1]) => moneyText(intl, amount, currency);

  const causeText = (cause: Cause): string => {
    switch (cause.kind) {
      case "movesToDo":
        return intl.formatMessage(
          { id: "plan.where.cause.moves" },
          { count: cause.moves.length, amounts: intl.formatList(cause.moves.map((move) => `${money(move.amount)} (${monthOnly(move.month, intl.locale)})`)) },
        );
      case "monthlyMove":
        return intl.formatMessage({ id: "plan.where.cause.monthly" }, { amount: money(cause.amount) });
      case "unknown":
        return intl.formatMessage({ id: "plan.where.cause.unknown" });
    }
  };

  const balanceNote = (account: AccountRow): string | null => {
    if (account.basis.kind === "calculated") return null;
    const date = formatDay(account.basis.baseDate, intl.locale);
    return account.basis.paidIn === 0
      ? intl.formatMessage({ id: "plan.where.entered" }, { date })
      : intl.formatMessage({ id: "plan.where.enteredPlus" }, { date, amount: money(account.basis.paidIn) });
  };

  return (
    <section className={cards["card"]} aria-labelledby={titleId}>
      <div className={styles["groupTitle"]}>
        <h2 id={titleId} className="type-title-section">
          {intl.formatMessage({ id: "plan.where.title" })}
        </h2>
        <p className={cards["lead"]}>{intl.formatMessage({ id: "plan.where.intro" })}</p>
      </div>

      {where.shared.map((account) => (
        <div key={account.id} className={styles["account"]}>
          <div className={styles["line"]}>
            <span className={styles["name"]}>{account.name}</span>
            <span className={`${styles["figure"]} ${styles["total"]}`}>{money(account.balance)}</span>
          </div>
          {account.buckets.map((bucket) => (
            <div key={bucket.jobId} className={`${styles["line"]} ${styles["bucket"]}`}>
              <span className={styles["name"]}>{bucket.name}</span>
              <span className={styles["figure"]}>{money(bucket.amount)}</span>
            </div>
          ))}
          {account.remainder.kind === "unbucketed" && (
            <div className={`${styles["line"]} ${styles["bucket"]}`}>
              <span className={styles["name"]}>{intl.formatMessage({ id: "plan.where.remainder" })}</span>
              <span className={styles["figure"]}>{money(account.remainder.amount)}</span>
            </div>
          )}
          {account.remainder.kind === "bucketsExceedBalance" && (
            <div className={styles["exceeds"]}>
              <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
              <p>
                {intl.formatMessage({ id: "plan.where.exceeds" }, { amount: money(account.remainder.amount) })} {causeText(account.remainder.cause)}
              </p>
            </div>
          )}
        </div>
      ))}

      {where.paidInto.length > 0 && (
        <div className={styles["group"]}>
          <div className={styles["groupTitle"]}>
            <span className={styles["name"]}>{intl.formatMessage({ id: "plan.where.children.title" })}</span>
            <p className={cards["lead"]}>{intl.formatMessage({ id: "plan.where.children.intro" })}</p>
          </div>
          {where.paidInto.map((account) => {
            const note = balanceNote(account);
            return (
              <div key={account.id} className={styles["account"]}>
                <div className={`${styles["line"]} ${styles["bucket"]}`}>
                  <span className={styles["name"]}>{account.name}</span>
                  <span className={styles["figure"]}>{money(account.balance)}</span>
                </div>
                {note !== null && <p className={styles["note"]}>{note}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className={styles["buttons"]}>
        <button type="button" className={controls["button"]} {...(onAddAccount === undefined ? { disabled: true, "aria-describedby": noteId } : { onClick: (event) => onAddAccount(event.currentTarget) })}>
          {intl.formatMessage({ id: "plan.where.addAccount" })}
        </button>
        <button type="button" className={controls["button"]} {...(onAddBucket === undefined ? { disabled: true, "aria-describedby": noteId } : { onClick: (event) => onAddBucket(event.currentTarget) })}>
          {intl.formatMessage({ id: "plan.where.addBucket" })}
        </button>
      </div>
      {(onAddAccount === undefined || onAddBucket === undefined) && (
        <p id={noteId} className={styles["soon"]}>
          {intl.formatMessage({ id: "plan.where.soon" })}
        </p>
      )}
    </section>
  );
}
