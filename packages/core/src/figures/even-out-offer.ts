/**
 * Starting to even out a variable cost (decision record 0048, "Starting to even out"; the Electricity panel's
 * "When should evening out start?"). The app works out the monthly amount from the next twelve months' bills,
 * then offers two ways to begin, each with the bucket month by month and the commands that would do it:
 *
 * - **Start now**: the smallest seed that keeps the bucket at or above zero with one even-out step to spare,
 *   taken from the buffer when it holds that much.
 * - **Start later**: the earliest month from which evening out needs no seed. Until then the plan follows the bills.
 *
 * An offer changes nothing. The family decides, and only then does the screen run the commands. A job that is
 * already evened out gets its forecast and, when the bucket is heading below zero, a higher monthly amount to consider.
 *
 * Every bucket in an offer is what `jobForecast` gives for the facts after the commands run. An open month keeps
 * what the family assigned until a command says otherwise, so the commands also set the assignments of the months
 * the plan now covers: "November is now 3,050 kr; the extra 150 kr came from the 228 kr with no job".
 */

import type { BatchCommand, Command } from "../commands/apply.ts";
import { type LocalDate, type Month, addMonths, monthOf, monthRange } from "../dates.ts";
import { evenedMonthlyAmount, minimumSeed } from "../even-out.ts";
import { type Facts, type SpendJob, type SpendPlan, householdOf } from "../facts.ts";
import type { AccountId, BucketTransferId, JobId, MoveId } from "../ids.ts";
import { type Money, money, roundUpTo } from "../money.ts";
import { type ForecastRow, type JobForecast, forecastMonths, forecastRows, rollBucket, summarise } from "./forecast.ts";
import { type Runway, computeFigures } from "./index.ts";

/** An open month's assignment that a command changes. */
export interface AssignmentChange {
  readonly month: Month;
  readonly from: Money;
  readonly to: Money;
}

/** Where the seed would come from: the buffer, which holds at least the seed at the end of this month. */
export interface SeedSource {
  readonly jobId: JobId;
  readonly name: string;
  readonly accountId: AccountId;
  readonly holds: Money;
}

/** Why the seed can't be moved yet. The numbers in the offer still hold. */
export type StartNowBlock =
  /** This month has no budget month yet, so there is nowhere to record the move. */
  | "monthNotStarted"
  | "noBuffer"
  | "bufferHoldsLess";

export interface StartNow {
  /** The smallest seed that keeps the bucket one step above zero at its lowest. 0 when the bucket needs none. */
  readonly seed: Money;
  /** The bucket month by month, with the seed in this month's transfers in. */
  readonly forecast: JobForecast;
  readonly assignments: readonly AssignmentChange[];
  /** Where to take the seed from. Null when the seed is 0 or blocked. */
  readonly source: SeedSource | null;
  /** The move at the bank that the transfer needs, when the buffer and the job are in different accounts. */
  readonly bankMove: { readonly from: AccountId; readonly to: AccountId } | null;
  /** The buffer once the seed has left it, with the runway the app works out for it. Present when there is a source. */
  readonly bufferAfter: { readonly balance: Money; readonly runway: Runway } | null;
  readonly blockedBy: StartNowBlock | null;
}

export interface StartLater {
  /** The first month that is evened out. Earlier months follow the bills. */
  readonly startMonth: Month;
  readonly forecast: JobForecast;
  readonly assignments: readonly AssignmentChange[];
  /** The change to the job and to the assignments of the months it covers. It needs no IDs. */
  readonly command: BatchCommand;
}

/** The job follows the bills or has a set amount: the offer to even it out. */
export interface EvenOutStartOffer {
  readonly kind: "start";
  readonly jobId: JobId;
  readonly step: Money;
  /** The next twelve months' bills ÷ 12, rounded up to the step. */
  readonly monthly: Money;
  /** The month evening out starts when it starts now: the current month. */
  readonly startMonth: Month;
  /** The bucket if evening out started now and nothing were moved in. */
  readonly withoutSeed: JobForecast;
  readonly startNow: StartNow;
  /** Null when starting now needs no seed, or when no month in the next twelve gets by without one. */
  readonly startLater: StartLater | null;
}

/** A higher monthly amount for a job that is already evened out and heading below zero. The app never applies it by itself. */
export interface MonthlyProposal {
  readonly monthly: Money;
  readonly forecast: JobForecast;
  readonly assignments: readonly AssignmentChange[];
  readonly command: BatchCommand;
}

export interface EvenedOutOffer {
  readonly kind: "evenedOut";
  readonly jobId: JobId;
  readonly monthly: Money;
  readonly startMonth: Month;
  /** The job's forecast as the plan stands. */
  readonly forecast: JobForecast;
  readonly proposal: MonthlyProposal | null;
}

export type EvenOutOffer = EvenOutStartOffer | EvenedOutOffer;

type EvenOutPlan = Extract<SpendPlan, { readonly mode: "evenOut" }>;

/** The planned amount of each month's row. */
type PlannedOf = (index: number) => Money;

const open = (row: ForecastRow): boolean => row.state === "open" || row.state === "reopened";

