import type { JobId } from "@holt/core";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import controls from "./Controls.module.css";
import { type PickableJob, groupedJobs, jobAt, moveActive, searchJobs } from "./jobs.ts";
import { Modal } from "./Modal.tsx";
import styles from "./JobPicker.module.css";

export interface JobPickerProps {
  readonly jobs: readonly PickableJob[];
  /** The message ID of the question the picker asks, such as choosing a job or choosing what a refund is against. */
  readonly titleId: string;
  readonly onPick: (jobId: JobId) => void;
  readonly onClose: () => void;
  /** What the choice is for, such as the payee and amount. */
  readonly subject?: string;
  /** The message ID of a line that explains the choice. */
  readonly hintId?: string;
}

/** Choose one job: type to narrow the list, Up and Down to move, Enter to pick, Esc to close. */
export function JobPicker({ jobs, titleId, onPick, onClose, subject, hintId }: JobPickerProps) {
  const intl = useIntl();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const groups = useMemo(() => groupedJobs(searchJobs(jobs, query)), [jobs, query]);
  const count = groups.reduce((sum, group) => sum + group.jobs.length, 0);
  const current = jobAt(groups, active);
  const optionId = (job: PickableJob) => `${listId}-${job.id}`;

  useEffect(() => {
    if (current !== null) document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(moveActive(active, event.key === "ArrowDown" ? 1 : -1, count));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (current !== null) onPick(current.id);
    }
  };

  return (
    <Modal title={intl.formatMessage({ id: titleId })} subject={subject} hint={hintId === undefined ? undefined : intl.formatMessage({ id: hintId })} onClose={onClose}>
      <input
        type="text"
        role="combobox"
        className={`${controls["field"]} ${styles["search"]}`}
        aria-label={intl.formatMessage({ id: "needsYou.job.search" })}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current === null ? undefined : optionId(current)}
        autoComplete="off"
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div id={listId} role="listbox" aria-label={intl.formatMessage({ id: "needsYou.job.list" })} className={styles["list"]}>
        {groups.map((group, groupIndex) => (
          <div key={`${groupIndex}-${group.name}`} role="group" aria-labelledby={`${listId}-g${groupIndex}`} className={styles["group"]}>
            <div id={`${listId}-g${groupIndex}`} className={styles["groupName"]}>
              {group.name}
            </div>
            {group.jobs.map((job) => (
              <div
                key={job.id}
                id={optionId(job)}
                role="option"
                aria-selected={job === current}
                className={styles["option"]}
                onMouseMove={() => setActive(groups.flatMap((g) => g.jobs).indexOf(job))}
                onClick={() => onPick(job.id)}
              >
                {job.name}
              </div>
            ))}
          </div>
        ))}
      </div>
      {count === 0 && <p className={styles["empty"]}>{intl.formatMessage({ id: "needsYou.job.none" })}</p>}
      <div className={styles["foot"]}>
        <span>{intl.formatMessage({ id: "needsYou.job.keys" })}</span>
        <button type="button" className={controls["button"]} onClick={onClose}>
          {intl.formatMessage({ id: "needsYou.cancel" })}
        </button>
      </div>
    </Modal>
  );
}
