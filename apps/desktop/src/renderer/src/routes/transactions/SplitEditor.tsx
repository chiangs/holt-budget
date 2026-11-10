import { type Allocation, type JobId, type Transaction, householdOf } from "@holt/core";
import { Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useFactsView } from "../../data/ledger.tsx";
import { formatFullDay } from "../../i18n/dates.ts";
import { formatMoney } from "../../i18n/money.ts";
import { AllModal } from "./AllModal.tsx";
import controls from "./AllControls.module.css";
import { signedMoney, titleOf } from "./AllLabels.model.ts";
import type { PickableJob } from "./jobs.ts";
import styles from "./SplitEditor.module.css";
import { type Blocker, type DecimalSeparator, type RowProblem, addRow, assignRest, checkSplit, initialDraft, maxSplitRows, removeRow, restFor, setRowJob, setRowText, splitEvenly } from "./SplitEditor.model.ts";

export interface SplitEditorProps {
  readonly transaction: Transaction;
  readonly jobs: readonly PickableJob[];
  /** Start from these allocations, such as the current split. */
  readonly initial?: readonly Allocation[];
  /** Called only with allocations that add up to the transaction's whole amount. */
  readonly onSubmit: (allocations: readonly [Allocation, ...Allocation[]]) => void;
  readonly onClose: () => void;
}

const problemText = { badAmount: "browse.split.problem.badAmount", zero: "browse.split.problem.zero", duplicateJob: "browse.split.problem.duplicateJob", noJob: null } as const satisfies Record<RowProblem, string | null>;

/** Only the blockers the rows' own messages and the "left" line do not already say. */
const hintText = {
  tooMany: "browse.split.hint.tooMany",
  badAmount: "browse.split.hint.badAmount",
  zero: "browse.split.hint.zero",
  noJob: "browse.split.hint.noJob",
  noAmount: "browse.split.hint.noAmount",
  duplicateJob: "browse.split.hint.duplicateJob",
  over: null,
  notAllAssigned: null,
} as const satisfies Record<Blocker, string | null>;

function decimalSeparatorOf(locale: string): DecimalSeparator {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value === "," ? "," : ".";
}

function groupedJobs(jobs: readonly PickableJob[]): readonly (readonly [string, readonly PickableJob[]])[] {
  const groups = new Map<string, PickableJob[]>();
  for (const job of jobs) groups.set(job.groupName, [...(groups.get(job.groupName) ?? []), job]);
  return [...groups];
}