function assignmentChanges(rows: readonly ForecastRow[], plannedOf: PlannedOf): AssignmentChange[] {
  return rows.flatMap((row, i) => (open(row) && plannedOf(i) !== row.planned ? [{ month: row.month, from: row.planned, to: plannedOf(i) }] : []));
}

/** The plan with evening out from `startIndex`: the bills before it, the monthly amount from it. A month the family has closed keeps its assignment. */
function plannedFrom(rows: readonly ForecastRow[], monthly: Money, startIndex: number): PlannedOf {
  return (i) => {
    const row = rows[i] as ForecastRow;
    return row.state === "closed" ? row.planned : i < startIndex ? (row.estimate?.amount ?? money(0)) : monthly;
  };
}

function withJob(facts: Facts, job: SpendJob): Facts {
  return { ...facts, jobs: new Map(facts.jobs).set(job.id, job) };
}

function pathOf(jobId: JobId, startsWith: Money, rows: readonly ForecastRow[], plannedOf: PlannedOf, seed: Money): JobForecast {
  const planned = rows.map((row, i) => ({ ...row, planned: plannedOf(i), transfersIn: i === 0 ? money(row.transfersIn + seed) : row.transfersIn }));
  return summarise(jobId, startsWith, rollBucket(startsWith, planned));
}

function evenOutCommands(jobId: JobId, monthly: Money, startMonth: Month, assignments: readonly AssignmentChange[]): Command[] {
  return [
    { kind: "changeJob", jobId, changes: { ofKind: { kind: "spend", plan: { mode: "evenOut", monthly, startMonth } } } },
    ...assignments.map((a): Command => ({ kind: "assign", month: a.month, jobId, amount: a.to })),
  ];
}

function startOffer(facts: Facts, job: SpendJob, asOf: LocalDate, step: Money): EvenOutStartOffer | null {
  const current = monthOf(asOf);
  // Evened out from this month, the job keeps its money, so its bucket counts every month's leftover from the plan start.
  // The amount is only a stand-in: what the figures give for the months ahead is the bills, the state of each month and the bucket at the start.
  const trial: SpendJob = { ...job, keepsMoney: true, plan: { mode: "evenOut", monthly: money(0), startMonth: current } };
  const figures = computeFigures(withJob(facts, trial), asOf, { horizonMonths: forecastMonths - 1 });
  const found = forecastRows(figures, job.id);
  if (found === null) return null;
  const { startsWith, rows } = found;

  const monthly = evenedMonthlyAmount(rows.map((row) => row.bill), step);
  const plannedNow = plannedFrom(rows, monthly, 0);
  // `minimumSeed` takes bills and a monthly amount from an empty bucket. What the bucket takes in and gives out each month, net, is the same
  // thing with a monthly amount of nothing, and the bucket the job already holds comes off the first month.
  const outflows = rows.map((row, i) => money(row.bill - plannedNow(i) - row.transfersIn + row.transfersOut));
  outflows[0] = money((outflows[0] ?? 0) - startsWith);
  const seed = minimumSeed(outflows, money(0), { step, margin: step });

  const buffer = figures.buffer;
  const bufferJob = buffer.kind === "buffer" ? facts.jobs.get(buffer.jobId) : undefined;
  let blockedBy: StartNowBlock | null = null;
  let source: SeedSource | null = null;
  if (seed > 0) {
    if (rows[0]?.state === "planned") blockedBy = "monthNotStarted";
    else if (buffer.kind === "noBuffer" || bufferJob === undefined) blockedBy = "noBuffer";
    else if (buffer.balance < seed) blockedBy = "bufferHoldsLess";
    else source = { jobId: bufferJob.id, name: bufferJob.name, accountId: bufferJob.accountId, holds: buffer.balance };
  }

  let bufferAfter: StartNow["bufferAfter"] = null;
  if (source !== null && buffer.kind === "buffer") {
    // The job's assigned amount this month changes, and the buffer's runway counts essential jobs' assigned amounts.
    const essential = money(buffer.essentialMonthly + (job.essential ? plannedNow(0) - (rows[0] as ForecastRow).planned : 0));
    const balance = money(buffer.balance - seed);
    bufferAfter = {
      balance,
      runway: essential > 0 ? { kind: "tenthsOfAMonth", tenths: Math.floor((Math.max(0, balance) * 10) / essential) } : { kind: "noEssentials" },
    };
  }

  const startNow: StartNow = {
    seed,
    forecast: pathOf(job.id, startsWith, rows, plannedNow, seed),
    assignments: assignmentChanges(rows, plannedNow),
    source,
    bankMove: source !== null && source.accountId !== job.accountId ? { from: source.accountId, to: job.accountId } : null,
    bufferAfter,
    blockedBy,
  };

  let startLater: StartLater | null = null;
  for (let index = 1; seed > 0 && startLater === null && index < rows.length; index++) {
    const plannedAt = plannedFrom(rows, monthly, index);
    const forecast = pathOf(job.id, startsWith, rows, plannedAt, money(0));
    if (forecast.lowest.amount < 0) continue;
    const startMonth = (rows[index] as ForecastRow).month;
    const assignments = assignmentChanges(rows, plannedAt);
    startLater = { startMonth, forecast, assignments, command: { kind: "batch", commands: evenOutCommands(job.id, monthly, startMonth, assignments) } };
  }

  return {
    kind: "start",
    jobId: job.id,
    step,
    monthly,
    startMonth: current,
    withoutSeed: pathOf(job.id, startsWith, rows, plannedNow, money(0)),
    startNow,
    startLater,
  };
}

