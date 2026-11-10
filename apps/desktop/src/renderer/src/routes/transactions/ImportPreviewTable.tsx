import { ChevronDown } from "lucide-react";
import { useIntl } from "react-intl";
import { formatDay } from "../../i18n/dates.ts";
import { formatMoney } from "../../i18n/money.ts";
import { type RowView } from "./ImportPreview.model.ts";
import { say } from "./ImportSay.ts";
import { signedAmount } from "./ImportWhy.model.ts";
import kit from "./ImportKit.module.css";
import styles from "./ImportPreviewTable.module.css";

export interface ImportPreviewTableProps {
  readonly rows: readonly RowView[];
  readonly currency: string;
  readonly onPick: (row: RowView) => void;
  /** The family can't change a job while the preview is being added. */
  readonly disabled: boolean;
}

/** The new transactions the app read, each with the job it gives and why. A row that waits asks for a job. */
export function ImportPreviewTable({ rows, currency, onPick, disabled }: ImportPreviewTableProps) {
  const intl = useIntl();
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className={kit.srOnly}>{intl.formatMessage({ id: "import.table.caption" })}</caption>
        <thead>
          <tr>
            <th scope="col">{intl.formatMessage({ id: "import.table.date" })}</th>
            <th scope="col">{intl.formatMessage({ id: "import.table.description" })}</th>
            <th scope="col" className={styles.amountHead}>
              {intl.formatMessage({ id: "import.table.amount" })}
            </th>
            <th scope="col">{intl.formatMessage({ id: "import.table.job" })}</th>
            <th scope="col">{intl.formatMessage({ id: "import.table.why" })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { sign, figure } = signedAmount(row.amount);
            const jobText = row.job.kind === "choose" ? intl.formatMessage({ id: "import.job.choose" }) : row.job.kind === "job" ? row.job.name : say(intl, currency, row.job.words);
            return (
              <tr key={row.line} className={row.needsYou ? styles.waiting : undefined}>
                <td className={styles.date}>{formatDay(row.date, intl.locale)}</td>
                <td className={styles.description}>{row.description}</td>
                <td className={styles.amount}>
                  {sign}
                  {formatMoney(figure, currency, intl.locale)}
                </td>
                <td className={styles.job}>
                  <button
                    type="button"
                    data-job-line={row.line}
                    className={row.needsYou ? `${styles.pick} ${styles.pickWaiting}` : styles.pick}
                    disabled={disabled}
                    aria-label={intl.formatMessage(
                      { id: row.needsYou ? "import.row.choose" : "import.row.change" },
                      { description: row.description, job: jobText },
                    )}
                    onClick={() => onPick(row)}
                  >
                    <span className={styles.pickText}>{jobText}</span>
                    <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </td>
                <td className={styles.why}>{say(intl, currency, row.why)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
