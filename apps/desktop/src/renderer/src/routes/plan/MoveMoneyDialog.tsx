import { type Currency, type FamilyCommand, type Facts, type JobId, type Money, type Month, money as makeMoney } from "@holt/core";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import { JobPicker } from "../transactions/JobPicker.tsx";
import { pickableJobs } from "../transactions/jobs.ts";
import { Modal } from "../transactions/Modal.tsx";
import styles from "./MoveMoneyDialog.module.css";
import { type MoveDestination, type MoveForm, type MoveProblem, planMove } from "./PlanEdit.model.ts";
import { moneyText } from "./PlanStatus.ts";
import type { PlanGroup } from "./PlanTable.model.ts";

export interface MoveMoneyDialogProps {
  readonly facts: Facts;
  readonly groups: readonly PlanGroup[];
  readonly month: Month;
  readonly currency: Currency;
  readonly initial: { readonly from: JobId | null; readonly to: MoveDestination | null };
  /** A change is being saved. */
  readonly busy: boolean;
  /** Why the last attempt didn't happen, when core refused it or the call failed. */
  readonly refusal: string | null;
  /** Runs the command and says `done` once it is saved. True when it was. */
  readonly onSubmit: (command: FamilyCommand, done: string) => Promise<boolean>;
  readonly onClose: () => void;
}

