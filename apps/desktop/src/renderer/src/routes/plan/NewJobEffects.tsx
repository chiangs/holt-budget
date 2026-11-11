import type { Currency } from "@holt/core";
import { useId } from "react";
import { useIntl } from "react-intl";
import styles from "./NewJob.module.css";
import { type PreviewedTiles, changesNothing } from "./NewJobEffects.model.ts";
import { goalText, rateValue, runwayValue, unassignedValue } from "./NewJob.text.ts";
import { monthAndYear } from "./PlanFormat.ts";
import { moneyText } from "./PlanStatus.ts";

export interface NewJobEffectsProps {
  /** Null until there is a job to preview. A refusal shows nothing here: the flow says it beside Add job. */
  readonly previewed: PreviewedTiles | null;
  readonly currency: Currency;
}

/** What the change would do before it is made: the jobs that give money up, the savings rate, the goals that finish later and the buffer's runway. */
export function NewJobEffects({ previewed, currency }: NewJobEffectsProps) {
  const intl = useIntl();
  const titleId = useId();
  if (previewed === null || !previewed.ok) return null;
  const money = (amount: Parameters<typeof moneyText>[1]) => moneyText(intl, amount, currency);
  const change = (before: string, after: string) => intl.formatMessage({ id: "plan.new.effects.change" }, { before, after });

  const { tiles } = previewed;
  const quiet = changesNothing(tiles);
  const tileList: { readonly key: string; readonly label: string; readonly value: string }[] = [
    ...tiles.jobs.map((job) => ({ key: job.jobId, label: job.name, value: intl.formatMessage({ id: "plan.new.effects.jobValue" }, { before: money(job.before), after: money(job.after) }) })),
    ...(tiles.unassigned === null
      ? []
      : [{ key: "unassigned", label: intl.formatMessage({ id: "plan.new.effects.unassigned" }), value: change(unassignedValue(intl, tiles.unassigned.before, currency), unassignedValue(intl, tiles.unassigned.after, currency)) }]),
    ...(tiles.savingsRate === null
      ? []
      : [{ key: "rate", label: intl.formatMessage({ id: "plan.new.effects.rate" }), value: change(rateValue(intl, tiles.savingsRate.before), rateValue(intl, tiles.savingsRate.after)) }]),
    ...(tiles.runway === null ? [] : [{ key: "runway", label: intl.formatMessage({ id: "plan.new.effects.runway" }), value: change(runwayValue(intl, tiles.runway.before), runwayValue(intl, tiles.runway.after)) }]),
  ];

  return (
    <section className={styles["group"]} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles["legend"]}>{intl.formatMessage({ id: "plan.new.effects.title" })}</h3>
      {tileList.length > 0 && (
        <ul className={styles["tiles"]}>
          {tileList.map((tile) => (
            <li key={tile.key} className={styles["tile"]}>
              <span className={styles["tileLabel"]}>{tile.label}</span>
              <span className={styles["tileValue"]}>{tile.value}</span>
            </li>
          ))}
        </ul>
      )}
      {tiles.goals.length > 0 && (
        <ul className={styles["notes"]}>
          {tiles.goals.map((goal) => (
            <li key={goal.jobId}>{goalText(intl, goal)}</li>
          ))}
        </ul>
      )}
      {quiet && <p className={styles["help"]}>{intl.formatMessage({ id: "plan.new.effects.nothing" }, { month: monthAndYear(tiles.month, intl.locale) })}</p>}
      <p className={styles["quiet"]}>{intl.formatMessage({ id: "plan.new.effects.note" })}</p>
    </section>
  );
}