/** A job that is already evened out: its forecast, and a higher monthly amount when the bucket is heading below zero. */
function evenedOutOffer(facts: Facts, jobId: JobId, plan: EvenOutPlan, asOf: LocalDate, step: Money): EvenedOutOffer | null {
  const figures = computeFigures(facts, asOf, { horizonMonths: forecastMonths - 1 });
  const found = forecastRows(figures, jobId);
  if (found === null) return null;
  const { startsWith, rows } = found;
  const { monthly, startMonth } = plan;
  const forecast = summarise(jobId, startsWith, rollBucket(startsWith, rows));
  const base = { kind: "evenedOut", jobId, monthly, startMonth, forecast } as const;
  if (forecast.runsDryIn === null) return { ...base, proposal: null };

  // A month before this one that the family never opened projects the monthly amount too, so the bucket at the start of this month moves with it.
  const neverOpened = monthRange(startMonth, addMonths(figures.current, -1)).filter((m) => figures.months.get(m)?.state === "planned").length;
  const withoutAmount = money(startsWith - neverOpened * monthly);

  // The months the monthly amount covers keep their assignments out of the sum, and each month's balance then needs a share of the amount
  // that lifts it to zero. The amount that satisfies the worst of them, rounded up to the step, is the smallest that keeps the bucket at or above zero.
  const evened = (row: ForecastRow): boolean => row.state !== "closed" && row.month >= startMonth;
  let balance: number = withoutAmount;
  let covered = neverOpened;
  let needed = 0;
  for (const row of rows) {
    if (evened(row)) covered += 1;
    else balance += row.planned;
    balance += row.transfersIn - row.transfersOut - row.bill;
    if (balance >= 0) continue;
    if (covered === 0) return { ...base, proposal: null };
    needed = Math.max(needed, Math.ceil(-balance / covered));
  }
  const proposed = roundUpTo(money(needed), step);
  if (proposed <= monthly) return { ...base, proposal: null };

  const plannedOf: PlannedOf = (i) => {
    const row = rows[i] as ForecastRow;
    return evened(row) ? proposed : row.planned;
  };
  const assignments = assignmentChanges(rows, plannedOf);
  return {
    ...base,
    proposal: {
      monthly: proposed,
      forecast: pathOf(jobId, money(withoutAmount + neverOpened * proposed), rows, plannedOf, money(0)),
      assignments,
      command: { kind: "batch", commands: evenOutCommands(jobId, proposed, startMonth, assignments) },
    },
  };
}

/**
 * The offer for a variable cost that follows the bills or has a set amount, or the forecast of one that is
 * already evened out. Null for a job that doesn't exist, isn't a spend job, or isn't active.
 */
export function evenOutOffer(facts: Facts, jobId: JobId, asOf: LocalDate): EvenOutOffer | null {
  const job = facts.jobs.get(jobId);
  if (job?.kind !== "spend" || job.status !== "active") return null;
  const step = householdOf(facts).evenOutStep;
  return job.plan.mode === "evenOut" ? evenedOutOffer(facts, job.id, job.plan, asOf, step) : startOffer(facts, job, asOf, step);
}

/** Core makes no IDs, so the caller supplies them. The commands ask in a fixed order: the transfer, then the move at the bank. */
export interface StartNowIds {
  transfer(): BucketTransferId;
  move(): MoveId;
}

export interface StartNowInput {
  readonly ids: StartNowIds;
  /** Why the money moves, in the family's words. The buffer needs one, and the move at the bank carries it too. */
  readonly reason: string;
}

/**
 * The commands that start evening out now as one batch, so one undo undoes all of it: the plan, the assignments of
 * the months it covers, the seed's move between buckets and the move at the bank when the two accounts differ.
 * Null when the offer is blocked, which `startNow.blockedBy` says.
 */
export function startNowCommands(offer: EvenOutStartOffer, { ids, reason }: StartNowInput): BatchCommand | null {
  const { startNow } = offer;
  if (startNow.blockedBy !== null) return null;
  const commands = evenOutCommands(offer.jobId, offer.monthly, offer.startMonth, startNow.assignments);
  const { source, seed, bankMove } = startNow;
  if (source !== null) {
    commands.push({ kind: "moveBucket", transfer: { id: ids.transfer(), month: offer.startMonth, from: source.jobId, to: offer.jobId, amount: seed, reason } });
    if (bankMove !== null) commands.push({ kind: "addMove", move: { id: ids.move(), from: bankMove.from, to: bankMove.to, amount: seed, month: offer.startMonth, reason } });
  }
  return { kind: "batch", commands };
}
