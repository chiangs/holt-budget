import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./NewJob.module.css";

/** What a control needs to say that it has a problem and where the words are. */
export interface ControlProps {
  readonly id: string;
  readonly "aria-invalid": boolean;
  readonly "aria-describedby": string | undefined;
}

export function Problem({ id, text }: { readonly id: string; readonly text: string }) {
  return (
    <p id={id} className={styles["problem"]}>
      <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

export interface FieldProps {
  readonly id: string;
  readonly label: string;
  /** The words for what is wrong, or null. */
  readonly problem: string | null;
  readonly help?: string;
  /** Marks the control invalid when the words are somewhere else. */
  readonly invalid?: boolean;
  /** The ID of words that are somewhere else. */
  readonly describedBy?: string;
  readonly children: (control: ControlProps) => ReactNode;
}

/** A label, a control, the help under it and the problem with it, joined by the IDs a screen reader follows. */
export function Field({ id, label, problem, help, invalid, describedBy, children }: FieldProps) {
  const described = [help === undefined ? null : `${id}-help`, problem === null ? null : `${id}-problem`, describedBy ?? null].filter((value): value is string => value !== null);
  return (
    <div className={styles["field"]}>
      <label htmlFor={id} className={styles["label"]}>
        {label}
      </label>
      {children({ id, "aria-invalid": invalid ?? problem !== null, "aria-describedby": described.length === 0 ? undefined : described.join(" ") })}
      {help !== undefined && (
        <p id={`${id}-help`} className={styles["help"]}>
          {help}
        </p>
      )}
      {problem !== null && <Problem id={`${id}-problem`} text={problem} />}
    </div>
  );
}

export interface CheckFieldProps {
  readonly id: string;
  readonly label: string;
  readonly help?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function CheckField({ id, label, help, checked, onChange }: CheckFieldProps) {
  return (
    <label className={styles["check"]}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-describedby={help === undefined ? undefined : `${id}-help`} />
      <span className={styles["checkText"]}>
        <span>{label}</span>
        {help !== undefined && (
          <span id={`${id}-help`} className={styles["help"]}>
            {help}
          </span>
        )}
      </span>
    </label>
  );
}
