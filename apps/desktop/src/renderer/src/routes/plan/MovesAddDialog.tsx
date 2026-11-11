import type { AccountId, Currency, FamilyCommand, Facts, Month } from "@holt/core";
import { type FormEvent, useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import { say } from "../transactions/ImportSay.ts";
import { Modal } from "../transactions/Modal.tsx";
import { newMoveId } from "./MoneyIn.ids.ts";
import styles from "./MoneyInDialog.module.css";
import { type MoveForm, addedMoveWords, moveAccounts, moveProblemField, moveProblemWords, planAddMove } from "./Moves.model.ts";

export interface MovesAddDialogProps {
  readonly facts: Facts;
  readonly month: Month;
  readonly currency: Currency;
  readonly busy: boolean;
  /** Why the last attempt didn't happen, when core refused it or the call failed. */
  readonly refusal: string | null;
  /** Runs the command and says `done` once it is saved. True when it was. */
  readonly onSubmit: (command: FamilyCommand, done: string) => Promise<boolean>;
  readonly onClose: () => void;
}

/** A one-off move: money from one account to another this month, for the family to make at the bank. */
export function MovesAddDialog({ facts, month, currency, busy, refusal, onSubmit, onClose }: MovesAddDialogProps) {
  const intl = useIntl();
  const ids = { from: useId(), to: useId(), amount: useId(), reason: useId() };
  const accounts = moveAccounts(facts);
  const [form, setForm] = useState<MoveForm>({ from: null, to: null, amountText: "", reason: "" });
  const [attempted, setAttempted] = useState(false);
  const [newId] = useState(newMoveId);
  const fields = useRef<Partial<Record<"from" | "to" | "amount", HTMLElement | null>>>({});

  const plan = planAddMove(form, { month, currency, accounts: accounts.map((account) => account.accountId), newMoveId: () => newId });
  const problem = plan.kind === "problem" ? plan.problem : null;
  const marked = (field: "from" | "to" | "amount") => attempted && problem !== null && moveProblemField(problem) === field;
  const nameOf = (id: AccountId | null) => accounts.find((account) => account.accountId === id)?.name ?? "";
  const pick = (value: string): AccountId | null => accounts.find((account) => account.accountId === value)?.accountId ?? null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (busy) return;
    if (plan.kind === "problem") {
      fields.current[moveProblemField(plan.problem)]?.focus();
      return;
    }
    const done = say(intl, currency, addedMoveWords(plan, { from: nameOf(form.from), to: nameOf(form.to) }));
    if (await onSubmit(plan.command, done)) onClose();
  };

  const select = (id: string, field: "from" | "to", choose: string) => (
    <select
      id={id}
      ref={(element) => void (fields.current[field] = element)}
      className={`${controls["field"]} ${styles["input"]}`}
      value={form[field] ?? ""}
      aria-invalid={marked(field)}
      onChange={(event) => setForm({ ...form, [field]: pick(event.target.value) })}
    >
      <option value="">{choose}</option>
      {accounts.map((account) => (
        <option key={account.accountId} value={account.accountId}>
          {account.name}
        </option>
      ))}
    </select>
  );
  const choose = intl.formatMessage({ id: "plan.moves.field.choose" });

  return (
    <Modal title={intl.formatMessage({ id: "plan.moves.add.title" })} hint={intl.formatMessage({ id: "plan.moves.add.hint" })} onClose={onClose}>
      <form className={styles["form"]} onSubmit={(event) => void submit(event)} noValidate>
        <div className={styles["row"]}>
          <div className={styles["field"]}>
            <label htmlFor={ids.from} className={styles["label"]}>
              {intl.formatMessage({ id: "plan.moves.field.from" })}
            </label>
            {select(ids.from, "from", choose)}
          </div>
          <div className={styles["field"]}>
            <label htmlFor={ids.to} className={styles["label"]}>
              {intl.formatMessage({ id: "plan.moves.field.to" })}
            </label>
            {select(ids.to, "to", choose)}
          </div>
        </div>

        <div className={styles["field"]}>
          <label htmlFor={ids.amount} className={styles["label"]}>
            {intl.formatMessage({ id: "plan.moves.field.amount" })}
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
            onChange={(event) => setForm({ ...form, amountText: event.target.value })}
          />
        </div>

        <div className={styles["field"]}>
          <label htmlFor={ids.reason} className={styles["label"]}>
            {intl.formatMessage({ id: "plan.moves.field.reason" })}
          </label>
          <input
            id={ids.reason}
            type="text"
            autoComplete="off"
            className={`${controls["field"]} ${styles["input"]}`}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </div>

        <div role="alert">
          {attempted && problem !== null && <p className={styles["problem"]}>{say(intl, currency, moveProblemWords(problem))}</p>}
          {refusal !== null && <p className={styles["problem"]}>{refusal}</p>}
        </div>

        <div className={styles["actions"]}>
          <button type="button" className={controls["button"]} onClick={onClose}>
            {intl.formatMessage({ id: "plan.money.cancel" })}
          </button>
          <button type="submit" className={`${controls["button"]} ${controls["primary"]}`} disabled={busy}>
            {intl.formatMessage({ id: "plan.moves.add.save" })}
          </button>
        </div>
      </form>
    </Modal>
  );
}
