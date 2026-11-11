/**
 * What the job panel shows for a job, worked out from the facts and the figures as plain data: the header, the tiles,
 * the choices a job offers and what the chart draws for each. The page never works out a figure. Every amount here comes
 * from core's history, estimate, forecast, goal and offer, and this module only picks which to show.
 *
 * There is one panel per kind of job, and each switch below names every kind, so a new kind of job fails to compile
 * until the panel says what it shows for it.
 */

import {
  type Assigned,
  type BufferFigures,
  type FamilyCommand,
  type EstimateMethod,
  type EvenOutOffer,
  type Facts,
  type Figures,
  type Goal,
  type Job,
  type JobEstimate,
  type JobForecast,
  type JobHistory,
  type JobId,
  type JobStatus,
  type LocalDate,
  type Money,
  type MonthlyProposal,
  type Month,
  type Runway,
  type SpendJob,
  type SpendPlan,
  apply,
  computeFigures,
  evenOutOffer,
  forecastFromFigures,
  forecastMonths,
  goalsFrom,
  jobEstimate,
  jobHistory,
  money,
} from "@holt/core";
import { type ChartInput, actualMonths, aheadFromEstimate, aheadFromForecast } from "./JobChart.model.ts";

export type PanelKind = "spend" | "saveUp" | "buffer" | "payInto";

/** The panel's kind for a job. The buffer is a save-up job with a fixed role, and its header says so. */
export function panelKindOf(job: Job): PanelKind {
  switch (job.kind) {
    case "spend":
      return "spend";
    case "saveUp":
      return job.role === "buffer" ? "buffer" : "saveUp";
    case "payInto":
      return "payInto";
  }
}

export type ModeKind = SpendPlan["mode"];

/**
 * Whether a spend job's plan can be changed here. A cost that stays the same all year has nothing to even out, and a job
 * that is paused, finished or archived has no plan to change: the app plans nothing for it.
 */
export type Choice = "offered" | "steady" | "inactive";

/** Whether an estimate's method means the cost moves with the seasons. An override or a fixed amount says nothing either way. */
const movesWithTheSeasons: Record<EstimateMethod, boolean> = {
  enteredByYou: false,
  fixed: false,
  plannedItems: false,
  sameMonthLastYear: true,
  nearestMonths: true,
  average: false,
};

/**
 * A job that already follows the bills or is evened out always offers the choice, because the way to the other must stay.
 * A job with a set amount offers it only when its cost varies: the family said so (seasonal or irregular), or the app
 * found a season in the history ("auto", and the estimate used the same month last year or the nearest months). A set
 * amount that matches a steady bill gains nothing from following it, and a bucket would only hold small swings.
 */
export function choiceOf(job: SpendJob, estimate: JobEstimate | null): Choice {
  if (job.status !== "active") return "inactive";
  if (job.plan.mode !== "setAmount") return "offered";
  switch (job.seasonality) {
    case "seasonal":
    case "irregular":
      return "offered";
    case "auto":
      return estimate?.months.some((m) => movesWithTheSeasons[m.estimate.method]) === true ? "offered" : "steady";
  }
}

/** The plans a job can switch between, with the one it has now. A set amount comes back only as the plan the job already has, because returning to it needs a figure. */
export function modesOf(job: SpendJob, choice: Choice): readonly ModeKind[] {
  if (choice !== "offered") return [];
  return job.plan.mode === "setAmount" ? ["setAmount", "followBills", "evenOut"] : ["followBills", "evenOut"];
}

export interface Header {
  readonly group: string;
  readonly kind: PanelKind;
  /** The other party of the job's payments, as the app found it in the imports. Only a spend job has one. */
  readonly payee: string | null;
  /** Where the job's money sits or is paid from. */
  readonly account: string;
  /** The account a pay-into job pays into. */
  readonly into: string | null;
}

