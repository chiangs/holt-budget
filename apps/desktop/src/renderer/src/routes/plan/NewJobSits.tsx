import { useId } from "react";
import { useIntl } from "react-intl";
import { Problem } from "./NewJobControls.tsx";
import styles from "./NewJob.module.css";
import type { Draft, SitsOptions } from "./NewJob.model.ts";

export interface NewJobSitsProps {
  readonly draft: Draft;
  readonly options: SitsOptions;
  readonly onChange: (next: Draft) => void;
  readonly problem: string | null;
}

/** "Where should the money sit?": as a bucket in the account that holds the buffer, as a bucket in another shared account, or in an account of its own. */
export function NewJobSits({ draft, options, onChange, problem }: NewJobSitsProps) {
  const intl = useIntl();
  const name = useId();
  const problemId = useId();
  const accountId = draft.sits.kind === "account" ? draft.sits.accountId : null;
  const choices = [
    ...(options.preferred === null
      ? []
      : [
          {
            id: options.preferred.accountId,
            label: intl.formatMessage(
              { id: "plan.new.sits.preferred" },
              { account: options.preferred.name, neighbours: options.preferred.neighbours.length, names: intl.formatList(options.preferred.neighbours) },
            ),
          },
        ]),
    ...options.others.map((account) => ({ id: account.id, label: intl.formatMessage({ id: "plan.new.sits.account" }, { account: account.name }) })),
  ];

  return (
    <fieldset className={styles["group"]} aria-describedby={problem === null ? undefined : problemId}>
      <legend className={styles["legend"]}>{intl.formatMessage({ id: "plan.new.sits.legend" })}</legend>
      {choices.map((choice) => (
        <label key={choice.id} className={styles["choice"]}>
          <input type="radio" name={name} checked={accountId === choice.id} onChange={() => onChange({ ...draft, sits: { kind: "account", accountId: choice.id } })} />
          <span>{choice.label}</span>
        </label>
      ))}
      <label className={styles["choice"]}>
        <input type="radio" name={name} checked={draft.sits.kind === "own"} onChange={() => onChange({ ...draft, sits: { kind: "own" } })} />
        <span>{intl.formatMessage({ id: "plan.new.sits.own" })}</span>
      </label>
      {draft.sits.kind === "own" && <p className={styles["help"]}>{intl.formatMessage({ id: "plan.new.sits.ownHelp" }, { name: draft.name.trim() === "" ? "…" : draft.name.trim() })}</p>}
      {problem !== null && <Problem id={problemId} text={problem} />}
    </fieldset>
  );
}