/** Move money from one job's assignment to another job, or back to unassigned. The family chooses both ends and an amount, and nothing changes until Move money. */
export function MoveMoneyDialog({ facts, groups, month, currency, initial, busy, refusal, onSubmit, onClose }: MoveMoneyDialogProps) {
  const intl = useIntl();
  const fromId = useId();
  const amountId = useId();
  const helpId = useId();
  const [form, setForm] = useState<MoveForm>({ from: initial.from, to: initial.to, amountText: "" });
  const [attempted, setAttempted] = useState(false);
  const [picking, setPicking] = useState(false);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const money = (amount: Money) => moneyText(intl, amount, currency);

  const rows = useMemo(() => groups.flatMap((group) => group.rows.map((row) => ({ ...row, groupName: group.name }))), [groups]);
  const assignedOf = (jobId: JobId): Money => rows.find((row) => row.jobId === jobId)?.assigned ?? makeMoney(0);
  const nameOf = (jobId: JobId): string => facts.jobs.get(jobId)?.name ?? "";
  const movable = rows.filter((row) => row.assigned > 0);
  const plan = planMove(form, { month, currency, assignedOf });
  const problem: MoveProblem | null = plan.kind === "problem" ? plan.problem : null;

  useEffect(() => {
    if (initial.from === null) return;
    const frame = requestAnimationFrame(() => chooseButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [initial.from]);

  const problemText = (found: MoveProblem): string => {
    switch (found) {
      case "chooseFrom":
        return intl.formatMessage({ id: "plan.move.problem.chooseFrom" });
      case "chooseTo":
        return intl.formatMessage({ id: "plan.move.problem.chooseTo" });
      case "sameJob":
        return intl.formatMessage({ id: "plan.move.problem.sameJob" });
      case "notAnAmount":
        return intl.formatMessage({ id: "plan.problem.notAnAmount" });
      case "negative":
        return intl.formatMessage({ id: "plan.problem.negative" });
      case "notAbove":
        return intl.formatMessage({ id: "plan.move.problem.notAbove" });
      case "tooMuch":
        return intl.formatMessage({ id: "plan.move.problem.tooMuch" }, { job: form.from === null ? "" : nameOf(form.from), amount: money(form.from === null ? makeMoney(0) : assignedOf(form.from)) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (plan.kind !== "move" || form.from === null || form.to === null || busy) return;
    const from = nameOf(form.from);
    const done =
      form.to.kind === "job"
        ? intl.formatMessage({ id: "plan.done.move" }, { amount: money(plan.amount), from, to: nameOf(form.to.jobId) })
        : intl.formatMessage({ id: "plan.done.unassign" }, { amount: money(plan.amount), from });
    if (await onSubmit(plan.command, done)) onClose();
  };

  const groupsOfRows = groups.filter((group) => group.rows.some((row) => row.assigned > 0));

  return (
    <>
      <Modal title={intl.formatMessage({ id: "plan.moveDialog.title" })} hint={intl.formatMessage({ id: "plan.moveDialog.hint" })} onClose={onClose}>
        <form className={styles["form"]} onSubmit={(event) => void submit(event)} noValidate>
          <div className={styles["field"]}>
            <label htmlFor={fromId} className={styles["label"]}>
              {intl.formatMessage({ id: "plan.moveDialog.from" })}
            </label>
            <select
              id={fromId}
              className={`${controls["field"]} ${styles["select"]}`}
              value={form.from ?? ""}
              onChange={(event) => setForm({ ...form, from: movable.find((row) => row.jobId === event.target.value)?.jobId ?? null })}
              aria-describedby={helpId}
            >
              <option value="">{intl.formatMessage({ id: "plan.moveDialog.chooseFrom" })}</option>
              {groupsOfRows.map((group) => (
                <optgroup key={group.id} label={group.name}>
                  {group.rows
                    .filter((row) => row.assigned > 0)
                    .map((row) => (
                      <option key={row.jobId} value={row.jobId}>
                        {row.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <p id={helpId} className={styles["help"]}>
              {form.from === null ? intl.formatMessage({ id: "plan.moveDialog.fromHelp" }) : intl.formatMessage({ id: "plan.moveDialog.assigned" }, { amount: money(assignedOf(form.from)) })}
            </p>
          </div>

          <fieldset className={styles["group"]}>
            <legend className={styles["label"]}>{intl.formatMessage({ id: "plan.moveDialog.to" })}</legend>
            <div className={styles["choices"]}>
              <button
                ref={chooseButton}
                type="button"
                className={`${controls["button"]} ${styles["choice"]}`}
                aria-pressed={form.to?.kind === "job"}
                aria-haspopup="dialog"
                onClick={() => setPicking(true)}
              >
                {form.to?.kind === "job" ? nameOf(form.to.jobId) : intl.formatMessage({ id: "plan.moveDialog.chooseJob" })}
              </button>
              <button type="button" className={`${controls["button"]} ${styles["choice"]}`} aria-pressed={form.to?.kind === "unassigned"} onClick={() => setForm({ ...form, to: { kind: "unassigned" } })}>
                {intl.formatMessage({ id: "plan.moveDialog.unassigned" })}
              </button>
            </div>
          </fieldset>

          <div className={styles["field"]}>
            <label htmlFor={amountId} className={styles["label"]}>
              {intl.formatMessage({ id: "plan.moveDialog.amount" })}
            </label>
            <input
              id={amountId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={`${controls["field"]} ${styles["input"]}`}
              value={form.amountText}
              onChange={(event) => setForm({ ...form, amountText: event.target.value })}
              aria-invalid={attempted && problem !== null}
            />
          </div>

          <div role="alert">
            {attempted && problem !== null && <p className={styles["problem"]}>{problemText(problem)}</p>}
            {refusal !== null && <p className={styles["problem"]}>{refusal}</p>}
          </div>

          <div className={styles["actions"]}>
            <button type="button" className={controls["button"]} onClick={onClose}>
              {intl.formatMessage({ id: "plan.moveDialog.cancel" })}
            </button>
            <button type="submit" className={`${controls["button"]} ${controls["primary"]}`} disabled={busy}>
              {intl.formatMessage({ id: "plan.moveDialog.submit" })}
            </button>
          </div>
        </form>
      </Modal>
      {picking && (
        <JobPicker
          jobs={pickableJobs(facts).filter((job) => job.id !== form.from)}
          titleId="plan.moveDialog.pickTitle"
          hintId="plan.moveDialog.pickHint"
          onPick={(jobId) => {
            setForm({ ...form, to: { kind: "job", jobId } });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