/** The latest other party named on a payment to the job, so the header can say "Lyse, paid from Regninger". */
export function payeeOf(facts: Facts, jobId: JobId): string | null {
  let latest: { readonly date: LocalDate; readonly name: string } | null = null;
  for (const t of facts.transactions.values()) {
    if (t.treatment.kind !== "split" || t.counterparty === undefined || t.counterparty === "") continue;
    if (!t.treatment.allocations.some((a) => a.jobId === jobId)) continue;
    if (latest === null || t.bookingDate > latest.date) latest = { date: t.bookingDate, name: t.counterparty };
  }
  return latest?.name ?? null;
}

function headerOf(facts: Facts, job: Job): Header {
  const kind = panelKindOf(job);
  return {
    group: facts.groups.get(job.groupId)?.name ?? "",
    kind,
    payee: kind === "spend" ? payeeOf(facts, job.id) : null,
    account: facts.accounts.get(job.accountId)?.name ?? "",
    into: job.kind === "payInto" ? (facts.accounts.get(job.payInto)?.name ?? null) : null,
  };
}

/** One month of what the plan gives a job, and whether that is the app's estimate (the job follows the bills there). */
export interface PlannedMonth {
  readonly amount: Money;
  readonly estimated: boolean;
}

/** What the plan gives the job in each month from this one on, as the figures have it. */
export function plannedByMonth(figures: Figures, jobId: JobId): ReadonlyMap<Month, PlannedMonth> {
  const planned = new Map<Month, PlannedMonth>();
  for (const [month, jobMonth] of figures.jobs.get(jobId)?.months ?? []) {
    if (month >= figures.current) planned.set(month, { amount: jobMonth.assigned.amount, estimated: jobMonth.assigned.kind === "estimate" });
  }
  return planned;
}

/** The job as it would be after switching to follow the bills, from core's own `apply`. */
export function followCommand(jobId: JobId): FamilyCommand {
  return { kind: "changeJob", jobId, changes: { ofKind: { kind: "spend", plan: { mode: "followBills" } } } };
}

/** What the plan would give each month if the job followed the bills, or null when core refuses the change. */
function plannedIfFollowing(facts: Facts, jobId: JobId, asOf: LocalDate): ReadonlyMap<Month, PlannedMonth> | null {
  const changed = apply(facts, followCommand(jobId), { asOf });
  if (!changed.ok) return null;
  return plannedByMonth(computeFigures(changed.facts, asOf, { horizonMonths: forecastMonths - 1 }), jobId);
}

/** What the family sees for "Planned now": this month's amount, where it comes from, and how long it has been the same. */
export interface PlannedNow {
  readonly month: Month;
  readonly amount: Money;
  readonly source: Assigned["kind"];
  /** The first month of the run of months that gave the same amount, up to now, or null when this month is the only one. */
  readonly sameSince: Month | null;
}

export function plannedNowOf(history: JobHistory, assigned: Assigned | undefined, current: Month): PlannedNow | null {
  if (assigned === undefined) return null;
  let sameSince: Month | null = null;
  for (const m of [...history.months].reverse()) {
    if (m.month === current) continue;
    if (m.planned === null || m.planned !== assigned.amount) break;
    sameSince = m.month;
  }
  return { month: current, amount: assigned.amount, source: assigned.kind, sameSince };
}

interface PanelBase {
  readonly jobId: JobId;
  readonly name: string;
  readonly status: JobStatus;
  readonly header: Header;
  readonly history: JobHistory;
  readonly current: Month;
}

export interface SpendPanelData extends PanelBase {
  readonly kind: "spend";
  readonly job: SpendJob;
  readonly estimate: JobEstimate | null;
  /** The offer to even the job out, or the forecast of one already evened out. Null for a job that is not active. */
  readonly offer: EvenOutOffer | null;
  readonly planned: PlannedNow | null;
  /** The buffer, which a start-now seed would come from, and its name. */
  readonly buffer: BufferFigures;
  readonly bufferName: string | null;
  readonly choice: Choice;
  readonly modes: readonly ModeKind[];
  /** The bucket of the job as its plan stands, for a job that keeps its money. */
  readonly forecast: JobForecast | null;
  /** What the plan gives each month as it stands. */
  readonly plannedNow: ReadonlyMap<Month, PlannedMonth>;
  /** What the plan would give each month if the job followed the bills. Null when it already does, or when core would refuse. */
  readonly plannedFollowing: ReadonlyMap<Month, PlannedMonth> | null;
}

