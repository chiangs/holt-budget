import { type Facts, type Figures, type GroupId, type JobId, householdOf } from "@holt/core";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useFactsView, useFigures, useLedger, useLedgerStatus } from "../../data/ledger.tsx";
import { formatDay } from "../../i18n/dates.ts";
import controls from "../transactions/Controls.module.css";
import { type Decisions, useDecisions } from "../transactions/decisions.ts";
import type { Message } from "../transactions/decisions.model.ts";
import { pressOf } from "../transactions/keys.ts";
import { decimalSeparator } from "../transactions/rule.model.ts";
import type { SaveOutcome } from "./AssignEditor.tsx";
import { JobPanel } from "./JobPanel.tsx";
import { MoneyIn } from "./MoneyIn.tsx";
import { MoveMoneyDialog } from "./MoveMoneyDialog.tsx";
import { NewJobFlow } from "./NewJobFlow.tsx";
import styles from "./Plan.module.css";
import { PlanAccounts } from "./PlanAccounts.tsx";
import { whereTheMoneySits } from "./PlanAccounts.model.ts";
import { type Banner, bannerOf, quickAddCommand } from "./PlanBanner.model.ts";
import { type MoveDestination, planAssignEdit } from "./PlanEdit.model.ts";
import { monthAndYear, monthOnly } from "./PlanFormat.ts";
import { PlanHeader } from "./PlanHeader.tsx";
import { moveSelection, planKey } from "./PlanKeys.model.ts";
import { dataReachesTo, planMonthOf } from "./PlanMonth.model.ts";
import { moneyText } from "./PlanStatus.ts";
import { PlanTable } from "./PlanTable.tsx";
import { planGroups, rowsOf } from "./PlanTable.model.ts";

function Skeleton() {
  const intl = useIntl();
  return (
    <div className={styles["skeleton"]} role="status" aria-busy="true" aria-label={intl.formatMessage({ id: "plan.loading" })}>
      <div className={styles["block"]} style={{ width: "16rem" }} />
      <div className={styles["blockWide"]} />
      <div className={styles["block"]} style={{ width: "100%" }} />
    </div>
  );
}

interface MoveDialogState {
  readonly from: JobId | null;
  readonly to: MoveDestination | null;
  /** The message on screen when the dialog opened, so only a refusal that came after it shows in the dialog. */
  readonly opened: Message | null;
}