/** Splits one transaction across jobs. Save stays off until the rows add up to the whole amount exactly. */
export function SplitEditor({ transaction, jobs, initial, onSubmit, onClose }: SplitEditorProps) {
  const intl = useIntl();
  const view = useFactsView();
  const titleId = useId();
  const hintId = useId();
  const currency = view === null ? null : householdOf(view.facts).currency;
  const separator = decimalSeparatorOf(intl.locale);
  const moneyIn = transaction.amount > 0;

  const [draft, setDraft] = useState(() => (currency === null ? { rows: [], nextKey: 0 } : initialDraft(initial, currency, separator)));
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const jobSelects = useRef(new Map<number, HTMLSelectElement>());
  const amountInputs = useRef(new Map<number, HTMLInputElement>());

  const check = useMemo(() => (currency === null ? null : checkSplit(transaction, draft.rows, currency)), [transaction, draft.rows, currency]);

  useEffect(() => {
    if (focusKey === null) return;
    jobSelects.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, draft.rows]);

  if (currency === null || check === null) return null;
  const format = (minor: number): string => formatMoney(minor, currency, intl.locale);
  const groups = groupedJobs(jobs);
  const usedElsewhere = (key: number): Set<JobId> => new Set(draft.rows.flatMap((row) => (row.key !== key && row.jobId !== null ? [row.jobId] : [])));

  const add = (): void => {
    if (draft.rows.length >= maxSplitRows) return;
    setFocusKey(draft.nextKey);
    setDraft(addRow(draft));
  };

  const save = (): void => {
    if (check.allocations !== null) onSubmit(check.allocations);
  };

  const enterOnAmount = (key: number): void => {
    if (check.allocations !== null) return save();
    const index = draft.rows.findIndex((row) => row.key === key);
    const next = draft.rows[index + 1];
    if (next !== undefined) return jobSelects.current.get(next.key)?.focus();
    if (check.left > 0) add();
  };

  const status =
    check.left > 0
      ? intl.formatMessage({ id: "browse.split.left" }, { amount: format(check.left) })
      : check.left < 0
        ? intl.formatMessage({ id: "browse.split.over" }, { amount: format(-check.left) })
        : intl.formatMessage({ id: "browse.split.done" });
  const firstBlocker = check.blockers[0];
  const hint = firstBlocker === undefined ? null : hintText[firstBlocker];

  return (
    <AllModal labelledBy={titleId} onClose={onClose} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2 id={titleId} className={controls.title}>
          {intl.formatMessage({ id: moneyIn ? "browse.split.titleIn" : "browse.split.titleOut" })}
        </h2>
        <p className={controls.lead}>
          {intl.formatMessage(
            { id: "browse.split.about" },
            { name: titleOf(transaction), date: formatFullDay(transaction.bookingDate, intl.locale), amount: signedMoney(transaction.amount, currency, intl.locale) },
          )}
        </p>

        <ul className={styles.rows}>
          {draft.rows.map((row, i) => {
            const rowCheck = check.rows[i];
            const problem = rowCheck?.problem ?? null;
            const problemId = problem === null ? null : problemText[problem];
            const taken = usedElsewhere(row.key);
            const n = i + 1;
            return (
              <li key={row.key} className={styles.row}>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor={`${titleId}-job-${row.key}`}>
                    {intl.formatMessage({ id: "browse.split.jobLabel" }, { n })}
                  </label>
                  <select
                    id={`${titleId}-job-${row.key}`}
                    className={controls.input}
                    value={row.jobId ?? ""}
                    ref={refFor(jobSelects, row.key)}
                    onChange={(event) => setDraft(setRowJob(draft, row.key, event.target.value === "" ? null : (event.target.value as JobId)))}
                  >
                    <option value="">{intl.formatMessage({ id: "browse.split.chooseJob" })}</option>
                    {groups.map(([groupName, members]) => (
                      <optgroup key={groupName} label={groupName}>
                        {members.map((job) => (
                          <option key={job.id} value={job.id} disabled={taken.has(job.id)}>
                            {job.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor={`${titleId}-amount-${row.key}`}>
                    {intl.formatMessage({ id: moneyIn ? "browse.split.amountLabelIn" : "browse.split.amountLabelOut" }, { n })}
                  </label>
                  <input
                    id={`${titleId}-amount-${row.key}`}
                    className={`${controls.input} ${controls.figure} ${styles.amount}`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.text}
                    aria-invalid={problem === "badAmount" || problem === "zero"}
                    aria-describedby={problemId === null ? undefined : `${titleId}-problem-${row.key}`}
                    ref={refFor(amountInputs, row.key)}
                    onChange={(event) => setDraft(setRowText(draft, row.key, event.target.value))}
                    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      enterOnAmount(row.key);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className={controls.button}
                  disabled={restFor(check, row.key) <= 0}
                  aria-label={intl.formatMessage({ id: "browse.split.restLabel" }, { n })}
                  onClick={() => {
                    setDraft(assignRest(draft, row.key, transaction, currency, separator));
                    amountInputs.current.get(row.key)?.focus();
                  }}
                >
                  {intl.formatMessage({ id: "browse.split.rest" })}
                </button>
                <button
                  type="button"
                  className={controls.iconButton}
                  disabled={draft.rows.length <= 1}
                  aria-label={intl.formatMessage({ id: "browse.split.removeLabel" }, { n })}
                  onClick={() => setDraft(removeRow(draft, row.key))}
                >
                  <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
                {problemId !== null && (
                  <p id={`${titleId}-problem-${row.key}`} className={`${styles.problem} ${controls.danger}`}>
                    {intl.formatMessage({ id: problemId })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className={styles.tools}>
          <button type="button" className={controls.button} onClick={add} disabled={draft.rows.length >= maxSplitRows}>
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
            {intl.formatMessage({ id: "browse.split.add" })}
          </button>
          <button type="button" className={controls.button} onClick={() => setDraft(splitEvenly(draft, transaction, currency, separator))}>
            {intl.formatMessage({ id: "browse.split.evenly" })}
          </button>
        </div>

        <p className={`${styles.left} ${check.left === 0 ? "" : styles.off}`} role="status">
          {status}
        </p>
        <p id={hintId} className={styles.hint}>
          {hint === null ? "" : intl.formatMessage({ id: hint })}
        </p>

        <div className={controls.actions}>
          <button type="button" className={controls.button} onClick={onClose}>
            {intl.formatMessage({ id: "browse.split.cancel" })}
          </button>
          <button type="submit" className={`${controls.button} ${controls.primary}`} disabled={check.allocations === null} aria-describedby={hintId}>
            {intl.formatMessage({ id: "browse.split.save" })}
          </button>
        </div>
      </form>
    </AllModal>
  );
}

function refFor<T extends HTMLElement>(registry: RefObject<Map<number, T>>, key: number) {
  return (element: T | null): void => {
    if (element === null) registry.current.delete(key);
    else registry.current.set(key, element);
  };
}
