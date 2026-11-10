import { CircleCheck, Info } from "lucide-react";
import { useIntl } from "react-intl";
import { ImportBalanceResult } from "./ImportBalanceResult.tsx";
import { type ResultView } from "./ImportResult.model.ts";
import { say } from "./ImportSay.ts";
import kit from "./ImportKit.module.css";
import styles from "./ImportResult.module.css";

export interface ImportResultProps {
  readonly view: ResultView;
  readonly currency: string;
  /** How many transactions the family took back by undoing the import, once they have. */
  readonly undone: number | null;
}

/** What the import did: the counts, each account's balance check, and whether every account is now up to date. */
export function ImportResult({ view, currency, undone }: ImportResultProps) {
  const intl = useIntl();
  if (undone !== null) {
    return (
      <div className={kit.notice}>
        <CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" />
        <p className={kit.noticeBody}>{intl.formatMessage({ id: "import.result.undone" }, { count: undone })}</p>
      </div>
    );
  }
  return (
    <>
      {view.review !== null && (
        <p className={styles.review}>
          {view.review.tone === "good" ? <CircleCheck size={18} strokeWidth={1.75} aria-hidden="true" /> : <Info size={18} strokeWidth={1.75} aria-hidden="true" />}
          {say(intl, currency, view.review.words)}
        </p>
      )}
      <ul className={styles.lines}>
        {view.lines.map((line) => (
          <li key={line.id}>{say(intl, currency, line)}</li>
        ))}
        {view.needsYou > 0 && <li>{intl.formatMessage({ id: "import.result.needsYou" }, { count: view.needsYou })}</li>}
      </ul>
      <section aria-labelledby="import-result-balances">
        <h3 id="import-result-balances" className={kit.sectionTitle}>
          {intl.formatMessage({ id: "import.result.balancesTitle" })}
        </h3>
        <ul className={styles.balances}>
          {view.balances.map(({ accountId, name, view: balance }) => (
            <li key={accountId} className={styles.balance}>
              <span className={kit.strong}>{name}</span>
              <div className={styles.result}>
                <ImportBalanceResult view={balance} currency={currency} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
