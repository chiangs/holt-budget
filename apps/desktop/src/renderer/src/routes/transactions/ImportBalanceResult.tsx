import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { useIntl } from "react-intl";
import type { BalanceView } from "./ImportBalance.model.ts";
import { say } from "./ImportSay.ts";
import styles from "./ImportBalanceResult.module.css";

/** How a balance check came out: it matches, it differs and why it may, or it was not checked. The icon and the words each say it, so colour never has to. `compact` leaves out the explanation of an unchecked account, which the screen says once. */
export function ImportBalanceResult({ view, currency, compact = false }: { readonly view: BalanceView; readonly currency: string; readonly compact?: boolean }) {
  const intl = useIntl();
  if (view.status === "matches") {
    return (
      <span className={styles.good}>
        <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
        {say(intl, currency, view.result)}
      </span>
    );
  }
  if (view.status === "differs") {
    return (
      <>
        <span className={styles.flag}>
          <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
          {say(intl, currency, view.result)}
        </span>
        <ul className={styles.causes}>
          {view.causes.map((cause) => (
            <li key={`${cause.id}${JSON.stringify(cause.values ?? {})}`}>{say(intl, currency, cause)}</li>
          ))}
        </ul>
        {view.note !== null && <span className={styles.quiet}>{say(intl, currency, view.note)}</span>}
      </>
    );
  }
  return (
    <>
      <span className={`${styles.good} ${styles.quiet}`}>
        <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" />
        {say(intl, currency, view.result)}
      </span>
      {!compact && view.note !== null && <span className={styles.quiet}>{say(intl, currency, view.note)}</span>}
    </>
  );
}