/** The ready screen: the month, the banner, the jobs table with the panel beside it, and where the money sits. */
function PlanScreen({ facts, figures, decisions }: { readonly facts: Facts; readonly figures: Figures; readonly decisions: Decisions }) {
  const intl = useIntl();
  const { decide, stepBy, message, busy, canUndo, canRedo } = decisions;
  const { currency } = householdOf(facts);
  const separator = decimalSeparator(intl.locale);

  const month = useMemo(() => planMonthOf(facts, figures), [facts, figures]);
  const groups = useMemo(() => (month === null ? [] : planGroups(facts, figures, month)), [facts, figures, month]);
  const banner = useMemo<Banner | null>(() => (month === null ? null : bannerOf(facts, figures, month)), [facts, figures, month]);
  const where = useMemo(() => whereTheMoneySits(facts, figures), [facts, figures]);
  const ids = useMemo(() => rowsOf(groups).map((row) => row.jobId), [groups]);

  const [selected, setSelected] = useState<JobId | null>(null);
  const [panelFor, setPanelFor] = useState<JobId | null>(null);
  const [editing, setEditing] = useState<JobId | null>(null);
  const [moving, setMoving] = useState<MoveDialogState | null>(null);
  const [newJob, setNewJob] = useState<{ readonly groupId: GroupId | null } | null>(null);

  const rowElements = useRef(new Map<JobId, HTMLTableRowElement>());
  const panelElement = useRef<HTMLElement>(null);
  const newJobSlot = useRef<HTMLDivElement>(null);
  const newJobButton = useRef<HTMLButtonElement>(null);
  const newJobOpener = useRef<Element | null>(null);
  const focusSelected = useRef(false);
  const focusPanel = useRef(false);

  const selectedId = selected !== null && ids.includes(selected) ? selected : (ids[0] ?? null);
  const openJob = panelFor !== null && ids.includes(panelFor) ? panelFor : null;
  const editable = month?.access === "editable";
  const editingId = editable && editing !== null && ids.includes(editing) ? editing : null;

  const money = (amount: Parameters<typeof moneyText>[1]) => moneyText(intl, amount, currency);

  // Focus follows a key or a close that moved it: back to the row, or into the panel that just opened.
  useEffect(() => {
    if (focusSelected.current && selectedId !== null) rowElements.current.get(selectedId)?.focus();
    focusSelected.current = false;
    if (focusPanel.current) panelElement.current?.focus();
    focusPanel.current = false;
  });

  const newJobOpen = newJob !== null;
  useEffect(() => {
    const slot = newJobSlot.current;
    if (!newJobOpen || slot === null) return;
    slot.scrollIntoView({ block: "nearest" });
    if (!slot.contains(document.activeElement)) slot.focus({ preventScroll: true });
  }, [newJobOpen]);

  const openPanel = (jobId: JobId) => {
    setSelected(jobId);
    setPanelFor(jobId);
    focusPanel.current = true;
  };
  const closePanel = () => {
    setPanelFor(null);
    focusSelected.current = true;
  };
  const startEdit = (jobId: JobId) => {
    if (!editable) return;
    setSelected(jobId);
    setEditing(jobId);
  };
  const cancelEdit = () => {
    setEditing(null);
    focusSelected.current = true;
  };
  const openMove = (from: JobId | null, to: MoveDestination | null) => setMoving({ from, to, opened: message });
  const openNewJob = (groupId: GroupId | null, opener: Element | null = document.activeElement) => {
    if (newJob === null) {
      newJobOpener.current = opener;
      setNewJob({ groupId });
    } else newJobSlot.current?.scrollIntoView({ block: "nearest" });
  };
  const closeNewJob = () => {
    setNewJob(null);
    const opener = newJobOpener.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    else focusSelected.current = true;
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (month === null) return;
    const intent = planKey(pressOf(event), { row: selectedId !== null, canEdit: editable && selectedId !== null, panelOpen: openJob !== null, canUndo, canRedo, busy });
    if (intent === null) return;
    event.preventDefault();
    switch (intent.kind) {
      case "newJob":
        return openNewJob(null, newJobButton.current);
      case "move": {
        const next = moveSelection(ids, selectedId, intent.step);
        focusSelected.current = true;
        setSelected(next);
        if (openJob !== null && next !== null) setPanelFor(next);
        return;
      }
      case "open":
        return selectedId === null ? undefined : openPanel(selectedId);
      case "edit":
        return selectedId === null ? undefined : startEdit(selectedId);
      case "closePanel":
        return closePanel();
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

  if (month === null || banner === null) return null;

  const problemText = (kind: "notAnAmount" | "negative") => intl.formatMessage({ id: kind === "notAnAmount" ? "plan.problem.notAnAmount" : "plan.problem.negative" });

  const saveEdit = async (jobId: JobId, text: string): Promise<SaveOutcome> => {
    const row = rowsOf(groups).find((r) => r.jobId === jobId);
    if (row === undefined) return { kind: "saved" };
    const edit = planAssignEdit(text, { month: month.month, jobId, current: row.assigned, currency });
    if (edit.kind === "invalid") return { kind: "problem", text: problemText(edit.problem) };
    if (edit.kind === "unchanged") {
      cancelEdit();
      return { kind: "saved" };
    }
    const saved = await decide(edit.command, intl.formatMessage({ id: "plan.done.assign" }, { job: row.name, amount: money(edit.amount) }));
    if (!saved) return { kind: "refused" };
    setEditing(null);
    focusSelected.current = true;
    return { kind: "saved" };
  };

  const summary = [
    intl.formatMessage({ id: "plan.jobs.in" }, { amount: money(month.figures.income) }),
    ...(month.figures.carriedIn > 0 ? [intl.formatMessage({ id: "plan.jobs.carried" }, { amount: money(month.figures.carriedIn) })] : []),
    ...(month.access === "editable" && month.figures.timing === "current" && dataReachesTo(figures) !== null
      ? [intl.formatMessage({ id: "plan.jobs.upTo" }, { date: formatDay(dataReachesTo(figures) ?? figures.asOf, intl.locale) })]
      : []),
  ];

  const said = message?.kind === "said";
  const refusal = moving !== null && message?.kind === "problem" && message !== moving.opened ? message.text : null;

  return (
    <div className={styles["page"]}>
      <header className={styles["header"]}>
        <div className={styles["heading"]}>
          <p className={`${styles["kicker"]} muted`}>{intl.formatMessage({ id: "plan.kicker" }, { month: monthAndYear(month.month, intl.locale), currency })}</p>
          <h1 className="type-title-screen">{intl.formatMessage({ id: "screen.plan.title" })}</h1>
        </div>
        <PlanHeader
          banner={banner}
          currency={currency}
          busy={busy}
          newJobButton={newJobButton}
          onQuickAdd={(add, unassigned) => void decide(quickAddCommand(month.month, add), intl.formatMessage({ id: "plan.done.quickAdd" }, { amount: money(unassigned), job: add.name }))}
          onMove={() => openMove(null, banner.kind === "overAssigned" ? { kind: "unassigned" } : null)}
          onOpenMonth={(toOpen) => void decide({ kind: "openMonth", month: toOpen }, intl.formatMessage({ id: "plan.done.open" }, { month: monthOnly(toOpen, intl.locale) }))}
          onReopenMonth={(reopen) => void decide({ kind: "reopenMonth", month: reopen }, intl.formatMessage({ id: "plan.done.reopen" }, { month: monthOnly(reopen, intl.locale) }))}
          onNewJob={() => openNewJob(null, newJobButton.current)}
        />
      </header>

      <div className={styles["notices"]}>
        <div className={styles["feedback"]} role="status" aria-live="polite">
          {message !== null && message.kind !== "problem" && <span className={styles["said"]}>{message.text}</span>}
          {said && canUndo && (
            <button type="button" className={controls["button"]} aria-keyshortcuts="U" disabled={busy} onClick={() => void stepBy("undo")}>
              {intl.formatMessage({ id: "plan.undo" })}
              <span className={controls["key"]} aria-hidden="true">
                {intl.formatMessage({ id: "plan.key.u" })}
              </span>
            </button>
          )}
          {said && canRedo && (
            <button type="button" className={controls["button"]} aria-keyshortcuts="Shift+U" disabled={busy} onClick={() => void stepBy("redo")}>
              {intl.formatMessage({ id: "plan.redo" })}
              <span className={controls["key"]} aria-hidden="true">
                {intl.formatMessage({ id: "plan.key.shiftU" })}
              </span>
            </button>
          )}
        </div>
        <div role="alert" className={styles["alert"]}>
          {message?.kind === "problem" && moving === null && <p className={styles["problem"]}>{message.text}</p>}
        </div>
      </div>

      {newJob !== null && (
        <div ref={newJobSlot} tabIndex={-1} className={styles["slot"]} data-slot="new-job">
          <NewJobFlow {...(newJob.groupId === null ? {} : { initialGroupId: newJob.groupId })} onClose={closeNewJob} />
        </div>
      )}

      <div className={styles["grid"]} data-panel={openJob === null ? "closed" : "open"}>
        <PlanTable
          groups={groups}
          month={month}
          currency={currency}
          separator={separator}
          selectedId={selectedId}
          editingId={editingId}
          busy={busy}
          summary={summary}
          onOpen={openPanel}
          onEdit={startEdit}
          onSaveEdit={saveEdit}
          onCancelEdit={cancelEdit}
          onMove={(jobId) => openMove(jobId, null)}
          onAddLine={(groupId, opener) => openNewJob(groupId, opener)}
          rowRef={(jobId, element) => {
            if (element === null) rowElements.current.delete(jobId);
            else rowElements.current.set(jobId, element);
          }}
        />
        {openJob !== null && (
          <aside ref={panelElement} tabIndex={-1} className={styles["panel"]} aria-label={intl.formatMessage({ id: "plan.panel.label" })}>
            <JobPanel jobId={openJob} onClose={closePanel} />
          </aside>
        )}
        <div className={styles["side"]}>
          <PlanAccounts where={where} currency={currency} />
          <MoneyIn />
        </div>
      </div>

      {moving !== null && (
        <MoveMoneyDialog
          facts={facts}
          groups={groups}
          month={month.month}
          currency={currency}
          initial={{ from: moving.from, to: moving.to }}
          busy={busy}
          refusal={refusal}
          onSubmit={decide}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

/** The Plan screen: how this month's money is divided, whether every unit has a job, how each job is doing, and where the money sits. */
export function Plan() {
  const intl = useIntl();
  const status = useLedgerStatus();
  const view = useFactsView();
  const figures = useFigures();
  const { reload } = useLedger();
  // Held here rather than in the ready screen, so the changes made on Plan stay undoable if the page takes a new snapshot.
  const decisions = useDecisions();

  if (status.kind === "ready" && view !== null && figures !== null) return <PlanScreen facts={view.facts} figures={figures} decisions={decisions} />;

  return (
    <div className={styles["page"]}>
      <header className={styles["header"]}>
        <div className={styles["heading"]}>
          <h1 className="type-title-screen">{intl.formatMessage({ id: "screen.plan.title" })}</h1>
          <p className="muted">{intl.formatMessage({ id: "screen.plan.question" })}</p>
        </div>
      </header>

      {status.kind === "loading" && <Skeleton />}

      {status.kind === "empty" && (
        <section className={styles["notice"]} aria-labelledby="plan-empty-title">
          <h2 id="plan-empty-title" className="type-title-section">
            {intl.formatMessage({ id: "plan.empty.title" })}
          </h2>
          <p className="muted">{intl.formatMessage({ id: "plan.empty.body" })}</p>
        </section>
      )}

      {status.kind === "failed" && (
        <section className={styles["notice"]} aria-labelledby="plan-failed-title">
          <h2 id="plan-failed-title" className="type-title-section">
            {intl.formatMessage({ id: "plan.failed.title" })}
          </h2>
          <p className="muted">{intl.formatMessage({ id: "plan.failed.body" })}</p>
          <button type="button" className={controls["button"]} onClick={() => void reload()}>
            {intl.formatMessage({ id: "plan.failed.retry" })}
          </button>
        </section>
      )}
    </div>
  );
}
