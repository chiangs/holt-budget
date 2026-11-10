import { useIntl } from "react-intl";
import { useFigures } from "../../data/ledger.tsx";
import { sidebarBadge } from "./transactions.model.ts";
import styles from "./TransactionsBadge.module.css";

/** The fact beside Transactions in the sidebar: "Due" when an account needs an import, otherwise how many transactions wait. */
export function TransactionsBadge() {
  const intl = useIntl();
  const figures = useFigures();
  const badge = figures === null ? null : sidebarBadge(figures);
  if (badge === null) return null;
  return (
    <span className={styles["badge"]} data-kind={badge.kind}>
      <span aria-hidden="true">{badge.kind === "due" ? intl.formatMessage({ id: "tx.badge.due" }) : intl.formatNumber(badge.count)}</span>
      <span className={styles["hidden"]}>
        {badge.kind === "due" ? intl.formatMessage({ id: "tx.badge.dueSpoken" }) : intl.formatMessage({ id: "tx.badge.countSpoken" }, { count: badge.count })}
      </span>
    </span>
  );
}
