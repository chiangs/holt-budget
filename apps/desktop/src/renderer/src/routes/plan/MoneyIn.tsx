import { type Facts, type Figures, householdOf } from "@holt/core";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { useFactsView, useFigures, useLedgerStatus } from "../../data/ledger.tsx";
import { useDecisions } from "../transactions/decisions.ts";
import { Feedback, useUndoKeys } from "./MoneyInFeedback.tsx";
import { moneyInView } from "./MoneyIn.model.ts";
import styles from "./MoneyIn.module.css";
import cards from "./Cards.module.css";
import { MoneyInPanel } from "./MoneyInPanel.tsx";
import { MovesPanel } from "./MovesPanel.tsx";
import { movesView } from "./Moves.model.ts";
import { planMonthOf } from "./PlanMonth.model.ts";

type Panel = "money" | "moves";

function Panels({ facts, figures }: { readonly facts: Facts; readonly figures: Figures }) {
  // One set of decisions for both panels, so what the last change did and its Undo are in one place and never go stale.
  const decisions = useDecisions();
  const [origin, setOrigin] = useState<Panel>("money");
  const [dialogs, setDialogs] = useState<ReadonlySet<Panel>>(() => new Set());
  const { currency } = householdOf(facts);
  const shown = useMemo(() => planMonthOf(facts, figures), [facts, figures]);
  const money = useMemo(() => moneyInView(facts, figures), [facts, figures]);
  const moves = useMemo(() => (shown === null ? null : movesView(facts, figures, shown.month)), [facts, figures, shown]);
  useUndoKeys(decisions);

  if (money === null || moves === null) return null;

  const submit = (from: Panel) => (command: Parameters<typeof decisions.decide>[0], done: string) => {
    setOrigin(from);
    return decisions.decide(command, done);
  };
  const dialog = (panel: Panel) => (open: boolean) =>
    setDialogs((previous) => {
      const next = new Set(previous);
      if (open) next.add(panel);
      else next.delete(panel);
      return next;
    });
  const feedback = (panel: Panel) => <Feedback decisions={decisions} dialogOpen={dialogs.size > 0} active={origin === panel} />;

  return (
    <>
      <MoneyInPanel facts={facts} view={money} currency={currency} busy={decisions.busy} message={decisions.message} onSubmit={submit("money")} feedback={feedback("money")} onDialog={dialog("money")} />
      <MovesPanel facts={facts} view={moves} currency={currency} busy={decisions.busy} message={decisions.message} onSubmit={submit("moves")} feedback={feedback("moves")} onDialog={dialog("moves")} />
    </>
  );
}

function Skeleton() {
  const intl = useIntl();
  return (
    <section className={cards["card"]} role="status" aria-busy="true" aria-label={intl.formatMessage({ id: "plan.money.loading" })}>
      <div className={styles["skeleton"]}>
        <div className={styles["block"]} style={{ width: "8rem" }} />
        <div className={styles["blockWide"]} />
      </div>
    </section>
  );
}

/** Who pays into the household and whether it arrived, and the moves to make at the bank this month. */
export function MoneyIn() {
  const status = useLedgerStatus();
  const view = useFactsView();
  const figures = useFigures();
  if (status.kind === "loading") return <Skeleton />;
  if (status.kind !== "ready" || view === null || figures === null) return null;
  return <Panels facts={view.facts} figures={figures} />;
}
