import { type Facts, type Figures, type JobId, type TransactionId, householdOf } from "@holt/core";
import { CircleCheck } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { formatDay } from "../../i18n/dates.ts";
import { amountText } from "./amount.ts";
import { markTransfer, saveNote, sortToJob, splitAcross } from "./commands.model.ts";
import controls from "./Controls.module.css";
import type { Decisions } from "./decisions.ts";
import { IncomeDialog } from "./IncomeDialog.tsx";
import { say as sayWords } from "./ImportSay.ts";
import { JobPicker } from "./JobPicker.tsx";
import { pickableJobs } from "./jobs.ts";
import { pressOf } from "./keys.ts";
import { rowKey } from "./keys.model.ts";
import { type NeedsYouRow, type RowAction, acceptAll, agreementOptions, incomeCommand, incomeDone, moveSelection, needsYouRows, pageSize, reselect, suggestionText, visibleCount } from "./needsYou.model.ts";
import styles from "./NeedsYou.module.css";
import { RowView } from "./RowView.tsx";
import { RuleDialog } from "./RuleDialog.tsx";
import { SplitEditor } from "./SplitEditor.tsx";
import { TransferDialog } from "./TransferDialog.tsx";

type Dialog =
  | { readonly kind: "job" | "refund" | "split" | "transfer" | "income" | "rule"; readonly id: TransactionId }
  | null;

export interface NeedsYouTabProps {
  readonly facts: Facts;
  readonly figures: Figures;
  readonly decisions: Decisions;
}

