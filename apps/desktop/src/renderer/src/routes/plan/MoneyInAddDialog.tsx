import { type Currency, type FamilyCommand, type Facts, type Month, type PersonId, householdOf } from "@holt/core";
import { type FormEvent, useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import { say } from "../transactions/ImportSay.ts";
import { Modal } from "../transactions/Modal.tsx";
import { type AddForm, type Field, addMonthChoices, addedWords, planAdd, problemField, problemWords, startAdd } from "./MoneyInEdit.model.ts";
import { type MoneyInView, adultsOf, sharedAccountsOf } from "./MoneyIn.model.ts";
import { newAgreementId, newPersonId } from "./MoneyIn.ids.ts";
import styles from "./MoneyInDialog.module.css";
import { monthAndYear } from "./PlanFormat.ts";

export interface MoneyInAddDialogProps {
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

/** An adult who pays a fixed amount into a shared account each month: someone already in the household, or a new adult added in the same change. */
export function MoneyInAddDialog({ facts, view, currency, busy, refusal, onSubmit, onClose }: MoneyInAddDialogProps) {
  const intl = useIntl();
  const ids = { amount: useId(), day: useId(), dayHelp: useId(), account: useId(), from: useId(), name: useId(), who: useId() };
  const adults = adultsOf(facts);
  const accounts = sharedAccountsOf(facts);
  const months = addMonthChoices(view.month, householdOf(facts).planStart);
  const [form, setForm] = useState<AddForm>(() =>
    startAdd(
      facts,
      view.month,
      accounts.map((account) => account.accountId),
      adults,
    ),
  );
  const [attempted, setAttempted] = useState(false);
  const [newPerson] = useState(newPersonId);
  const [newAgreement] = useState(newAgreementId);
  const fields = useRef<Partial<Record<Field, HTMLElement | null>>>({});

  const plan = planAdd(form, {
    facts,
    currency,
    accounts: accounts.map((account) => account.accountId),
    months,
    newPersonId: () => newPerson,
    newAgreementId: () => newAgreement,
  });
  const problem = plan.kind === "problem" ? plan.problem : null;
  const marked = (field: Field) => attempted && problem !== null && problemField(problem) === field;
  const change = (next: Partial<AddForm>) => setForm({ ...form, ...next });
  const whoName = (personId: PersonId | undefined) => adults.find((adult) => adult.personId === personId)?.name ?? "";
  const who = form.who;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (busy) return;
    if (plan.kind === "problem") {
      fields.current[problemField(plan.problem)]?.focus();
      return;
    }
    if (await onSubmit(plan.command, say(intl, currency, addedWords(plan)))) onClose();
  };

  return (
    <Modal title={intl.formatMessage({ id: "plan.money.add.title" })} hint={intl.formatMessage({ id: "plan.money.add.hint" })} onClose={onClose}>
      <form className={styles["form"]} onSubmit={(event) => void submit(event)} noValidate>
        <fieldset className={styles["choices"]}>
          <legend className={styles["legend"]}>{intl.formatMessage({ id: "plan.money.add.who" })}</legend>
          {adults.map((adult, index) => (
            <label key={adult.personId} className={styles["choice"]}>
              <input
                type="radio"
                name={ids.who}
                ref={index === 0 ? (element) => void (fields.current.person = element) : undefined}
                checked={who?.kind === "existing" && who.personId === adult.personId}
                aria-invalid={marked("person")}
                onChange={() => change({ who: { kind: "existing", personId: adult.personId } })}
              />
              {adult.name}
            </label>
          ))}
          <label className={styles["choice"]}>
            <input
              type="radio"
              name={ids.who}
              ref={adults.length === 0 ? (element) => void (fields.current.person = element) : undefined}
              checked={who?.kind === "new"}
              aria-invalid={marked("person")}
              onChange={() => change({ who: { kind: "new", name: who?.kind === "new" ? who.name : "" } })}
            />
            {intl.formatMessage({ id: "plan.money.add.new" })}
          </label>
          {who?.kind === "new" && (
            <div className={`${styles["field"]} ${styles["name"]}`}>
              <label htmlFor={ids.name} className={styles["label"]}>
                {intl.formatMessage({ id: "plan.money.add.name" })}
              </label>
              <input
                id={ids.name}
                ref={(element) => void (fields.current.name = element)}
                type="text"
                autoComplete="off"
                className={`${controls["field"]} ${styles["input"]}`}
                value={who.name}
                aria-invalid={marked("name")}
                onChange={(event) => change({ who: { kind: "new", name: event.target.value } })}
              />
            </div>
          )}
        </fieldset>

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
              value={form.amountText}
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
              value={form.dayText}
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
              value={form.accountId ?? ""}
              aria-invalid={marked("account")}
              onChange={(event) => change({ accountId: accounts.find((account) => account.accountId === event.target.value)?.accountId ?? null })}
            >
              {form.accountId === null && <option value="">{intl.formatMessage({ id: "plan.money.field.choose" })}</option>}
              {accounts.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles["field"]}>
            <label htmlFor={ids.from} className={styles["label"]}>
              {intl.formatMessage({ id: "plan.money.add.firstMonth" })}
            </label>
            <select
              id={ids.from}
              ref={(element) => void (fields.current.month = element)}
              className={`${controls["field"]} ${styles["input"]}`}
              value={form.from}
              aria-invalid={marked("month")}
              onChange={(event) => change({ from: event.target.value as Month })}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthAndYear(m, intl.locale)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div role="alert">
          {attempted && problem !== null && <p className={styles["problem"]}>{say(intl, currency, problemWords(problem, whoName(who?.kind === "existing" ? who.personId : undefined)))}</p>}
          {refusal !== null && <p className={styles["problem"]}>{refusal}</p>}
        </div>

        <div className={styles["actions"]}>
          <button type="button" className={controls["button"]} onClick={onClose}>
            {intl.formatMessage({ id: "plan.money.cancel" })}
          </button>
          <button type="submit" className={`${controls["button"]} ${controls["primary"]}`} disabled={busy}>
            {intl.formatMessage({ id: "plan.money.add.save" })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
