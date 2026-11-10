import { type ChangeId, type FamilyCommand, type IncomeSource, type Month, type TransactionId, householdOf, minorUnitDigits } from "@holt/core";
import { Undo2, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { type FactsView, type LedgerOutcome, useFactsView, useLedger } from "../../data/ledger.tsx";
import controls from "./AllControls.module.css";
import { AllDetail } from "./AllDetail.tsx";
import { type ActionId, historyCommand, incomeCommand, jobCommand, needsYouCommand, noteCommand, pickableJobsFor, refundCommand, sourcesByTransaction, splitCommand } from "./AllDetail.model.ts";
import { type AllFilter, buildBrowseIndex, everything, filterIndex, isFiltering, jobsInGroupOrder } from "./AllFilter.model.ts";
import { AllFilterBar } from "./AllFilterBar.tsx";
import { AllIncomeDialog } from "./AllIncomeDialog.tsx";
import { type Names, type Words, monthLabel, titleOf } from "./AllLabels.model.ts";
import { AllList } from "./AllList.tsx";
import styles from "./AllTab.module.css";
import { JobPicker } from "./JobPicker.tsx";
import { refusalText } from "./refusal.ts";
import { SplitEditor } from "./SplitEditor.tsx";
import { TransferDialog } from "./TransferDialog.tsx";
import { candidatesFor, moveCompletedBy, transferCommand } from "./TransferDialog.model.ts";

type DialogAction = "changeJob" | "refund" | "split" | "transfer" | "income";

type Notice =
  | { readonly kind: "done"; readonly words: Words; readonly changeId: ChangeId }
  | { readonly kind: "undone"; readonly changeId: ChangeId }
  | { readonly kind: "problem"; readonly text: string };

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Every transaction, with search and filters, and the actions on a row. */
export function AllTab() {
  const view = useFactsView();
  return view === null ? null : <Browse view={view} />;
}

function Browse({ view }: { readonly view: FactsView }) {
  const intl = useIntl();
  const ledger = useLedger();
  const { facts } = view;
  const { currency } = householdOf(facts);
  const digits = minorUnitDigits(currency);

  const index = useMemo(() => buildBrowseIndex(facts.transactions.values(), digits), [facts.transactions, digits]);
  const [filter, setFilter] = useState<AllFilter>(everything);
  const deferred = useDeferredValue(filter);
  const rows = useMemo(() => filterIndex(index, deferred), [index, deferred]);
  const sources = useMemo(() => sourcesByTransaction(facts.importRows.values(), facts.importBatches), [facts.importRows, facts.importBatches]);
  const jobChoices = useMemo(() => jobsInGroupOrder(facts, () => true), [facts.jobs, facts.groups]);
  const accounts = useMemo(() => [...facts.accounts.values()].map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [facts.accounts]);

  const thisYear = view.today.slice(0, 4);
  const names = useMemo<Names>(
    () => ({
      account: (id) => facts.accounts.get(id)?.name ?? "",
      job: (id) => facts.jobs.get(id)?.name ?? "",
      month: (month) => monthLabel(month, intl.locale, month.slice(0, 4) !== thisYear),
      transaction: (id) => facts.transactions.get(id),
    }),
    [facts.accounts, facts.jobs, facts.transactions, intl.locale, thisYear],
  );

  const [highlightedId, setHighlightedId] = useState<TransactionId | null>(null);
  const [openId, setOpenId] = useState<TransactionId | null>(null);
  const [dialog, setDialog] = useState<{ readonly action: DialogAction; readonly id: TransactionId } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const open = openId === null ? undefined : facts.transactions.get(openId);
  const target = dialog === null ? undefined : facts.transactions.get(dialog.id);

  useEffect(() => {
    if (openId !== null && !facts.transactions.has(openId)) setOpenId(null);
    if (dialog !== null && !facts.transactions.has(dialog.id)) setDialog(null);
  }, [facts.transactions, openId, dialog]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return;
      if (document.querySelector("dialog[open]") !== null) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const focusList = (): void => root.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();

  const problemOf = (outcome: Exclude<LedgerOutcome, { readonly status: "applied" }>): Notice => {
    switch (outcome.status) {
      case "refused":
        return { kind: "problem", text: refusalText(intl, outcome.refusal) };
      case "conflict":
        return { kind: "problem", text: intl.formatMessage({ id: "browse.notice.conflict" }) };
      case "failed":
        return { kind: "problem", text: intl.formatMessage({ id: "browse.notice.failed" }, { reason: outcome.failure.message }) };
    }
  };

  const commit = async (command: FamilyCommand | null, words: Words): Promise<void> => {
    if (command === null) return;
    const outcome = await ledger.run(command);
    setNotice(outcome.status === "applied" ? { kind: "done", words, changeId: outcome.change.id } : problemOf(outcome));
  };

  const step = async (direction: "undo" | "redo"): Promise<void> => {
    const outcome = await ledger.step(direction);
    if (outcome.status !== "applied") return setNotice(problemOf(outcome));
    setNotice(direction === "undo" ? { kind: "undone", changeId: outcome.change.id } : { kind: "done", words: { id: "browse.notice.redone" }, changeId: outcome.change.id });
  };

  const highlight = (id: TransactionId): void => {
    setHighlightedId(id);
    if (openId !== null) setOpenId(id);
  };
  const show = (id: TransactionId): void => {
    setHighlightedId(id);
    setOpenId(id);
  };

  const act = (action: Exclude<ActionId, "note">): void => {
    if (open === undefined) return;
    const name = titleOf(open);
    switch (action) {
      case "history":
        void commit(historyCommand(open), { id: "browse.notice.history", values: { name } });
        return;
      case "needsYou":
        void commit(needsYouCommand(open), { id: "browse.notice.needsYou", values: { name } });
        return;
      case "changeJob":
      case "refund":
      case "split":
      case "transfer":
      case "income":
        setDialog({ action, id: open.id });
        return;
    }
  };

  const closeDialog = (): void => setDialog(null);
  const withYear = (month: Month): string => monthLabel(month, intl.locale, true);

  const total = index.rows.length;
  const filtering = isFiltering(deferred);
  const showing = rows.length;
  const undoable = notice?.kind === "done" && ledger.head?.undo?.id === notice.changeId;
  const redoable = notice?.kind === "undone" && ledger.head?.redo?.id === notice.changeId;
  /** What the notice says about a change stops being true once that change is no longer the latest, such as after an undo made another way. */
  const shown = notice?.kind === "done" && !undoable ? null : notice;

  return (
    <div className={styles.tab} ref={root}>
      <AllFilterBar filter={filter} onChange={setFilter} accounts={accounts} jobs={jobChoices} months={index.months} monthLabel={withYear} searchRef={searchRef} />

      <p className={styles.count} role="status" aria-busy={deferred !== filter}>
        {intl.formatMessage({ id: filtering ? "browse.count.filtered" : "browse.count.all" }, { shown: showing, total })}
      </p>

      {shown !== null && (
        <div className={`${styles.notice} ${shown.kind === "problem" ? styles.problem : ""}`} role={shown.kind === "problem" ? "alert" : "status"}>
          <span className={styles.noticeText}>
            {shown.kind === "done"
              ? intl.formatMessage({ id: shown.words.id }, shown.words.values)
              : shown.kind === "undone"
                ? intl.formatMessage({ id: "browse.notice.undone" })
                : shown.text}
          </span>
          {undoable && (
            <button type="button" className={controls.button} onClick={() => void step("undo")}>
              <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
              {intl.formatMessage({ id: "browse.notice.undo" })}
            </button>
          )}
          {redoable && (
            <button type="button" className={controls.button} onClick={() => void step("redo")}>
              {intl.formatMessage({ id: "browse.notice.redo" })}
            </button>
          )}
          <button type="button" className={controls.iconButton} onClick={() => setNotice(null)} aria-label={intl.formatMessage({ id: "browse.notice.dismiss" })}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <p>{intl.formatMessage({ id: total === 0 ? "browse.empty.none" : "browse.empty.noMatch" })}</p>
        </div>
      ) : (
        <div className={`${styles.browse} ${open === undefined ? "" : styles.withDetail}`} aria-busy={deferred !== filter}>
          <AllList
            rows={rows}
            names={names}
            currency={currency}
            highlightedId={highlightedId}
            openId={open?.id ?? null}
            onHighlight={highlight}
            onOpen={show}
            onDismiss={() => setOpenId(null)}
            onEdit={(id) => {
              show(id);
              setDialog({ action: (facts.transactions.get(id)?.amount ?? 0) > 0 ? "refund" : "changeJob", id });
            }}
          />
          {open !== undefined && (
            <div
              className={styles.detail}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.defaultPrevented) return;
                if (isTextField(event.target)) {
                  event.currentTarget.focus();
                  return;
                }
                setOpenId(null);
                focusList();
              }}
              tabIndex={-1}
            >
              <AllDetail
                key={open.id}
                transaction={open}
                names={names}
                currency={currency}
                rule={open.ruleId === undefined ? undefined : facts.rules.get(open.ruleId)}
                sources={sources.get(open.id) ?? []}
                onAction={act}
                onSaveNote={(note) => void commit(noteCommand(open, note), { id: note.trim() === "" ? "browse.notice.noteRemoved" : "browse.notice.note", values: { name: titleOf(open) } })}
                onClose={() => {
                  setOpenId(null);
                  focusList();
                }}
              />
            </div>
          )}
        </div>
      )}

      {dialog !== null && target !== undefined && (
        <>
          {dialog.action === "changeJob" && (
            <JobPicker
              jobs={pickableJobsFor(facts, target)}
              titleId="browse.changeJob.title"
              onClose={closeDialog}
              onPick={(jobId) => {
                closeDialog();
                void commit(jobCommand(target, jobId), { id: "browse.notice.job", values: { name: titleOf(target), job: names.job(jobId) } });
              }}
            />
          )}
          {dialog.action === "refund" && (
            <JobPicker
              jobs={pickableJobsFor(facts, target)}
              titleId="browse.refund.title"
              onClose={closeDialog}
              onPick={(jobId) => {
                closeDialog();
                void commit(refundCommand(target, jobId), { id: "browse.notice.refund", values: { name: titleOf(target), job: names.job(jobId) } });
              }}
            />
          )}
          {dialog.action === "split" && (
            <SplitEditor
              transaction={target}
              jobs={pickableJobsFor(facts, target)}
              {...(target.treatment.kind === "split" ? { initial: target.treatment.allocations } : {})}
              onClose={closeDialog}
              onSubmit={(allocations) => {
                closeDialog();
                const [only, ...more] = allocations;
                const words: Words =
                  more.length === 0 && only !== undefined
                    ? { id: "browse.notice.job", values: { name: titleOf(target), job: names.job(only.jobId) } }
                    : { id: "browse.notice.split", values: { name: titleOf(target), count: allocations.length } };
                void commit(splitCommand(target, allocations), words);
              }}
            />
          )}
          {dialog.action === "transfer" && (
            <TransferDialog
              transaction={target}
              candidates={candidatesFor(facts, target)}
              accountName={(t) => names.account(t.accountId)}
              onClose={closeDialog}
              onSubmit={(partnerId) => {
                closeDialog();
                const partner = partnerId === null ? undefined : facts.transactions.get(partnerId);
                const name = titleOf(target);
                const words: Words =
                  partner === undefined
                    ? { id: "browse.notice.transferWaiting", values: { name } }
                    : { id: moveCompletedBy(facts, target, partner) === undefined ? "browse.notice.transferPaired" : "browse.notice.transferPairedMove", values: { name, account: names.account(partner.accountId) } };
                void commit(transferCommand(facts, target, partnerId), words);
              }}
            />
          )}
          {dialog.action === "income" && (
            <AllIncomeDialog
              transaction={target}
              monthLabel={withYear}
              onClose={closeDialog}
              onSubmit={(month: Month, source: IncomeSource) => {
                closeDialog();
                void commit(incomeCommand(target, month, source), { id: "browse.notice.income", values: { name: titleOf(target), month: names.month(month) } });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

