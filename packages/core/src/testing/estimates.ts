/**
 * Stand-in estimate methods for tests and the benchmark, so the figures can be tested apart from the
 * real method in `estimate.ts`. Each honours an override, as the real one does.
 */

import type { Month } from "../dates.ts";
import type { Estimate, EstimateInput } from "../estimate.ts";
import { type Money, money } from "../money.ts";

function entered(input: EstimateInput): Estimate | undefined {
  return input.override === undefined ? undefined : { month: input.month, amount: input.override, method: "enteredByYou", rough: false };
}

/** The average of the job's history, rounded down; nothing when there is no history. Rough with fewer than three months. */
export function averageEstimate(input: EstimateInput): Estimate {
  const override = entered(input);
  if (override !== undefined) return override;
  let sum = 0;
  for (const amount of input.history.values()) sum += amount;
  const count = input.history.size;
  return { month: input.month, amount: money(count === 0 ? 0 : Math.floor(sum / count)), method: "average", rough: count < 3 };
}

/** The amount listed for the month, or `otherwise`. */
export function estimateByMonth(amounts: ReadonlyMap<Month, Money>, otherwise: Money = money(0)): (input: EstimateInput) => Estimate {
  return (input) => entered(input) ?? { month: input.month, amount: amounts.get(input.month) ?? otherwise, method: "nearestMonths", rough: true };
}
