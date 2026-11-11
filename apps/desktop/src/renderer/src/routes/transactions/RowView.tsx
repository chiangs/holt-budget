import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, type Ref, useEffect, useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { formatDay } from "../../i18n/dates.ts";
import { amountText } from "./amount.ts";
import controls from "./Controls.module.css";
import { say } from "./ImportSay.ts";
import { type NeedsYouRow, type RowAction, suggestionText } from "./needsYou.model.ts";
import styles from "./NeedsYou.module.css";

const actionLabels: Record<RowAction, string> = {
  accept: "needsYou.action.accept",
  chooseJob: "needsYou.action.chooseJob",
  split: "needsYou.action.split",
  transfer: "needsYou.action.transfer",
  income: "needsYou.action.income",
  refund: "needsYou.action.refund",
  note: "needsYou.action.addNote",
  alwaysDoThis: "needsYou.action.always",
};

export interface RowViewProps {
  readonly row: NeedsYouRow;
  readonly currency: string;
  readonly selected: boolean;
  readonly menuOpen: boolean;
  readonly noteOpen: boolean;
  readonly busy: boolean;
  readonly liRef: Ref<HTMLLIElement>;
  readonly onSelect: () => void;
  readonly onAction: (action: RowAction) => void;
  readonly onToggleMenu: () => void;
  readonly onSaveNote: (text: string) => void;
  readonly onCloseNote: () => void;
}

/** One waiting transaction: what it is, what the app suggests and why, and what the family can do with it. */
export function RowView({ row, currency, selected, menuOpen, noteOpen, busy, liRef, onSelect, onAction, onToggleMenu, onSaveNote, onCloseNote }: RowViewProps) {
  const intl = useIntl();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(row.transaction.note ?? "");
  const { transaction, suggestion } = row;
  const when = formatDay(transaction.bookingDate, intl.locale);
  const amount = amountText(transaction.amount, currency, intl.locale);

  useEffect(() => {
    if (menuOpen) menu.current?.querySelector("button")?.focus();
  }, [menuOpen]);
  useEffect(() => {
    if (noteOpen) setDraft(transaction.note ?? "");
  }, [noteOpen, transaction.note]);

  const text = suggestion === null ? null : suggestionText(row, suggestion);
  const job = text === null ? null : text.headline.kind === "job" ? text.headline.name : say(intl, currency, text.headline.words);
  const because =
    text === null ? intl.formatMessage({ id: transaction.counterparty === undefined ? "needsYou.why.noPayee" : "needsYou.why.none" }) : say(intl, currency, text.because);

  const label = intl.formatMessage(
    { id: job === null ? "needsYou.row.label" : "needsYou.row.labelSuggested" },
    { who: row.who, amount, when, account: row.accountName, suggestion: job ?? "" },
  );
  const labelOf = (action: RowAction): string => {
    if (action === "chooseJob" && suggestion !== null && suggestion.result?.kind === "job") return intl.formatMessage({ id: "needsYou.action.changeJob" });
    if (action === "note" && transaction.note !== undefined) return intl.formatMessage({ id: "needsYou.action.editNote" });
    return intl.formatMessage({ id: actionLabels[action] });
  };
  /** With a suggestion the row offers Accept, and changing the job is one step away in More. Without one, the first thing to do. */
  const primary: RowAction | undefined = suggestion === null ? row.actions.find((action) => action === (row.direction === "out" ? "chooseJob" : "income")) : undefined;

  /** Only the selected row's buttons are in the tab order, so Tab doesn't walk through every row. J and K choose the row. */
  const tabIndex = selected ? 0 : -1;

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onToggleMenu();
      (event.currentTarget.closest("li") as HTMLElement | null)?.focus();
      return;
    }
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...event.currentTarget.querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <li ref={liRef} className={styles["row"]} data-selected={selected} tabIndex={selected ? 0 : -1} aria-label={label} onFocus={onSelect} onClick={onSelect}>
      <span className={styles["when"]}>{when}</span>
      <span className={styles["who"]}>
        <span className={styles["name"]}>{row.who}</span>
        {row.detail !== null && <span className={styles["meta"]}>{row.detail}</span>}
        <span className={styles["meta"]}>{row.accountName}</span>
      </span>
      <span className={styles["amount"]}>{amount}</span>
      <span className={styles["why"]}>
        <span className={job === null ? `${styles["job"]} ${styles["none"]}` : styles["job"]}>{job ?? intl.formatMessage({ id: "needsYou.suggest.none" })}</span>
        <span className={styles["because"]}>{because}</span>
        {row.candidates.length > 0 && <span className={styles["because"]}>{intl.formatMessage({ id: "needsYou.candidates" }, { count: row.candidates.length })}</span>}
      </span>
      <span className={styles["actions"]}>
        {suggestion !== null && (
          <button type="button" className={`${controls["button"]} ${controls["primary"]}`} disabled={busy} tabIndex={tabIndex} aria-keyshortcuts="Space" onClick={() => onAction("accept")}>
            <Check size={16} strokeWidth={2} aria-hidden="true" />
            {intl.formatMessage({ id: "needsYou.action.accept" })}
            <span className={controls["key"]} aria-hidden="true">
              {intl.formatMessage({ id: "needsYou.key.space" })}
            </span>
          </button>
        )}
        {primary !== undefined && (
          <button type="button" className={controls["button"]} disabled={busy} tabIndex={tabIndex} aria-keyshortcuts={primary === "chooseJob" ? "E" : undefined} onClick={() => onAction(primary)}>
            {labelOf(primary)}
          </button>
        )}
        <button type="button" className={controls["button"]} tabIndex={tabIndex} aria-expanded={menuOpen} aria-controls={menuId} aria-keyshortcuts="Enter" onClick={onToggleMenu}>
          {intl.formatMessage({ id: "needsYou.action.more" })}
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </span>
      {transaction.note !== undefined && !noteOpen && <p className={`${styles["note"]} ${styles["full"]}`}>{intl.formatMessage({ id: "needsYou.note.shown" }, { note: transaction.note })}</p>}
      {menuOpen && (
        <div ref={menu} id={menuId} role="group" aria-label={intl.formatMessage({ id: "needsYou.menu.label" }, { who: row.who })} className={`${styles["menu"]} ${styles["full"]}`} onKeyDown={onMenuKey}>
          {row.actions.map((action) => (
            <button key={action} type="button" className={controls["button"]} disabled={busy} onClick={() => onAction(action)}>
              {labelOf(action)}
            </button>
          ))}
        </div>
      )}
      {noteOpen && (
        <form
          className={`${styles["noteForm"]} ${styles["full"]}`}
          onSubmit={(event) => {
            event.preventDefault();
            onSaveNote(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onCloseNote();
            }
          }}
        >
          <input
            className={`${controls["field"]} ${styles["noteField"]}`}
            aria-label={intl.formatMessage({ id: "needsYou.note.field" }, { who: row.who })}
            autoComplete="off"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className={`${controls["button"]} ${controls["primary"]}`} disabled={busy}>
            {intl.formatMessage({ id: "needsYou.note.save" })}
          </button>
          <button type="button" className={controls["button"]} onClick={onCloseNote}>
            {intl.formatMessage({ id: "needsYou.cancel" })}
          </button>
        </form>
      )}
    </li>
  );
}