/** The transactions waiting for the family, to decide quickly with the keyboard: accept, change the job, split, transfer, income, refund, note, or make a rule. */
export function NeedsYouTab({ facts, figures, decisions }: NeedsYouTabProps) {
  const intl = useIntl();
  const { decide, stepBy, say, message, busy, canUndo, canRedo } = decisions;
  const rows = useMemo(() => needsYouRows(facts, figures.needsYou), [facts, figures]);
  const jobs = useMemo(() => pickableJobs(facts), [facts]);
  const all = useMemo(() => acceptAll(rows), [rows]);
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const { currency } = householdOf(facts);

  const [selected, setSelected] = useState<TransactionId | null>(null);
  const [menuFor, setMenuFor] = useState<TransactionId | null>(null);
  const [noteFor, setNoteFor] = useState<TransactionId | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [requested, setRequested] = useState(pageSize);

  const previousIds = useRef<readonly TransactionId[]>(ids);
  const rowElements = useRef(new Map<TransactionId, HTMLLIElement>());
  const focusSelected = useRef(false);
  const lastFocused = useRef<Element | null>(null);

  useEffect(() => {
    const before = previousIds.current;
    setSelected((current) => reselect(before, ids, current));
    previousIds.current = ids;
  }, [ids]);

  const selectedId = selected !== null && ids.includes(selected) ? selected : (ids[0] ?? null);
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const shown = visibleCount(rows.length, requested, selectedId === null ? 0 : ids.indexOf(selectedId));

  // Focus follows the selection after a key moved it, and lands on the next row when the focused row went away.
  useEffect(() => {
    const element = selectedId === null ? undefined : rowElements.current.get(selectedId);
    const lost = lastFocused.current !== null && !lastFocused.current.isConnected && document.activeElement === document.body;
    if (focusSelected.current || lost) element?.focus();
    focusSelected.current = false;
    if (lost) lastFocused.current = null;
  });

  useEffect(() => {
    if (dialog !== null && !rows.some((row) => row.id === dialog.id)) setDialog(null);
    if (menuFor !== null && !rows.some((row) => row.id === menuFor)) setMenuFor(null);
    if (noteFor !== null && !rows.some((row) => row.id === noteFor)) setNoteFor(null);
  }, [rows, dialog, menuFor, noteFor]);

  const subjectOf = (row: NeedsYouRow) => intl.formatMessage({ id: "needsYou.subject" }, { who: row.who, amount: amountText(row.transaction.amount, currency, intl.locale), date: formatDay(row.transaction.bookingDate, intl.locale) });

  const accept = (row: NeedsYouRow) => {
    if (row.suggestion === null) return;
    void decide(row.suggestion.command, sayWords(intl, currency, suggestionText(row, row.suggestion).done));
  };

  const perform = (row: NeedsYouRow, action: RowAction) => {
    setSelected(row.id);
    setMenuFor(null);
    switch (action) {
      case "accept":
        return accept(row);
      case "note":
        return setNoteFor(row.id);
      case "chooseJob":
        return setDialog({ kind: "job", id: row.id });
      case "refund":
        return setDialog({ kind: "refund", id: row.id });
      case "split":
        return setDialog({ kind: "split", id: row.id });
      case "transfer":
        return setDialog({ kind: "transfer", id: row.id });
      case "income":
        return setDialog({ kind: "income", id: row.id });
      case "alwaysDoThis":
        return setDialog({ kind: "rule", id: row.id });
    }
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const intent = rowKey(pressOf(event), {
      row: selectedRow === null ? null : { hasSuggestion: selectedRow.suggestion !== null, canChooseJob: selectedRow.actions.includes("chooseJob") },
      canUndo,
      canRedo,
      busy,
    });
    if (intent === null) return;
    event.preventDefault();
    switch (intent.kind) {
      case "move": {
        const next = moveSelection(ids, selectedId, intent.step);
        focusSelected.current = true;
        setMenuFor(null);
        setSelected(next);
        return;
      }
      case "accept":
        return selectedRow === null ? undefined : accept(selectedRow);
      case "noSuggestion":
        return say(intl.formatMessage({ id: "needsYou.noSuggestion" }));
      case "openActions":
        return selectedRow === null ? undefined : setMenuFor(selectedRow.id);
      case "chooseJob":
        return selectedRow === null ? undefined : perform(selectedRow, "chooseJob");
      case "undo":
        return void stepBy("undo");
      case "redo":
        return void stepBy("redo");
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const target = dialog === null ? null : (rows.find((row) => row.id === dialog.id) ?? null);
  const close = () => setDialog(null);
  const pickJob = (row: NeedsYouRow, jobId: JobId, refund: boolean) => {
    close();
    void decide(sortToJob(row.transaction, jobId), intl.formatMessage({ id: refund ? "needsYou.done.refund" : "needsYou.done.sorted" }, { count: 1 }));
  };

  return (
    <div className={styles["tab"]}>
      <div className={styles["bar"]}>
        <p className={styles["intro"]}>
          <span>{intl.formatMessage({ id: "needsYou.intro" }, { count: rows.length })}</span>
          <span className={styles["keys"]}>{intl.formatMessage({ id: "needsYou.keys" })}</span>
        </p>
        {all.count > 0 && (
          <button type="button" className={`${controls["button"]} ${controls["primary"]} ${controls["large"]}`} disabled={busy} onClick={() => all.command !== null && void decide(all.command, intl.formatMessage({ id: "needsYou.done.accepted" }, { count: all.count }))}>
            {intl.formatMessage({ id: all.count === all.total ? "needsYou.acceptAll" : "needsYou.acceptSome" }, { count: all.count, total: all.total })}
          </button>
        )}
      </div>

      <div className={styles["feedback"]} role="status" aria-live="polite">
        {message !== null && message.kind !== "problem" && <span className={styles["said"]}>{message.text}</span>}
        {message?.kind === "said" && canUndo && (
          <button type="button" className={controls["button"]} aria-keyshortcuts="U" disabled={busy} onClick={() => void stepBy("undo")}>
            {intl.formatMessage({ id: "needsYou.undo" })}
            <span className={controls["key"]} aria-hidden="true">
              {intl.formatMessage({ id: "needsYou.key.u" })}
            </span>
          </button>
        )}
        {message?.kind === "said" && canRedo && (
          <button type="button" className={controls["button"]} aria-keyshortcuts="Shift+U" disabled={busy} onClick={() => void stepBy("redo")}>
            {intl.formatMessage({ id: "needsYou.redo" })}
            <span className={controls["key"]} aria-hidden="true">
              {intl.formatMessage({ id: "needsYou.key.shiftU" })}
            </span>
          </button>
        )}
      </div>
      <div role="alert" className={styles["alert"]}>
        {message?.kind === "problem" && <p className={styles["problem"]}>{message.text}</p>}
      </div>

      {rows.length === 0 ? (
        <div className={styles["empty"]}>
          <CircleCheck size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className="strong">{intl.formatMessage({ id: "needsYou.empty.title" })}</p>
          <p className="muted">{intl.formatMessage({ id: "needsYou.empty.body" })}</p>
        </div>
      ) : (
        <div className={styles["box"]}>
          <ul
            className={styles["list"]}
            aria-label={intl.formatMessage({ id: "needsYou.list.label" })}
            aria-busy={busy}
            onFocus={(event) => {
              lastFocused.current = event.target;
            }}
          >
            {rows.slice(0, shown).map((row) => (
              <RowView
                key={row.id}
                row={row}
                currency={currency}
                selected={row.id === selectedId}
                menuOpen={menuFor === row.id}
                noteOpen={noteFor === row.id}
                busy={busy}
                liRef={(element) => {
                  if (element === null) rowElements.current.delete(row.id);
                  else rowElements.current.set(row.id, element);
                }}
                onSelect={() => setSelected(row.id)}
                onAction={(action) => perform(row, action)}
                onToggleMenu={() => setMenuFor(menuFor === row.id ? null : row.id)}
                onSaveNote={(text) => {
                  setNoteFor(null);
                  void decide(saveNote(row.transaction, text), intl.formatMessage({ id: text.trim() === "" ? "needsYou.done.noteRemoved" : "needsYou.done.noteSaved" }));
                }}
                onCloseNote={() => {
                  setNoteFor(null);
                  rowElements.current.get(row.id)?.focus();
                }}
              />
            ))}
          </ul>
        </div>
      )}
      {shown < rows.length && (
        <button type="button" className={`${controls["button"]} ${styles["more"]}`} onClick={() => setRequested(shown + pageSize)}>
          {intl.formatMessage({ id: "needsYou.more" }, { count: Math.min(pageSize, rows.length - shown) })}
        </button>
      )}

      {target !== null && dialog !== null && (dialog.kind === "job" || dialog.kind === "refund") && (
        <JobPicker
          jobs={jobs}
          titleId={dialog.kind === "job" ? "needsYou.job.title" : "needsYou.refund.title"}
          {...(dialog.kind === "refund" ? { hintId: "needsYou.refund.hint" } : {})}
          subject={subjectOf(target)}
          onPick={(jobId) => pickJob(target, jobId, dialog.kind === "refund")}
          onClose={close}
        />
      )}
      {target !== null && dialog?.kind === "split" && (
        <SplitEditor
          transaction={target.transaction}
          jobs={jobs}
          onSubmit={(allocations) => {
            close();
            void decide(splitAcross(target.transaction, allocations), intl.formatMessage({ id: "needsYou.done.split" }));
          }}
          onClose={close}
        />
      )}
      {target !== null && dialog?.kind === "transfer" && (
        <TransferDialog
          transaction={target.transaction}
          candidates={target.candidates}
          accountName={(transaction) => facts.accounts.get(transaction.accountId)?.name ?? ""}
          onSubmit={(partner) => {
            close();
            void decide(markTransfer(facts, target.transaction, partner), intl.formatMessage({ id: partner === null ? "needsYou.done.transfer" : "needsYou.done.paired" }));
          }}
          onClose={close}
        />
      )}
      {target !== null && dialog?.kind === "income" && (
        <IncomeDialog
          transaction={target.transaction}
          subject={subjectOf(target)}
          agreementsFor={(fundsMonth) => agreementOptions(facts, fundsMonth)}
          {...(target.suggestion?.contribution === undefined ? {} : { suggested: target.suggestion.contribution })}
          onSubmit={(fundsMonth, source, agreement) => {
            close();
            const [year, month] = fundsMonth.split("-").map(Number) as [number, number];
            const monthName = intl.formatDate(new Date(Date.UTC(year, month - 1, 1)), { month: "long", year: "numeric", timeZone: "UTC" });
            const words = incomeDone(facts, source, agreement, fundsMonth);
            void decide(
              incomeCommand(target.transaction, fundsMonth, source, agreement),
              words === null ? intl.formatMessage({ id: "needsYou.done.income" }, { month: monthName }) : sayWords(intl, currency, words),
            );
          }}
          onClose={close}
        />
      )}
      {target !== null && dialog?.kind === "rule" && (
        <RuleDialog
          row={target}
          rows={rows}
          facts={facts}
          currency={currency}
          locale={intl.locale}
          jobs={jobs}
          subject={subjectOf(target)}
          onSubmit={(command, count) => {
            close();
            void decide(command, intl.formatMessage({ id: "needsYou.done.rule" }, { payee: target.who, count }));
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
