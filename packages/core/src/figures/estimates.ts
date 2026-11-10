/**
 * What the figures ask of the estimates (domain model, "Estimate"; rule 12). A spend job's history is
 * every ended month's spending on it, from splits and from history rows, so the months before the plan
 * start inform the estimates without touching any bucket. Each estimate is worked out once per job and
 * month, so the same estimate backs a planned month's projection and the month's expected cost.
 */

import type { Month } from "../dates.ts";
import type { Estimate, EstimateInput } from "../estimate.ts";
import { type SpendJob, overrideSubject } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { type LatestEnteredValues, latestValue } from "./entered-values.ts";
import type { TransactionIndex } from "./transactions.ts";

export type EstimateFunction = (input: EstimateInput) => Estimate;

export type EstimateFor = (job: SpendJob, m: Month) => Estimate;

export function estimatesFor(index: TransactionIndex, latest: LatestEnteredValues, current: Month, estimate: EstimateFunction): EstimateFor {
  const histories = new Map<JobId, ReadonlyMap<Month, Money>>();
  const worked = new Map<string, Estimate>();

  const historyOf = (job: JobId): ReadonlyMap<Month, Money> => {
    const known = histories.get(job);
    if (known !== undefined) return known;
    const sums = new Map<Month, number>();
    for (const source of [index.spent.get(job), index.history.get(job)]) {
      for (const [m, amount] of source ?? []) {
        if (m < current) sums.set(m, (sums.get(m) ?? 0) + amount);
      }
    }
    // The estimates take spending as a positive amount; a month that refunds more than it spends spent nothing.
    const history = new Map(
      [...sums]
        .filter(([, amount]) => amount > 0)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([m, amount]) => [m, money(amount)] as const),
    );
    histories.set(job, history);
    return history;
  };

  return (job, m) => {
    const subject = overrideSubject(job.id, m);
    const known = worked.get(subject);
    if (known !== undefined) return known;
    const override = latestValue(latest, "estimateOverride", subject);
    const input: EstimateInput = {
      month: m,
      history: historyOf(job.id),
      seasonality: job.seasonality,
      ...(override === undefined ? {} : { override: money(override.value) }),
    };
    const result = estimate(input);
    worked.set(subject, result);
    return result;
  };
}
