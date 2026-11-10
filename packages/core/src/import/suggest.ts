/**
 * What the earlier transactions of one counterparty say about a new row of theirs (decision 0047, "same as
 * last time"). Only transactions already in the facts count, so a suggestion never depends on what the
 * family chooses for another row of the same file.
 *
 * Of the transactions the family split to jobs and booked before the row, the latest one decides, unless the
 * last two went to different jobs: then the payee has two plausible jobs, the app suggests neither, and it
 * says which. A changed amount is flagged only when the last two were equal, because a bill that varies
 * every month would otherwise be flagged every month.
 */

import type { TreatmentInput } from "../commands/transactions.ts";
import type { Facts, Transaction } from "../facts.ts";
import type { JobId, TransactionId } from "../ids.ts";
import type { Money } from "../money.ts";
import { counterpartyKey, splitByWeights } from "../rules/resolve.ts";
import { type Precedent, bookedBefore, precedentsByCounterparty } from "../rules/same-as-last-time.ts";

/** The facts of a new transaction that its history is read against. */
export type Probe = Pick<Transaction, "id" | "bookingDate" | "amount" | "counterparty">;

export type Hint =
  /** The treatment of the latest earlier transaction, scaled to the probe's amount. `times` is the unbroken run, latest first, that went to the same jobs. `earlierAmount` is set when the amount changed after at least two equal ones. */
  | { readonly kind: "last"; readonly from: TransactionId; readonly times: number; readonly treatment: TreatmentInput; readonly earlierAmount: Money | null }
  /** The last two went to different jobs. At most 3 jobs, latest first. */
  | { readonly kind: "ambiguous"; readonly jobs: readonly JobId[] }
  /** No other transaction of this counterparty is booked before this one. */
  | { readonly kind: "first" }
  | { readonly kind: "none" };

const none: Hint = { kind: "none" };
const first: Hint = { kind: "first" };
const maxJobsNamed = 3;

interface Run {
  readonly precedent: Precedent;
  readonly jobs: string;
  /** How many precedents up to and including this one went to the same jobs, in an unbroken run. */
  readonly length: number;
}

function runsOf(list: readonly Precedent[]): Run[] {
  const runs: Run[] = [];
  for (const precedent of list) {
    const jobs = [...new Set(precedent.shares.map((s) => s.jobId))].sort().join("|");
    const before = runs[runs.length - 1];
    runs.push({ precedent, jobs, length: before?.jobs === jobs ? before.length + 1 : 1 });
  }
  return runs;
}

function latestJobs(runs: readonly Run[], from: number): JobId[] {
  const jobs: JobId[] = [];
  for (let k = from; k >= 0 && jobs.length < maxJobsNamed; k--) {
    for (const share of runs[k]?.precedent.shares ?? []) if (jobs.length < maxJobsNamed && !jobs.includes(share.jobId)) jobs.push(share.jobId);
  }
  return jobs;
}

/** `existing` is the facts' transactions, and `fresh` the transactions the import is about to add. */
export function historyHints(existing: Facts["transactions"], fresh: readonly Probe[]): (probe: Probe) => Hint {
  const precedents = precedentsByCounterparty(existing.values());
  const earliest = new Map<string, Probe>();
  const note = (t: Probe): void => {
    if (t.counterparty === undefined) return;
    const key = counterpartyKey(t.counterparty);
    const before = earliest.get(key);
    if (before === undefined || bookedBefore(t, before)) earliest.set(key, t);
  };
  for (const t of existing.values()) note(t);
  for (const t of fresh) note(t);

  const runsByKey = new Map<string, readonly Run[]>();
  const runsFor = (key: string): readonly Run[] => {
    let runs = runsByKey.get(key);
    if (runs === undefined) {
      runs = runsOf(precedents.get(key) ?? []);
      runsByKey.set(key, runs);
    }
    return runs;
  };

  return (probe) => {
    if (probe.counterparty === undefined) return none;
    const key = counterpartyKey(probe.counterparty);
    const runs = runsFor(key);
    const at = runs.findLastIndex((r) => bookedBefore(r.precedent.transaction, probe));
    const latest = runs[at];
    if (latest === undefined) return earliest.get(key)?.id === probe.id ? first : none;
    if (latest.length === 1 && at > 0) return { kind: "ambiguous", jobs: latestJobs(runs, at) };
    const { transaction, shares } = latest.precedent;
    const previous = runs[at - 1];
    const wasFixed = previous?.precedent.transaction.amount === transaction.amount;
    return {
      kind: "last",
      from: transaction.id,
      times: latest.length,
      treatment: { kind: "split", allocations: splitByWeights(probe.amount, shares) },
      earlierAmount: wasFixed && probe.amount !== transaction.amount ? transaction.amount : null,
    };
  };
}
