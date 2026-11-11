import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import controls from "../transactions/Controls.module.css";
import styles from "./PlanTable.module.css";

/** `refused` is core refusing the change or the save failing: the screen says why, and the field keeps what was typed. */
export type SaveOutcome = { readonly kind: "saved" } | { readonly kind: "problem"; readonly text: string } | { readonly kind: "refused" };

export interface AssignEditorProps {
  /** The amount as it starts in the field, such as "14500". */
  readonly initial: string;
  /** What the field is for, already in the family's language: the job it changes. */
  readonly label: string;
  /** A change is being saved, so the field keeps what was typed and takes no more. */
  readonly saving: boolean;
  readonly onSave: (text: string) => Promise<SaveOutcome>;
  readonly onCancel: () => void;
}

/** The assigned amount, typed in place. Enter saves, Esc cancels, and leaving the field cancels too, so nothing changes until the family presses Enter. */
export function AssignEditor({ initial, label, saving, onSave, onCancel }: AssignEditorProps) {
  const problemId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const save = async () => {
    const outcome = await onSave(text);
    if (outcome.kind === "problem") setProblem(outcome.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!saving) void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={styles["editor"]} onClick={(event) => event.stopPropagation()}>
      <input
        ref={field}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`${controls["field"]} ${styles["editorField"]}`}
        aria-label={label}
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : problemId}
        aria-keyshortcuts="Enter Escape"
        value={text}
        readOnly={saving}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!saving && document.hasFocus()) onCancel();
        }}
      />
      <span id={problemId} role="alert" className={styles["editorProblem"]}>
        {problem}
      </span>
    </div>
  );
}
