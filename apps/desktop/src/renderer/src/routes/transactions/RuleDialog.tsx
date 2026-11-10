import type { Currency, Facts, FamilyCommand, JobId } from "@holt/core";
import { type FormEvent, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { mintId } from "../../../../shared/ids.ts";
import controls from "./Controls.module.css";
import styles from "./Dialogs.module.css";
import { type PickableJob, groupedJobs } from "./jobs.ts";
import { Modal } from "./Modal.tsx";
import type { NeedsYouRow } from "./needsYou.model.ts";
import { type RuleForm, type RuleProblem, decimalSeparator, planRule, ruleCommand, startingForm } from "./rule.model.ts";

export interface RuleDialogProps {
  readonly row: NeedsYouRow;
  /** Every waiting row, so the rule can say which others it would sort. */
  readonly rows: readonly NeedsYouRow[];
  readonly facts: Facts;
  readonly currency: Currency;
  readonly locale: string;
  readonly jobs: readonly PickableJob[];
  readonly subject: string;
  /** The one change that makes the rule and sorts the transactions, and how many it sorts. */
  readonly onSubmit: (command: FamilyCommand, sorted: number) => void;
  readonly onClose: () => void;
}

const problemText: Record<RuleProblem, string> = {
  chooseJob: "needsYou.rule.problem.chooseJob",
  badAmount: "needsYou.rule.problem.badAmount",
  rangeBackwards: "needsYou.rule.problem.rangeBackwards",
};

/** "Always do this": shows the rule the choice would make, and makes it together with this transaction's treatment. */
export function RuleDialog({ row, rows, facts, currency, locale, jobs, subject, onSubmit, onClose }: RuleDialogProps) {
  const intl = useIntl();
  const [id] = useState(() => mintId("rule"));
  const [form, setForm] = useState<RuleForm>(() => startingForm(row));
  const [tried, setTried] = useState(false);
  const groups = useMemo(() => groupedJobs(jobs), [jobs]);
  const plan = planRule({ id, row, rows, facts, form, currency, separator: decimalSeparator(locale) });
  const others = plan.ok ? plan.others.length : 0;
  const canSameSplit = row.suggestion !== null && row.suggestion.jobs.length > 1 && row.suggestion.shares !== null;
  const jobId = form.result.kind === "job" ? form.result.jobId : null;
  const change = (more: Partial<RuleForm>) => setForm((previous) => ({ ...previous, ...more }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!plan.ok) {
      setTried(true);
      return;
    }
    const { command, sorted } = ruleCommand(plan, row, form.alsoSortOthers && plan.others.length > 0);
    onSubmit(command, sorted);
  };

  return (
    <Modal title={intl.formatMessage({ id: "needsYou.rule.title" })} subject={subject} hint={intl.formatMessage({ id: "needsYou.rule.intro" })} wide onClose={onClose}>
      <form className={styles["form"]} onSubmit={submit} noValidate>
        <dl className={styles["facts"]}>
          <dt>{intl.formatMessage({ id: "needsYou.rule.payee" })}</dt>
          <dd>{row.transaction.counterparty}</dd>
          <dt>{intl.formatMessage({ id: "needsYou.rule.appliesTo" })}</dt>
          <dd>{intl.formatMessage({ id: row.direction === "out" ? "needsYou.rule.directionOut" : "needsYou.rule.directionIn" })}</dd>
        </dl>

        <div className={styles["group"]}>
          <label className={styles["choice"]}>
            <input type="checkbox" checked={form.onlyThisAccount} onChange={(event) => change({ onlyThisAccount: event.target.checked })} />
            {intl.formatMessage({ id: "needsYou.rule.account" }, { account: row.accountName })}
          </label>
          <p className={styles["help"]}>{intl.formatMessage({ id: "needsYou.rule.accountHelp" })}</p>
        </div>

        <fieldset className={styles["group"]}>
          <legend className={styles["legend"]}>{intl.formatMessage({ id: "needsYou.rule.amount" })}</legend>
          <div className={styles["range"]}>
            <label>
              {intl.formatMessage({ id: "needsYou.rule.low" })}
              <input className={controls["field"]} inputMode="decimal" autoComplete="off" value={form.low} onChange={(event) => change({ low: event.target.value })} />
            </label>
            <label>
              {intl.formatMessage({ id: "needsYou.rule.high" })}
              <input className={controls["field"]} inputMode="decimal" autoComplete="off" value={form.high} onChange={(event) => change({ high: event.target.value })} />
            </label>
          </div>
        </fieldset>

        <fieldset className={styles["group"]}>
          <legend className={styles["legend"]}>{intl.formatMessage({ id: "needsYou.rule.result" })}</legend>
          {canSameSplit && (
            <label className={styles["choice"]}>
              <input type="radio" name="rule-result" checked={form.result.kind === "sameSplit"} onChange={() => change({ result: { kind: "sameSplit" } })} />
              {intl.formatMessage({ id: "needsYou.rule.sameSplit" })}
            </label>
          )}
          {canSameSplit && (
            <label className={styles["choice"]}>
              <input type="radio" name="rule-result" checked={form.result.kind === "job"} onChange={() => change({ result: { kind: "job", jobId } })} />
              {intl.formatMessage({ id: "needsYou.rule.oneJob" })}
            </label>
          )}
          <select
            className={`${controls["field"]} ${styles["select"]}`}
            aria-label={intl.formatMessage({ id: "needsYou.rule.job" })}
            value={jobId ?? ""}
            onChange={(event) => change({ result: { kind: "job", jobId: event.target.value === "" ? null : (event.target.value as JobId) } })}
          >
            <option value="">{intl.formatMessage({ id: "needsYou.rule.chooseJob" })}</option>
            {groups.map((group, index) => (
              <optgroup key={`${index}-${group.name}`} label={group.name}>
                {group.jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </fieldset>

        {others > 0 && (
          <label className={styles["choice"]}>
            <input type="checkbox" checked={form.alsoSortOthers} onChange={(event) => change({ alsoSortOthers: event.target.checked })} />
            {intl.formatMessage({ id: "needsYou.rule.others" }, { count: others })}
          </label>
        )}

        {tried && !plan.ok && (
          <p role="alert" className={styles["problem"]}>
            {intl.formatMessage({ id: problemText[plan.problem] })}
          </p>
        )}

        <div className={styles["actions"]}>
          <button type="button" className={controls["button"]} onClick={onClose}>
            {intl.formatMessage({ id: "needsYou.cancel" })}
          </button>
          <button type="submit" className={`${controls["button"]} ${controls["primary"]}`}>
            {intl.formatMessage({ id: "needsYou.rule.submit" })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
