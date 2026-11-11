import type { Currency, Facts, FamilyCommand } from "@holt/core";
import { useId, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import type { Message } from "../transactions/decisions.model.ts";
import { type Words, say } from "../transactions/ImportSay.ts";
import cards from "./Cards.module.css";
import { MoneyInAddDialog } from "./MoneyInAddDialog.tsx";
import { MoneyInEditDialog } from "./MoneyInEditDialog.tsx";
import { refusalSince } from "./MoneyInFeedback.tsx";
import { type MoneyInView, type PersonRow, captionWords, endsWords, laterWords, nextWords } from "./MoneyIn.model.ts";
import styles from "./MoneyIn.module.css";
import { moneyText } from "./PlanStatus.ts";

export interface MoneyInPanelProps {
  readonly facts: Facts;
  readonly view: MoneyInView;
  readonly currency: Currency;
  readonly busy: boolean;
  /** The latest thing to tell the family, so a dialog can show a refusal that came after it opened. */
  readonly message: Message | null;
  /** Runs one command and says `done` once it is saved. True when it was. */
  readonly onSubmit: (command: FamilyCommand, done: string) => Promise<boolean>;
  /** What the last change did, and Undo. */
  readonly feedback: ReactNode;
  /** A dialog on this panel is open, so the screen knows who shows the refusals. */
  readonly onDialog: (open: boolean) => void;
}

type Dialog = { readonly kind: "edit" | "add"; readonly opened: Message | null };

function Person({ row, currency }: { readonly row: PersonRow; readonly currency: Currency }) {
  const intl = useIntl();
  const words = (value: Words) => say(intl, currency, value);
  return (
    <li className={styles["person"]}>
      <div className={styles["who"]}>
        <span className={styles["name"]}>{row.name}</span>
        <span className={styles["detail"]}>{words(captionWords(row))}</span>
        {row.later !== null && <span className={styles["detail"]}>{words(laterWords(row.later))}</span>}
        {row.endsAfter !== null && <span className={styles["detail"]}>{words(endsWords(row.endsAfter))}</span>}
      </div>
      <div className={styles["amountBox"]}>
        <span className={`${styles["figure"]} ${styles["strong"]}`}>{moneyText(intl, row.amount, currency)}</span>
        {row.next !== null && <span className={styles["detail"]}>{words(nextWords(row.next))}</span>}
      </div>
    </li>
  );
}

/** Money in: who pays into the household each month and whether it arrived, with the two ways to change what is agreed. */
export function MoneyInPanel({ facts, view, currency, busy, message, onSubmit, feedback, onDialog }: MoneyInPanelProps) {
  const intl = useIntl();
  const titleId = useId();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const money = (amount: Parameters<typeof moneyText>[1]) => moneyText(intl, amount, currency);

  const open = (kind: Dialog["kind"]) => {
    setDialog({ kind, opened: message });
    onDialog(true);
  };
  const close = () => {
    setDialog(null);
    onDialog(false);
  };
  const refusal = dialog === null ? null : refusalSince(message, dialog.opened);
  const { rows, inThisMonth } = view;

  return (
    <section className={cards["card"]} aria-labelledby={titleId}>
      <div className={styles["head"]}>
        <h2 id={titleId} className="type-title-section">
          {intl.formatMessage({ id: "plan.money.title" })}
        </h2>
        <p className={cards["lead"]}>{intl.formatMessage({ id: "plan.money.intro" })}</p>
      </div>

      {rows.length === 0 ? (
        <div className={styles["empty"]}>
          <p className={styles["emptyTitle"]}>{intl.formatMessage({ id: "plan.money.empty.title" })}</p>
          <p>{intl.formatMessage({ id: "plan.money.empty.body" })}</p>
        </div>
      ) : (
        <>
          <ul className={styles["list"]} aria-label={intl.formatMessage({ id: "plan.money.list" })}>
            {rows.map((row) => (
              <Person key={row.agreementId} row={row} currency={currency} />
            ))}
          </ul>
          <div className={styles["total"]}>
            <span className={styles["totalLabel"]}>{intl.formatMessage({ id: "plan.money.inMonth" })}</span>
            <div className={styles["totalFigures"]}>
              <span>{intl.formatMessage({ id: "plan.money.arrived" }, { amount: money(inThisMonth.actual) })}</span>
              {inThisMonth.expected > 0 && <span className={styles["detail"]}>{intl.formatMessage({ id: "plan.money.stillExpected" }, { amount: money(inThisMonth.expected) })}</span>}
            </div>
          </div>
        </>
      )}

      {feedback}

      <div className={styles["buttons"]}>
        {rows.length > 0 && (
          <button type="button" className={controls["button"]} aria-haspopup="dialog" onClick={() => open("edit")}>
            {intl.formatMessage({ id: "plan.money.edit" })}
          </button>
        )}
        <button type="button" className={controls["button"]} aria-haspopup="dialog" onClick={() => open("add")}>
          {intl.formatMessage({ id: "plan.money.add" })}
        </button>
      </div>

      {dialog?.kind === "edit" && <MoneyInEditDialog facts={facts} view={view} currency={currency} busy={busy} refusal={refusal} onSubmit={onSubmit} onClose={close} />}
      {dialog?.kind === "add" && <MoneyInAddDialog facts={facts} view={view} currency={currency} busy={busy} refusal={refusal} onSubmit={onSubmit} onClose={close} />}
    </section>
  );
}
