import { type Facts, type Figures } from "@holt/core";
import { Fragment, useId, type ReactNode } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import styles from "./NewJob.module.css";
import { CheckField, Field } from "./NewJobControls.tsx";
import { NewJobSits } from "./NewJobSits.tsx";
import {
  type Draft,
  type NewJobContext,
  type NewAccountDraft,
  type Problem,
  emptyAccount,
  firstMonthOf,
  groupsInOrder,
  newGroupChoice,
  paidIntoAccounts,
  reachOf,
  asksWhereItSits,
  sharedAccounts,
  sitsOptions,
} from "./NewJob.model.ts";
import { monthLabel, problemText } from "./NewJob.text.ts";
import { monthOnly } from "./PlanFormat.ts";
import { moneyText } from "./PlanStatus.ts";

export interface NewJobFieldsProps {
  readonly draft: Draft;
  readonly onChange: (next: Draft) => void;
  readonly facts: Facts;
  readonly figures: Figures;
  readonly context: NewJobContext;
  /** The problems to show. Nothing until the family has pressed Add job once. */
  readonly problems: readonly Problem[];
}

const newGroup = "new";
const newAccount = "new";

/** The fields of the chosen kind of job, in the order the mockup has them. Each shows its own problem in words. */
export function NewJobFields({ draft, onChange, facts, figures, context, problems }: NewJobFieldsProps) {
  const intl = useIntl();
  const base = useId();
  const first = firstMonthOf(context);
  const textOf = (field: Problem["field"]): string | null => {
    const found = problems.find((problem) => problem.field === field);
    return found === undefined ? null : problemText(intl, found, first);
  };
  const set = (changes: Partial<Draft>) => onChange({ ...draft, ...changes });
  const id = (name: string) => `${base}-${name}`;

  const name = (
    <Field id={id("name")} label={intl.formatMessage({ id: "plan.new.field.name" })} problem={textOf("name")}>
      {(control) => <input {...control} type="text" autoComplete="off" className={`${controls["field"]} ${styles["input"]}`} value={draft.name} onChange={(event) => set({ name: event.target.value })} />}
    </Field>
  );

  const amount = (
    <Field id={id("amount")} label={intl.formatMessage({ id: "plan.new.field.amount" })} problem={textOf("amount")}>
      {(control) => (
        <input {...control} type="text" inputMode="decimal" autoComplete="off" className={`${controls["field"]} ${styles["input"]} ${styles["num"]}`} value={draft.amount} onChange={(event) => set({ amount: event.target.value })} />
      )}
    </Field>
  );

  const groups = groupsInOrder(facts);
  const groupValue = draft.group.kind === "new" ? newGroup : (draft.group.groupId ?? "");
  const group = (
    <Fragment>
      <Field id={id("group")} label={intl.formatMessage({ id: "plan.new.field.group" })} problem={textOf("group")}>
        {(control) => (
          <select
            {...control}
            className={`${controls["field"]} ${styles["input"]}`}
            value={groupValue}
            onChange={(event) => set({ group: event.target.value === newGroup ? newGroupChoice(draft.kind) : { kind: "existing", groupId: groups.find((entry) => entry.id === event.target.value)?.id ?? null } })}
          >
            {groupValue === "" && <option value="">{intl.formatMessage({ id: "plan.new.field.choose" })}</option>}
            {groups.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
            <option value={newGroup}>{intl.formatMessage({ id: "plan.new.field.groupNew" })}</option>
          </select>
        )}
      </Field>
    </Fragment>
  );

  const newGroupFields =
    draft.group.kind === "new" ? (
      <div className={styles["fields"]}>
        <Field id={id("groupName")} label={intl.formatMessage({ id: "plan.new.field.groupName" })} problem={textOf("groupName")}>
          {(control) => (
            <input
              {...control}
              type="text"
              autoComplete="off"
              className={`${controls["field"]} ${styles["input"]}`}
              value={draft.group.kind === "new" ? draft.group.name : ""}
              onChange={(event) => draft.group.kind === "new" && set({ group: { ...draft.group, name: event.target.value } })}
            />
          )}
        </Field>
        <CheckField
          id={id("groupCounts")}
          label={intl.formatMessage({ id: "plan.new.field.groupCounts" })}
          checked={draft.group.counts}
          onChange={(counts) => draft.group.kind === "new" && set({ group: { ...draft.group, counts } })}
        />
      </div>
    ) : null;

  const accounts = sharedAccounts(facts);
  const paidFrom = (help: string): ReactNode => (
    <Field id={id("paidFrom")} label={intl.formatMessage({ id: "plan.new.field.paidFrom" })} problem={textOf("paidFrom")} help={help}>
      {(control) => (
        <select {...control} className={`${controls["field"]} ${styles["input"]}`} value={draft.paidFrom ?? ""} onChange={(event) => set({ paidFrom: accounts.find((account) => account.id === event.target.value)?.id ?? null })}>
          {draft.paidFrom === null && <option value="">{intl.formatMessage({ id: "plan.new.field.choose" })}</option>}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const sits = asksWhereItSits(draft) ? <NewJobSits draft={draft} options={sitsOptions(facts, figures)} onChange={onChange} problem={textOf("sits")} /> : null;

  if (draft.kind === "spend") {
    return (
      <div className={styles["body"]}>
        <div className={styles["fields"]}>
          {name}
          {amount}
          {group}
        </div>
        {newGroupFields}
        <div className={styles["checks"]}>
          <CheckField id={id("essential")} label={intl.formatMessage({ id: "plan.new.field.essential" })} help={intl.formatMessage({ id: "plan.new.field.essentialHelp" })} checked={draft.essential} onChange={(essential) => set({ essential })} />
          <CheckField id={id("keeps")} label={intl.formatMessage({ id: "plan.new.field.keepsMoney" })} help={intl.formatMessage({ id: "plan.new.field.keepsMoneyHelp" })} checked={draft.keepsMoney} onChange={(keepsMoney) => set({ keepsMoney })} />
        </div>
        {draft.keepsMoney ? sits : <div className={styles["fields"]}>{paidFrom(intl.formatMessage({ id: "plan.new.field.paidFromHelp" }))}</div>}
      </div>
    );
  }

  if (draft.kind === "saveUp") {
    const monthly = draft.targetMode === "monthly";
    const reach = reachOf(draft, context);
    const tooEarly = reach.kind === "tooEarly";
    const readyByProblem = problems.find((problem) => problem.field === "readyBy");
    const sentence = (): ReactNode => {
      const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
      if (reach.kind === "waiting") return intl.formatMessage({ id: "plan.new.reachWaiting" });
      if (reach.kind === "tooEarly") return intl.formatMessage({ id: "plan.new.problem.readyByTooEarly" }, { from: monthLabel(reach.from, reach.from, intl.locale) });
      const { monthly: each, months, from, to } = reach.reach;
      if (months === 1) return intl.formatMessage({ id: "plan.new.reachOne" }, { monthly: moneyText(intl, each, context.currency), month: monthOnly(from, intl.locale), strong });
      return intl.formatMessage(
        { id: "plan.new.reach" },
        { monthly: moneyText(intl, each, context.currency), months, from: monthOnly(from, intl.locale), to: monthLabel(to, from, intl.locale), strong },
      );
    };
    return (
      <div className={styles["body"]}>
        <div className={styles["fields"]}>
          {name}
          {group}
          {monthly ? (
            amount
          ) : (
            <>
              <Field id={id("target")} label={intl.formatMessage({ id: "plan.new.field.target" })} problem={textOf("target")}>
                {(control) => (
                  <input {...control} type="text" inputMode="decimal" autoComplete="off" className={`${controls["field"]} ${styles["input"]} ${styles["num"]}`} value={draft.target} onChange={(event) => set({ target: event.target.value })} />
                )}
              </Field>
              <Field
                id={id("readyBy")}
                label={intl.formatMessage({ id: "plan.new.field.readyBy" })}
                problem={tooEarly ? null : (readyByProblem === undefined ? null : textOf("readyBy"))}
                invalid={readyByProblem !== undefined || tooEarly}
                {...(tooEarly ? { describedBy: id("reach") } : {})}
              >
                {(control) => <input {...control} type="month" className={`${controls["field"]} ${styles["input"]}`} value={draft.readyBy} onChange={(event) => set({ readyBy: event.target.value })} />}
              </Field>
            </>
          )}
        </div>
        {newGroupFields}
        <div className={styles["reach"]} id={id("reach")}>
          {!monthly && <p>{sentence()}</p>}
          <button type="button" className={styles["link"]} onClick={() => set({ targetMode: monthly ? "byMonth" : "monthly" })}>
            {intl.formatMessage({ id: monthly ? "plan.new.reachTarget" : "plan.new.reachMonthly" })}
          </button>
        </div>
        {sits}
      </div>
    );
  }

  const paying = draft.payInto;
  const paidInto = paidIntoAccounts(facts);
  const adding = paying.kind === "new" ? paying.account : null;
  const setAccount = (changes: Partial<NewAccountDraft>) => adding !== null && set({ payInto: { kind: "new", account: { ...adding, ...changes } } });
  return (
    <div className={styles["body"]}>
      <div className={styles["fields"]}>
        {name}
        {amount}
        {group}
        {paidFrom(intl.formatMessage({ id: "plan.new.field.paidFromPayHelp" }))}
        <Field id={id("paysInto")} label={intl.formatMessage({ id: "plan.new.field.paysInto" })} problem={textOf("payInto")}>
          {(control) => (
            <select
              {...control}
              className={`${controls["field"]} ${styles["input"]}`}
              value={paying.kind === "new" ? newAccount : (paying.accountId ?? "")}
              onChange={(event) =>
                set({
                  payInto:
                    event.target.value === newAccount
                      ? { kind: "new", account: adding ?? emptyAccount(context.today) }
                      : { kind: "existing", accountId: paidInto.find((account) => account.id === event.target.value)?.id ?? null },
                })
              }
            >
              {paying.kind === "existing" && paying.accountId === null && <option value="">{intl.formatMessage({ id: "plan.new.field.choose" })}</option>}
              {paidInto.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
              <option value={newAccount}>{intl.formatMessage({ id: "plan.new.field.paysIntoAdd" })}</option>
            </select>
          )}
        </Field>
      </div>
      {newGroupFields}
      {adding !== null && (
        <div className={styles["body"]}>
          <div className={styles["fields"]}>
            <Field id={id("accountName")} label={intl.formatMessage({ id: "plan.new.account.name" })} problem={textOf("accountName")}>
              {(control) => <input {...control} type="text" autoComplete="off" className={`${controls["field"]} ${styles["input"]}`} value={adding.name} onChange={(event) => setAccount({ name: event.target.value })} />}
            </Field>
            <Field id={id("bank")} label={intl.formatMessage({ id: "plan.new.account.bank" })} problem={null}>
              {(control) => <input {...control} type="text" autoComplete="off" className={`${controls["field"]} ${styles["input"]}`} value={adding.bank} onChange={(event) => setAccount({ bank: event.target.value })} />}
            </Field>
            <Field id={id("balance")} label={intl.formatMessage({ id: "plan.new.account.balance" })} problem={textOf("balance")} help={intl.formatMessage({ id: "plan.new.account.balanceHelp" })}>
              {(control) => (
                <input {...control} type="text" inputMode="decimal" autoComplete="off" className={`${controls["field"]} ${styles["input"]} ${styles["num"]}`} value={adding.balance} onChange={(event) => setAccount({ balance: event.target.value })} />
              )}
            </Field>
            <Field id={id("balanceDate")} label={intl.formatMessage({ id: "plan.new.account.balanceDate" })} problem={textOf("balanceDate")}>
              {(control) => <input {...control} type="date" className={`${controls["field"]} ${styles["input"]}`} value={adding.date} onChange={(event) => setAccount({ date: event.target.value })} />}
            </Field>
          </div>
          <CheckField id={id("import")} label={intl.formatMessage({ id: "plan.new.account.import" })} checked={adding.importStatements} onChange={(importStatements) => setAccount({ importStatements })} />
          {adding.importStatements && (
            <div className={styles["fields"]}>
              <Field id={id("number")} label={intl.formatMessage({ id: "plan.new.account.number" })} problem={textOf("number")} help={intl.formatMessage({ id: "plan.new.account.numberHelp" })}>
                {(control) => <input {...control} type="text" inputMode="numeric" autoComplete="off" className={`${controls["field"]} ${styles["input"]} ${styles["num"]}`} value={adding.number} onChange={(event) => setAccount({ number: event.target.value })} />}
              </Field>
            </div>
          )}
        </div>
      )}
      <p className={styles["help"]}>{intl.formatMessage({ id: "plan.new.payInto.note" })}</p>
    </div>
  );
}