export interface SaveUpPanelData extends PanelBase {
  readonly kind: "saveUp" | "buffer";
  readonly goal: Goal | null;
  readonly forecast: JobForecast | null;
  /** How long the buffer would last. Present only for the buffer. */
  readonly runway: Runway | null;
}

export interface PayIntoPanelData extends PanelBase {
  readonly kind: "payInto";
  readonly monthly: Money;
  /** The latest payment's booking date in each month the job has paid. */
  readonly paidOn: ReadonlyMap<Month, LocalDate>;
}

export type PanelData = SpendPanelData | SaveUpPanelData | PayIntoPanelData;

/** The days the job's payments were booked, by month. */
function paymentDates(facts: Facts, jobId: JobId): ReadonlyMap<Month, LocalDate> {
  const latest = new Map<Month, LocalDate>();
  for (const t of facts.transactions.values()) {
    if (t.treatment.kind !== "split" || !t.treatment.allocations.some((a) => a.jobId === jobId)) continue;
    const month = t.bookingDate.slice(0, 7) as Month;
    const known = latest.get(month);
    if (known === undefined || t.bookingDate > known) latest.set(month, t.bookingDate);
  }
  return latest;
}

/** Everything the panel shows for one job. Null when the job does not exist. */
export function panelOf(facts: Facts, figures: Figures, jobId: JobId, asOf: LocalDate): PanelData | null {
  const job = facts.jobs.get(jobId);
  const history = jobHistory(facts, jobId, asOf);
  if (job === undefined || history === null) return null;
  const base = { jobId, name: job.name, status: job.status, header: headerOf(facts, job), history, current: figures.current };

  switch (job.kind) {
    case "spend": {
      const estimate = jobEstimate(facts, jobId, asOf);
      const offer = evenOutOffer(facts, jobId, asOf);
      const choice = choiceOf(job, estimate);
      return {
        ...base,
        kind: "spend",
        job,
        estimate,
        offer,
        planned: plannedNowOf(history, figures.jobs.get(jobId)?.months.get(figures.current)?.assigned, figures.current),
        buffer: figures.buffer,
        bufferName: figures.buffer.kind === "buffer" ? (facts.jobs.get(figures.buffer.jobId)?.name ?? null) : null,
        choice,
        modes: modesOf(job, choice),
        forecast: offer?.kind === "evenedOut" ? offer.forecast : forecastFromFigures(figures, jobId),
        plannedNow: plannedByMonth(figures, jobId),
        plannedFollowing: choice === "offered" && job.plan.mode !== "followBills" ? plannedIfFollowing(facts, jobId, asOf) : null,
      };
    }
    case "saveUp":
      return {
        ...base,
        kind: job.role === "buffer" ? "buffer" : "saveUp",
        goal: goalsFrom(figures).get(jobId) ?? null,
        forecast: forecastFromFigures(figures, jobId),
        runway: job.role === "buffer" && figures.buffer.kind === "buffer" ? figures.buffer.runway : null,
      };
    case "payInto":
      return { ...base, kind: "payInto", monthly: job.monthly, paidOn: paymentDates(facts, jobId) };
  }
}

// ── What the family has chosen on the panel ────────────────────────────────────

export type StartChoice = "now" | "later";

/** The plan the family is looking at, which is not yet the plan the job has. Nothing is saved until Apply. */
export interface Selection {
  readonly mode: ModeKind;
  readonly start: StartChoice;
  /** For a job already evened out: looking at the higher monthly amount the app proposes. */
  readonly raise: boolean;
}

/** Start now, unless the buffer can't pay the seed and the job can start later instead. */
export function defaultStart(offer: EvenOutOffer | null): StartChoice {
  return offer?.kind === "start" && offer.startNow.blockedBy !== null && offer.startLater !== null ? "later" : "now";
}

export function initialSelection(panel: SpendPanelData): Selection {
  return { mode: panel.job.plan.mode, start: defaultStart(panel.offer), raise: false };
}

