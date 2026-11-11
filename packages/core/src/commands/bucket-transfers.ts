/**
 * Moving money from one bucket to another (decision 0048). A transfer is a fact: the buckets change by the
 * amount, and nothing else does. It is neither spending nor income, so unassigned money and every balance
 * stay as they were. Between jobs in different accounts the buckets then exceed the receiving account's
 * balance until the family makes the move at the bank, which the screen records in the same change.
 */

import { type LocalDate, type Month, monthOf, monthsBetween } from "../dates.ts";
import type { BucketTransfer, Facts } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import { keepsMoney } from "../figures/jobs.ts";
import type { JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import type { Fault } from "./check-facts.ts";
import { isBuffer } from "./jobs.ts";
import { patched, refuse } from "./refusal.ts";

export type BucketTransferCommand = { readonly kind: "moveBucket"; readonly transfer: BucketTransfer };

/** Everything wrong with a transfer that the facts alone show, the first being the one the family hears about. `checkFacts` flags the same list. */
export function transferFaults(facts: Facts, transfer: BucketTransfer): Fault[] {
  const faults: Fault[] = [];
  const from = facts.jobs.get(transfer.from);
  const to = facts.jobs.get(transfer.to);
  if (from === undefined) faults.push({ violation: "missingReference", refusal: "jobNotFound", field: "from" });
  if (to === undefined) faults.push({ violation: "missingReference", refusal: "jobNotFound", field: "to" });
  if (transfer.from === transfer.to) faults.push({ violation: "transferSameJob", refusal: "sameJob", field: "to" });
  if (transfer.amount <= 0) faults.push({ violation: "transferAmountNotPositive", refusal: "amountNotPositive", field: "amount" });
  if (!facts.budgetMonths.has(transfer.month)) faults.push({ violation: "transferMonthNotStarted", refusal: "transferMonthNotStarted", field: "month" });
  if (from !== undefined && !keepsMoney(from)) faults.push({ violation: "transferJobKeepsNoMoney", refusal: "bucketNotKept", field: "from" });
  if (to !== undefined && !keepsMoney(to)) faults.push({ violation: "transferJobKeepsNoMoney", refusal: "bucketNotKept", field: "to" });
  if (from !== undefined && isBuffer(from) && transfer.reason.trim() === "") faults.push({ violation: "transferOutOfBufferNeedsReason", refusal: "bufferMoveNeedsReason", field: "reason" });
  return faults;
}

/** What the job's bucket holds at the end of the month, with every transfer the facts already hold. */
function bucketEnd(facts: Facts, job: JobId, m: Month, asOf: LocalDate): Money {
  const figures = computeFigures(facts, asOf, { horizonMonths: Math.max(0, monthsBetween(monthOf(asOf), m)) });
  const held = figures.jobs.get(job)?.months.get(m)?.money;
  return held?.kind === "bucket" || held?.kind === "short" ? held.end : money(0);
}

export const bucketTransferHandlers: Handlers<BucketTransferCommand> = {
  moveBucket(facts, { transfer }, { asOf }) {
    if (facts.bucketTransfers.has(transfer.id)) return refuse("idTaken");
    const [fault] = transferFaults(facts, transfer);
    if (fault !== undefined) return refuse(fault.refusal);
    if (transfer.amount > bucketEnd(facts, transfer.from, transfer.month, asOf)) return refuse("bucketHoldsLess");
    return patched(editFacts(facts).put("bucketTransfers", transfer));
  },
};
