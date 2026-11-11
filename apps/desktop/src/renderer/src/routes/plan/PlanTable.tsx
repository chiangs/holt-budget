import type { Currency, GroupId, JobId } from "@holt/core";
import { ArrowRightLeft, CircleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useIntl } from "react-intl";
import controls from "../transactions/Controls.module.css";
import { type DecimalSeparator, formatAmountInput } from "../transactions/SplitEditor.model.ts";
import cards from "./Cards.module.css";
import { AssignEditor, type SaveOutcome } from "./AssignEditor.tsx";
import type { PlanMonth } from "./PlanMonth.model.ts";
import { moneyText, needsAttention, statusText } from "./PlanStatus.ts";
import type { PlanGroup, PlanRow } from "./PlanTable.model.ts";
import styles from "./PlanTable.module.css";

export interface PlanTableProps {
  readonly groups: readonly PlanGroup[];
  readonly month: PlanMonth;
  readonly currency: Currency;
  readonly separator: DecimalSeparator;
  readonly selectedId: JobId | null;
  readonly editingId: JobId | null;
  /** A change is being saved. */
  readonly busy: boolean;
  /** The facts under the title: what came in, and how far the spending reaches. */
  readonly summary: readonly string[];
  readonly onOpen: (jobId: JobId) => void;
  readonly onEdit: (jobId: JobId) => void;
  readonly onSaveEdit: (jobId: JobId, text: string) => Promise<SaveOutcome>;
  readonly onCancelEdit: () => void;
  readonly onMove: (jobId: JobId) => void;
  readonly onAddLine: (groupId: GroupId, opener: HTMLElement) => void;
  readonly rowRef: (jobId: JobId, element: HTMLTableRowElement | null) => void;
}

function Status({ row, currency }: { readonly row: PlanRow; readonly currency: Currency }) {
  const intl = useIntl();
  const text = statusText(intl, row.line, currency);
  return (
    <div className={styles["status"]}>
      {row.progress !== null && (
        <div className={styles["bar"]} aria-hidden="true" data-over={row.line.kind === "over"}>
          <span style={{ width: `${row.progress}%` }} />
        </div>
      )}
      {needsAttention(row.line) ? (
        <span className={styles["attention"]}>
          <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
          {text}
        </span>
      ) : (
        <span className={styles["line"]}>{text}</span>
      )}
    </div>
  );
}

/** The jobs table: every group in order with its total, and for each job what it has assigned (typed in place when the month is open), what it spent and where it stands. */
export function PlanTable(props: PlanTableProps) {
  const intl = useIntl();
  const { groups, month, currency, separator, selectedId, editingId, busy } = props;
  const titleId = useId();
  const money = (amount: Parameters<typeof moneyText>[1]) => moneyText(intl, amount, currency);
  const editable = month.access === "editable";

  const assignedCell = (row: PlanRow): ReactNode => {
    if (editingId === row.jobId) {
      return (
        <AssignEditor
          initial={formatAmountInput(row.assigned, currency, separator)}
          label={intl.formatMessage({ id: "plan.row.editLabel" }, { job: row.name })}
          saving={busy}
          onSave={(text) => props.onSaveEdit(row.jobId, text)}
          onCancel={props.onCancelEdit}
        />
      );
    }
    const shown = row.estimated ? intl.formatMessage({ id: "plan.row.estimate" }, { amount: money(row.assigned) }) : money(row.assigned);
    if (!editable) return <span className={styles["readOnly"]}>{shown}</span>;
    return (
      <button
        type="button"
        className={styles["amountButton"]}
        aria-keyshortcuts="E"
        aria-label={intl.formatMessage({ id: "plan.row.change" }, { job: row.name, amount: shown })}
        onClick={(event) => {
          event.stopPropagation();
          props.onEdit(row.jobId);
        }}
      >
        {shown}
      </button>
    );
  };

  return (
    <section className={`${cards["card"]} ${styles["box"]}`} aria-labelledby={titleId}>
      <div className={styles["head"]}>
        <h2 id={titleId} className="type-title-section">
          {intl.formatMessage({ id: "plan.jobs.title" })}
        </h2>
        <ul className={styles["summary"]}>
          {props.summary.map((part) => (
            <li key={part}>{part}</li>
          ))}
        </ul>
      </div>
      <p className={styles["hint"]}>{intl.formatMessage({ id: editable ? "plan.jobs.hint" : "plan.jobs.hintProjection" })}</p>

      <table className={styles["table"]}>
        <thead>
          <tr>
            <th scope="col">{intl.formatMessage({ id: "plan.col.job" })}</th>
            <th scope="col" className={styles["right"]}>
              {intl.formatMessage({ id: "plan.col.assigned" })}
            </th>
            <th scope="col" className={styles["right"]}>
              {intl.formatMessage({ id: "plan.col.spent" })}
            </th>
            <th scope="col">{intl.formatMessage({ id: "plan.col.status" })}</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            <tr className={styles["groupRow"]}>
              <th scope="rowgroup">{group.name}</th>
              <td className={styles["figure"]}>{money(group.assigned)}</td>
              <td className={styles["figure"]}>{money(group.spent)}</td>
              <td />
            </tr>
            {group.rows.map((row) => (
              <tr
                key={row.jobId}
                ref={(element) => props.rowRef(row.jobId, element)}
                className={styles["row"]}
                data-selected={row.jobId === selectedId}
                data-inactive={row.status !== "active"}
                aria-current={row.jobId === selectedId ? "true" : undefined}
                tabIndex={row.jobId === selectedId ? 0 : -1}
                onClick={() => props.onOpen(row.jobId)}
              >
                <th scope="row">
                  <div className={styles["jobCell"]}>
                    <button type="button" className={styles["name"]}>
                      {row.name}
                    </button>
                    {editable && (
                      <button
                        type="button"
                        className={styles["moveButton"]}
                        aria-haspopup="dialog"
                        aria-label={intl.formatMessage({ id: "plan.row.move" }, { job: row.name })}
                        disabled={busy || row.assigned === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onMove(row.jobId);
                        }}
                      >
                        <ArrowRightLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </th>
                <td className={styles["amount"]}>{assignedCell(row)}</td>
                <td className={styles["spent"]} data-spent={row.spent !== null && row.spent !== 0}>
                  {row.spent === null ? (
                    <>
                      <span className={styles["dash"]} aria-hidden="true" />
                      <span className={controls["visuallyHidden"]}>{intl.formatMessage({ id: "plan.row.noSpending" })}</span>
                    </>
                  ) : (
                    money(row.spent)
                  )}
                </td>
                <td className={styles["statusCell"]}>
                  <Status row={row} currency={currency} />
                </td>
              </tr>
            ))}
            <tr className={styles["addRow"]}>
              <td colSpan={4}>
                <button type="button" className={styles["add"]} onClick={(event) => props.onAddLine(group.id, event.currentTarget)}>
                  {intl.formatMessage({ id: "plan.row.addLine" }, { group: group.name })}
                </button>
              </td>
            </tr>
          </tbody>
        ))}
      </table>
    </section>
  );
}