/** The start the chart and the explanation use: later only when there is a later to start. */
export function startOf(offer: EvenOutOffer | null, selection: Selection): StartChoice {
  return offer?.kind === "start" && offer.startLater !== null && selection.start === "later" ? "later" : "now";
}

/** The proposal the family is looking at, when the job is evened out, the app has one and the family chose to see it. */
export function raiseOf(offer: EvenOutOffer | null, selection: Selection): MonthlyProposal | null {
  return offer?.kind === "evenedOut" && selection.mode === "evenOut" && selection.raise ? offer.proposal : null;
}

/** The chart for the plan the family is looking at, drawn from core's forecasts before anything is applied. Null when there are no months to draw. */
export function chartInputOf(panel: SpendPanelData, selection: Selection): ChartInput | null {
  const { estimate, offer, job } = panel;
  const actual = actualMonths(panel.history);
  const plan = job.plan;

  if (selection.mode === "evenOut") {
    if (plan.mode === "evenOut" && offer?.kind === "evenedOut") {
      const proposal = raiseOf(offer, selection);
      if (proposal !== null) return { bars: "bills", actual, ahead: aheadFromForecast(proposal.forecast, plan.startMonth), level: { amount: proposal.monthly, from: plan.startMonth } };
      return { bars: "bills", actual, ahead: aheadFromForecast(offer.forecast, plan.startMonth), level: { amount: plan.monthly, from: plan.startMonth } };
    }
    if (offer?.kind === "start") {
      const later = startOf(offer, selection) === "later" ? offer.startLater : null;
      return later === null
        ? { bars: "bills", actual, ahead: aheadFromForecast(offer.startNow.forecast, offer.startMonth), level: { amount: offer.monthly, from: offer.startMonth } }
        : { bars: "bills", actual, ahead: aheadFromForecast(later.forecast, later.startMonth), level: { amount: offer.monthly, from: later.startMonth } };
    }
  }

  if (estimate === null || estimate.months.length === 0) return null;
  if (selection.mode === "followBills") {
    const planned = plan.mode === "followBills" ? panel.plannedNow : (panel.plannedFollowing ?? panel.plannedNow);
    return { bars: "bills", actual, ahead: aheadFromEstimate(estimate, planned, null), level: null };
  }
  const bucket = panel.forecast === null ? null : new Map(panel.forecast.months.map((m) => [m.month, m.bucketEnd] as const));
  return {
    bars: "bills",
    actual,
    ahead: aheadFromEstimate(estimate, panel.plannedNow, bucket),
    level: plan.mode === "setAmount" ? { amount: plan.amount, from: panel.current } : null,
  };
}

/** The chart for a save-up job: what the plan puts in each month as columns, and the bucket as a line. */
export function savingsChartInput(panel: SaveUpPanelData): ChartInput | null {
  if (panel.forecast === null) return null;
  return { bars: "planned", actual: actualMonths(panel.history), ahead: aheadFromForecast(panel.forecast, null).map((m) => ({ ...m, bill: money(0) })), level: null };
}

// ── The tiles ──────────────────────────────────────────────────────────────────

/** The three figures at the top of a spend job's panel. The estimate is always an estimate and never an actual (rule 12). */
export interface SpendTiles {
  /** The months that have ended: what was paid and the average. Null when none has. */
  readonly actual: { readonly from: Month; readonly to: Month; readonly months: number; readonly paid: Money; readonly average: Money } | null;
  /** The next twelve months, as the app estimates them. Null when there is no month to estimate. */
  readonly estimate: { readonly total: Money; readonly monthlyAverage: Money } | null;
  readonly planned: PlannedNow | null;
}

export function spendTilesOf(panel: SpendPanelData): SpendTiles {
  const { ended } = panel.history;
  return {
    actual:
      ended.from === null || ended.to === null || ended.averagePaid === null
        ? null
        : { from: ended.from, to: ended.to, months: ended.months, paid: ended.paid, average: ended.averagePaid },
    estimate: panel.estimate === null || panel.estimate.months.length === 0 ? null : { total: panel.estimate.total.amount, monthlyAverage: panel.estimate.monthlyAverage.amount },
    planned: panel.planned,
  };
}
