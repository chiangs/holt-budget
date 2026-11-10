/**
 * The buffer (domain model, "The buffer"; decision record 0046; rule 11). Its target follows the plan:
 * buffer months × the monthly total of active essential spend jobs. The runway counts only the buffer's
 * bucket, so next month's money never reaches it.
 */

import type { Month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { type LatestEnteredValues, latestValue } from "./entered-values.ts";
import type { PlanFigures } from "./months.ts";

const defaultBufferMonths = 3;

/** How long the buffer would last, in tenths of a month so no fraction enters a figure. None when no essential job has money assigned. */
export type Runway = { readonly kind: "tenthsOfAMonth"; readonly tenths: number } | { readonly kind: "noEssentials" };

export type BufferFigures =
  /** The household has no buffer job yet, for example during Setup. */
  | { readonly kind: "noBuffer" }
  | {
      readonly kind: "buffer";
      readonly jobId: JobId;
      /** The buffer's bucket at the end of the current month. */
      readonly balance: Money;
      /** The reference setting "buffer-months", 3 when the family hasn't set it. */
      readonly bufferMonths: number;
      /** The sum of the current month's assigned amounts for active essential spend jobs. */
      readonly essentialMonthly: Money;
      readonly target: Money;
      readonly runway: Runway;
    };

export function bufferFigures(facts: Facts, plan: PlanFigures, current: Month, latest: LatestEnteredValues): BufferFigures {
  const buffers = [...facts.jobs.values()].filter((job) => job.kind === "saveUp" && job.role === "buffer");
  const [buffer, ...others] = buffers;
  if (buffer === undefined) return { kind: "noBuffer" };
  if (others.length > 0) throw new Error(`A household has one buffer, and these facts hold ${buffers.length}`);

  const thisMonth = plan.months.get(current);
  let essential = 0;
  for (const job of facts.jobs.values()) {
    if (job.kind === "spend" && job.status === "active" && job.essential) essential += thisMonth?.jobs.get(job.id)?.assigned.amount ?? 0;
  }

  const bucket = plan.jobs.get(buffer.id)?.bucket;
  const balance = bucket?.kind === "kept" ? bucket.balance : buffer.opening;
  const bufferMonths = latestValue(latest, "reference", "buffer-months")?.value ?? defaultBufferMonths;
  return {
    kind: "buffer",
    jobId: buffer.id,
    balance,
    bufferMonths,
    essentialMonthly: money(essential),
    // A setting such as 4.5 months would make a fraction of a minor unit, so the target rounds up.
    target: money(Math.ceil(bufferMonths * essential)),
    runway: essential > 0 ? { kind: "tenthsOfAMonth", tenths: Math.floor((Math.max(0, balance) * 10) / essential) } : { kind: "noEssentials" },
  };
}
