import { useId } from "react";
import { useIntl } from "react-intl";
import type { AccountId, ImportPreview } from "@holt/core";
import { balanceView } from "./ImportBalance.model.ts";
import { ImportBalanceResult } from "./ImportBalanceResult.tsx";
import type { BalanceField, BalanceProblem } from "./ImportEntry.model.ts";
import kit from "./ImportKit.module.css";
import styles from "./ImportBalances.module.css";

export interface ImportBalancesProps {
  readonly preview: ImportPreview;
  readonly fields: readonly BalanceField[];
  readonly problems: ReadonlyMap<AccountId, BalanceProblem>;
  readonly accountName: (id: AccountId) => string;
  readonly currency: string;
  readonly today: string;
  /** The preview doesn't yet show what the family typed, so the results are not shown. */
  readonly updating: boolean;
  readonly disabled: boolean;
  readonly onText: (accountId: AccountId, text: string) => void;
  readonly onDate: (accountId: AccountId, asOf: string) => void;
}

const problemIds = {
  amount: "import.balances.problem.amount",
  date: "import.balances.problem.date",
  future: "import.balances.problem.future",
} as const satisfies Record<BalanceProblem, string>;

/** For each account the file touches: the balance the bank shows, and what the app makes of it. Typing is optional. */
export function ImportBalances({ preview, fields, problems, accountName, currency, today, updating, disabled, onText, onDate }: ImportBalancesProps) {
  const intl = useIntl();
  const base = useId();
  return (
    <section className={styles.section} aria-labelledby={`${base}-title`}>
      <h3 id={`${base}-title`} className={kit.sectionTitle}>
        {intl.formatMessage({ id: "import.balances.title" })}
      </h3>
      <p className={styles.intro}>{intl.formatMessage({ id: "import.balances.intro" })}</p>
      <ul className={styles.accounts}>
        {preview.accounts.map((line) => {
          const name = accountName(line.accountId);
          const field = fields.find((candidate) => candidate.accountId === line.accountId);
          const problem = problems.get(line.accountId);
          const view = balanceView(line.balance, name);
          const resultId = `${base}-${line.accountId}-result`;
          return (
            <li key={line.accountId} className={styles.account}>
              <div className={styles.identity}>
                <span className={styles.name}>{name}</span>
                <span className={styles.rows}>{intl.formatMessage({ id: "import.balances.rows" }, { count: line.rows })}</span>
              </div>
              <div className={styles.fields}>
                <label className={`${styles.field} ${styles.amount}`}>
                  {intl.formatMessage({ id: "import.balances.amountLabel" })}
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={field?.text ?? ""}
                    disabled={disabled}
                    aria-label={intl.formatMessage({ id: "import.balances.amountAria" }, { account: name })}
                    aria-invalid={problem === "amount"}
                    aria-describedby={resultId}
                    onChange={(event) => onText(line.accountId, event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  {intl.formatMessage({ id: "import.balances.dateLabel" })}
                  <input
                    type="date"
                    value={field?.asOf ?? ""}
                    max={today}
                    disabled={disabled}
                    aria-label={intl.formatMessage({ id: "import.balances.dateAria" }, { account: name })}
                    aria-invalid={problem === "date" || problem === "future"}
                    aria-describedby={resultId}
                    onChange={(event) => onDate(line.accountId, event.target.value)}
                  />
                </label>
              </div>
              <div id={resultId} className={problem === undefined && !updating && view.status === "differs" ? `${styles.result} ${styles.wide}` : styles.result}>
                {problem !== undefined ? (
                  <span className={styles.problem}>{intl.formatMessage({ id: problemIds[problem] })}</span>
                ) : updating && view.status !== "notChecked" ? (
                  <span className={styles.quiet}>{intl.formatMessage({ id: "import.updating" })}</span>
                ) : (
                  <ImportBalanceResult view={view} currency={currency} compact />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
