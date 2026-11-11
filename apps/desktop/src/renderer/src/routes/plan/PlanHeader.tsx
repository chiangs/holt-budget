import type { Currency, Money, Month } from "@holt/core";
import { CircleAlert, CircleCheck, Plus } from "lucide-react";
import type { Ref } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import type { Banner, QuickAdd } from "./PlanBanner.model.ts";
import { monthOnly } from "./PlanFormat.ts";
import styles from "./PlanHeader.module.css";
import { moneyText } from "./PlanStatus.ts";

export interface PlanHeaderProps {
  readonly banner: Banner;
  readonly currency: Currency;
  /** A change is being saved. */
  readonly busy: boolean;
  readonly newJobButton: Ref<HTMLButtonElement>;
  /** `unassigned` is the amount the click gives to the job. */
  readonly onQuickAdd: (add: QuickAdd, unassigned: Money) => void;
  readonly onMove: () => void;
  readonly onOpenMonth: (month: Month) => void;
  readonly onReopenMonth: (month: Month) => void;
  readonly onNewJob: () => void;
}

/** The banner and the New job button: whether every unit of money has a job, and what the family can do about it in one click. */
export function PlanHeader({ banner, currency, busy, newJobButton, onQuickAdd, onMove, onOpenMonth, onReopenMonth, onNewJob }: PlanHeaderProps) {
  const intl = useIntl();
  const money = (amount: Money) => moneyText(intl, amount, currency);
  const moveButton = (
    <button type="button" className={controls["button"]} disabled={busy} aria-haspopup="dialog" onClick={onMove}>
      {intl.formatMessage({ id: "plan.move" })}
    </button>
  );

  return (
    <div className={styles["actions"]}>
      <div role="status" className={styles["slot"]}>
      {banner.kind === "unassigned" && (
        <div className={styles["banner"]} data-kind="unassigned">
          <span className={styles["text"]}>{intl.formatMessage({ id: "plan.banner.unassigned" }, { amount: money(banner.amount) })}</span>
          {banner.quickAdds.map((add) => (
            <button key={add.jobId} type="button" className={controls["button"]} disabled={busy} onClick={() => onQuickAdd(add, banner.amount)}>
              {intl.formatMessage({ id: "plan.banner.quickAdd" }, { job: add.name })}
            </button>
          ))}
          {moveButton}
        </div>
      )}

      {banner.kind === "none" && (
        <div className={styles["banner"]} data-kind="none">
          <span className={styles["text"]}>
            <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
            {intl.formatMessage({ id: "plan.banner.none" }, { currency })}
          </span>
          {moveButton}
        </div>
      )}

      {banner.kind === "overAssigned" && (
        <div className={styles["banner"]} data-kind="overAssigned">
          <span className={styles["text"]}>
            <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
            {intl.formatMessage({ id: "plan.banner.over" }, { amount: money(banner.amount) })}
          </span>
          {moveButton}
        </div>
      )}

      {banner.kind === "notOpen" && (
        <div className={styles["banner"]} data-kind="notOpen">
          <span className={styles["text"]}>
            {intl.formatMessage(
              { id: banner.toOpen === banner.month ? "plan.banner.notOpen" : "plan.banner.openEarlier" },
              { month: monthOnly(banner.month, intl.locale), earlier: monthOnly(banner.toOpen, intl.locale) },
            )}
          </span>
          <button type="button" className={`${controls["button"]} ${controls["primary"]}`} disabled={busy} onClick={() => onOpenMonth(banner.toOpen)}>
            {intl.formatMessage({ id: "plan.banner.open" }, { month: monthOnly(banner.toOpen, intl.locale) })}
          </button>
          <p className={styles["explain"]}>{intl.formatMessage({ id: "plan.banner.openExplain" }, { month: monthOnly(banner.toOpen, intl.locale) })}</p>
        </div>
      )}

      {banner.kind === "closed" && (
        <div className={styles["banner"]} data-kind="closed">
          <span className={styles["text"]}>{intl.formatMessage({ id: "plan.banner.closed" }, { month: monthOnly(banner.month, intl.locale) })}</span>
          <button type="button" className={controls["button"]} disabled={busy} onClick={() => onReopenMonth(banner.month)}>
            {intl.formatMessage({ id: "plan.banner.reopen" }, { month: monthOnly(banner.month, intl.locale) })}
          </button>
        </div>
      )}
      </div>

      <button
        ref={newJobButton}
        type="button"
        className={`${controls["button"]} ${controls["primary"]} ${controls["large"]}`}
        aria-keyshortcuts="N"
        onClick={onNewJob}
      >
        <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
        {intl.formatMessage({ id: "plan.newJob" })}
        <span className={controls["key"]} aria-hidden="true">
          {intl.formatMessage({ id: "plan.key.n" })}
        </span>
      </button>
    </div>
  );
}
