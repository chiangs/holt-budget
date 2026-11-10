import type { AccountId, JobId, Month } from "@holt/core";
import { Search } from "lucide-react";
import { type RefObject, useId } from "react";
import { useIntl } from "react-intl";
import type { MessageId } from "../../i18n/messages.ts";
import { type AllFilter, type RuleFilter, type TreatmentKind, everything, isFiltering, treatmentKinds } from "./AllFilter.model.ts";
import controls from "./AllControls.module.css";
import styles from "./AllFilterBar.module.css";
import type { PickableJob } from "./jobs.ts";

export interface AllFilterBarProps {
  readonly filter: AllFilter;
  readonly onChange: (filter: AllFilter) => void;
  readonly accounts: readonly { readonly id: AccountId; readonly name: string }[];
  readonly jobs: readonly PickableJob[];
  readonly months: readonly Month[];
  readonly monthLabel: (month: Month) => string;
  readonly searchRef: RefObject<HTMLInputElement | null>;
}

const treatmentWords = {
  needsYou: "browse.filter.treatment.needsYou",
  income: "browse.filter.treatment.income",
  transfer: "browse.filter.treatment.transfer",
  split: "browse.filter.treatment.split",
  history: "browse.filter.treatment.history",
} as const satisfies Record<TreatmentKind, string>;

const ruleWords = {
  any: "browse.filter.rule.any",
  applied: "browse.filter.rule.applied",
  none: "browse.filter.rule.none",
} as const satisfies Record<RuleFilter, string>;

const ruleChoices: readonly RuleFilter[] = ["any", "applied", "none"];

/** The search box and the filters. Every control is a native field, so each has its label, its keyboard and its focus ring for free. */
export function AllFilterBar({ filter, onChange, accounts, jobs, months, monthLabel, searchRef }: AllFilterBarProps) {
  const intl = useIntl();
  const id = useId();
  const groups = new Map<string, PickableJob[]>();
  for (const job of jobs) groups.set(job.groupName, [...(groups.get(job.groupName) ?? []), job]);

  const set = (change: Partial<AllFilter>): void => onChange({ ...filter, ...change });
  const label = (suffix: string, messageId: MessageId) => (
    <label className={controls.label} htmlFor={`${id}-${suffix}`}>
      {intl.formatMessage({ id: messageId })}
    </label>
  );

  return (
    <div className={styles.bar}>
      <div className={styles.search}>
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          className={styles.searchInput}
          autoComplete="off"
          spellCheck={false}
          aria-label={intl.formatMessage({ id: "browse.filter.searchLabel" })}
          aria-keyshortcuts="/"
          placeholder={intl.formatMessage({ id: "browse.filter.searchPlaceholder" })}
          value={filter.search}
          onChange={(event) => set({ search: event.target.value })}
        />
      </div>
      <div className={styles.filters}>
        <div className={controls.field}>
          {label("account", "browse.filter.account")}
          <select id={`${id}-account`} className={controls.input} value={filter.account ?? ""} onChange={(event) => set({ account: event.target.value === "" ? null : (event.target.value as AccountId) })}>
            <option value="">{intl.formatMessage({ id: "browse.filter.account.any" })}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          {label("job", "browse.filter.job")}
          <select id={`${id}-job`} className={controls.input} value={filter.job ?? ""} onChange={(event) => set({ job: event.target.value === "" ? null : (event.target.value as JobId) })}>
            <option value="">{intl.formatMessage({ id: "browse.filter.job.any" })}</option>
            {[...groups].map(([groupName, members]) => (
              <optgroup key={groupName} label={groupName}>
                {members.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          {label("treatment", "browse.filter.treatment")}
          <select id={`${id}-treatment`} className={controls.input} value={filter.treatment ?? ""} onChange={(event) => set({ treatment: event.target.value === "" ? null : (event.target.value as TreatmentKind) })}>
            <option value="">{intl.formatMessage({ id: "browse.filter.treatment.any" })}</option>
            {treatmentKinds.map((kind) => (
              <option key={kind} value={kind}>
                {intl.formatMessage({ id: treatmentWords[kind] })}
              </option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          {label("month", "browse.filter.month")}
          <select id={`${id}-month`} className={controls.input} value={filter.month ?? ""} onChange={(event) => set({ month: event.target.value === "" ? null : (event.target.value as Month) })}>
            <option value="">{intl.formatMessage({ id: "browse.filter.month.any" })}</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          {label("rule", "browse.filter.rule")}
          <select id={`${id}-rule`} className={controls.input} value={filter.rule} onChange={(event) => set({ rule: event.target.value as RuleFilter })}>
            {ruleChoices.map((choice) => (
              <option key={choice} value={choice}>
                {intl.formatMessage({ id: ruleWords[choice] })}
              </option>
            ))}
          </select>
        </div>
        {isFiltering(filter) && (
          <button type="button" className={`${controls.button} ${styles.clear}`} onClick={() => onChange(everything)}>
            {intl.formatMessage({ id: "browse.filter.clear" })}
          </button>
        )}
      </div>
    </div>
  );
}
