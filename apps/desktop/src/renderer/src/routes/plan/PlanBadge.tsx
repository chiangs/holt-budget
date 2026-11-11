import { useIntl } from "react-intl";
import { useFactsView, useFigures } from "../../data/ledger.tsx";
import { planBadge } from "./PlanMonth.model.ts";
import { moneyText } from "./PlanStatus.ts";
import styles from "./PlanBadge.module.css";
import { householdOf } from "@holt/core";

/** The fact beside Plan in the sidebar: how much has no job yet, or how much is over-assigned. Nothing when every unit has a job. */
export function PlanBadge() {
  const intl = useIntl();
  const view = useFactsView();
  const figures = useFigures();
  if (view === null || figures === null) return null;
  const badge = planBadge(view.facts, figures);
  if (badge === null) return null;
  const amount = moneyText(intl, badge.amount, householdOf(view.facts).currency);
  return (
    <span className={styles["badge"]} data-kind={badge.kind}>
      <span aria-hidden="true">{amount}</span>
      <span className={styles["hidden"]}>{intl.formatMessage({ id: badge.kind === "unassigned" ? "plan.badge.unassigned" : "plan.badge.over" }, { amount })}</span>
    </span>
  );
}
