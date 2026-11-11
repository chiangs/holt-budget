import type { AgreementId, Currency, FamilyCommand, Facts, Month } from "@holt/core";
import { type FormEvent, useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import { say } from "../transactions/ImportSay.ts";
import { Modal } from "../transactions/Modal.tsx";
import { decimalSeparator } from "../transactions/rule.model.ts";
import { type EditMode, type EditState, type Field, applyChoices, endChoices, linkedFundsMonths, planEdit, problemField, problemWords, startEdit } from "./MoneyInEdit.model.ts";
import { type MoneyInView, sharedAccountsOf } from "./MoneyIn.model.ts";
import { newAgreementId } from "./MoneyIn.ids.ts";
import styles from "./MoneyInDialog.module.css";
import { monthAndYear } from "./PlanFormat.ts";
import { moneyText } from "./PlanStatus.ts";

export interface MoneyInEditDialogProps {
  readonly facts: Facts;
  readonly view: MoneyInView;
  readonly currency: Currency;
  readonly busy: boolean;
  /** Why the last attempt didn't happen, when core refused it or the call failed. */
  readonly refusal: string | null;
  /** Runs the command and says `done` once it is saved. True when it was. */
  readonly onSubmit: (command: FamilyCommand, done: string) => Promise<boolean>;
  readonly onClose: () => void;
}

/** Change what one person has agreed to pay from a month the family picks, or end it. The months before keep what was agreed then. */
export function MoneyInEditDialog({ facts, view, currency, busy, refusal, onSubmit, onClose }: MoneyInEditDialogProps) {
  const intl = useIntl();
  const separator = decimalSeparator(intl.locale);
  const ids = { who: useId(), amount: useId(), day: useId(), dayHelp: useId(), account: useId(), from: useId(), last: useId(), mode: useId() };
  const accounts = sharedAccountsOf(facts);
  const [agreementId, setAgreementId] = useState(() => view.rows[0]?.agreementId ?? null);
  const agreement = agreementId === null ? undefined : facts.contributionAgreements.get(agreementId);
  const [state, setState] = useState<EditState | null>(() => (agreement === undefined ? null : startEdit(agreement, view.month, currency, separator)));
  const [attempted, setAttempted] = useState(false);
  const [newId] = useState(newAgreementId);
  const fields = useRef<Partial<Record<Field, HTMLElement | null>>>({});

  if (agreement === undefined || state === null) return null;
  const name = facts.people.get(agreement.personId)?.name ?? "";
  const money = (amount: Parameters<typeof moneyText>[1]) => moneyText(intl, amount, currency);
  const monthText = (m: Month) => monthAndYear(m, intl.locale);

  const plan = planEdit(
    state,
    { agreement, current: view.month, currency, accounts: accounts.map((account) => account.accountId), linked: linkedFundsMonths(facts, agreement.id), newAgreementId: () => newId },
    name,
  );
  const problem = plan.kind === "problem" ? plan.problem : null;
  const marked = (field: Field) => attempted && problem !== null && problemField(problem) === field;

  const change = (next: Partial<EditState>) => setState({ ...state, ...next });
  const pick = (id: string) => {
    const picked = facts.contributionAgreements.get(id as AgreementId);
    if (picked === undefined) return;
    setAgreementId(picked.id);
    setState(startEdit(picked, view.month, currency, separator, state.mode));
    setAttempted(false);
  };
  const choose = (mode: EditMode) => {
    change({ mode });
    setAttempted(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (busy) return;
    if (plan.kind === "unchanged") return onClose();
    if (plan.kind === "problem") {
      fields.current[problemField(plan.problem)]?.focus();
      return;
    }
    if (await onSubmit(plan.command, say(intl, currency, plan.done))) onClose();
  };

  const reachable = applyChoices(agreement, view.month);
  const correcting = state.from <= agreement.from;

  return (
    <Modal title={intl.formatMessage({ id: "plan.money.edit.title" })} hint={intl.formatMessage({ id: "plan.money.edit.hint" })} onClose={onClose}>
      <form className={styles["form"]} onSubmit={(event) => void submit(event)} noValidate>
        <div className={styles["field"]}>
          <label htmlFor={ids.who} className={styles["label"]}>
            {intl.formatMessage({ id: "plan.money.edit.who" })}
          </label>
          <select id={ids.who} className={`${controls["field"]} ${styles["input"]}`} value={agreement.id} onChange={(event) => pick(event.target.value)}>
            {view.rows.map((row) => (
              <option key={row.agreementId} value={row.agreementId}>
                {intl.formatMessage({ id: "plan.money.edit.option" }, { name: row.name, amount: money(row.amount) })}
              </option>
            ))}
          </select>
        </div>

        <fieldset className={styles["choices"]}>
          <legend className={styles["legend"]}>{intl.formatMessage({ id: "plan.money.edit.mode" })}</legend>
          {(["change", "end"] as const).map((mode) => (
            <label key={mode} className={styles["choice"]}>
              <input type="radio" name={ids.mode} value={mode} checked={state.mode === mode} onChange={() => choose(mode)} />
              {intl.formatMessage({ id: mode === "change" ? "plan.money.edit.modeChange" : "plan.money.edit.modeEnd" })}
            </label>
          ))}
        </fieldset>

        {state.mode === "change" ? (
          <>
            <div className={styles["row"]}>
              <div className={styles["field"]}>
                <label htmlFor={ids.amount} className={styles["label"]}>
                  {intl.formatMessage({ id: "plan.money.field.amount" })}
                </label>
                <input
                  id={ids.amount}
                  ref={(element) => void (fields.current.amount = element)}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className={`${controls["field"]} ${styles["input"]} ${styles["mono"]}`}
                  value={state.amountText}
                  aria-invalid={marked("amount")}
                  onChange={(event) => change({ amountText: event.target.value })}
                />
              </div>
              <div className={styles["field"]}>
                <label htmlFor={ids.day} className={styles["label"]}>
                  {intl.formatMessage({ id: "plan.money.field.day" })}
                </label>
                <input
                  id={ids.day}
                  ref={(element) => void (fields.current.day = element)}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className={`${controls["field"]} ${styles["input"]} ${styles["mono"]}`}
                  value={state.dayText}
                  aria-invalid={marked("day")}
                  aria-describedby={ids.dayHelp}
                  onChange={(event) => change({ dayText: event.target.value })}
                />
              </div>
            </div>
            <p id={ids.dayHelp} className={styles["help"]}>
              {intl.formatMessage({ id: "plan.money.field.dayHelp" })}
            </p>

            <div className={styles["row"]}>
              <div className={styles["field"]}>
                <label htmlFor={ids.account} className={styles["label"]}>
                  {intl.formatMessage({ id: "plan.money.field.account" })}
                </label>
                <select
                  id={ids.account}
                  ref={(element) => void (fields.current.account = element)}
                  className={`${controls["field"]} ${styles["input"]}`}
                  value={state.accountId ?? ""}
                  aria-invalid={marked("account")}
                  onChange={(event) => change({ accountId: accounts.find((account) => account.accountId === event.target.value)?.accountId ?? null })}
                >
                  {state.accountId === null && <option value="">{intl.formatMessage({ id: "plan.money.field.choose" })}</option>}
                  {accounts.map((account) => (
                    <option key={account.accountId} value={account.accountId}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles["field"]}>
                <label htmlFor={ids.from} className={styles["label"]}>
                  {intl.formatMessage({ id: "plan.money.field.from" })}
                </label>
                <select
                  id={ids.from}
                  ref={(element) => void (fields.current.month = element)}
                  className={`${controls["field"]} ${styles["input"]}`}
                  value={state.from}
                  aria-invalid={marked("month")}
                  onChange={(event) => change({ from: event.target.value as Month })}
                >
                  {reachable.map((m) => (
                    <option key={m} value={m}>
                      {monthText(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {correcting && <p className={styles["help"]}>{intl.formatMessage({ id: "plan.money.edit.correctsHelp" })}</p>}
          </>
        ) : (
          <div className={styles["field"]}>
            <label htmlFor={ids.last} className={styles["label"]}>
              {intl.formatMessage({ id: "plan.money.field.last" })}
            </label>
            <select
              id={ids.last}
              ref={(element) => void (fields.current.month = element)}
              className={`${controls["field"]} ${styles["input"]}`}
              value={state.last}
              aria-invalid={marked("month")}
              aria-describedby={`${ids.last}-help`}
              onChange={(event) => change({ last: event.target.value as Month })}
            >
              {endChoices(agreement, view.month).map((m) => (
                <option key={m} value={m}>
                  {monthText(m)}
                </option>
              ))}
            </select>
            <p id={`${ids.last}-help`} className={styles["help"]}>
              {intl.formatMessage({ id: "plan.money.edit.endHelp" })}
            </p>
          </div>
        )}

        <div role="alert">
          {attempted && problem !== null && <p className={styles["problem"]}>{say(intl, currency, problemWords(problem, name))}</p>}
          {refusal !== null && <p className={styles["problem"]}>{refusal}</p>}
        </div>

        <div className={styles["actions"]}>
          <button type="button" className={controls["button"]} onClick={onClose}>
            {intl.formatMessage({ id: "plan.money.cancel" })}
          </button>
          <button type="submit" className={`${controls["button"]} ${controls["primary"]}`} disabled={busy}>
            {intl.formatMessage({ id: state.mode === "change" ? "plan.money.edit.save" : "plan.money.edit.end" })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
