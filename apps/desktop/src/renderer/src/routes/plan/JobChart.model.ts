/**
 * The job panel's chart, worked out as plain data (decision record 0048; design/design-system/charts.md). The chart
 * answers one question: what will this job cost over the next twelve months, and what does the plan do about it?
 * The page draws what this returns and works out no figure of its own: every bill, plan amount and bucket comes
 * from core's forecast, history and estimate, and this module only places them on a scale.
 *
 * Money stays in minor units. Only the pixel positions are floats, because a position is not an amount.
 */

import type { EstimateMonth, HistoryMonth, JobEstimate, JobForecast, JobHistory, Money, Month } from "@holt/core";
import { money } from "@holt/core";

/** What a column stands for. A spend job's columns are its bills. A save-up job has no bills, so its columns are what the plan puts in. */
export type BarsMean = "bills" | "planned";

/** A month that has ended. A save-up job's column is what was set aside, so it reads `planned`, and a spend job's is `paid`. */
export interface ActualMonth {
  readonly month: Month;
  readonly paid: Money;
  /** Null before the plan start. */
  readonly planned: Money | null;
}

/** A month from this one on. Everything here is expected, never an actual (rule 12). */
export interface AheadMonth {
  readonly month: Month;
  /** What the app expects the bill to be. 0 for a job with no bills. */
  readonly bill: Money;
  readonly planned: Money;
  /** The plan here is the estimate, because the job follows the bills in this month. */
  readonly plannedIsEstimate: boolean;
  /** What the bucket holds at the end of the month, or null when the job keeps no bucket in this view. */
  readonly bucket: Money | null;
}

export interface ChartInput {
  readonly bars: BarsMean;
  readonly actual: readonly ActualMonth[];
  readonly ahead: readonly AheadMonth[];
  /** The dashed line for a plan of the same amount each month, drawn from `from` on. */
  readonly level: { readonly amount: Money; readonly from: Month } | null;
}

/** One column of the chart and one row of its table. */
export interface ChartPoint {
  readonly index: number;
  readonly month: Month;
  /** "actual" for a month that has ended, "estimate" for one still to come. */
  readonly kind: "actual" | "estimate";
  /** The column's height: what was paid, what is expected, or what the plan puts in. */
  readonly value: Money;
  readonly planned: Money | null;
  readonly plannedIsEstimate: boolean;
  readonly bucket: Money | null;
}

export interface Series {
  readonly bars: BarsMean;
  readonly points: readonly ChartPoint[];
  readonly level: ChartInput["level"];
  /** The first point that is still to come, where the "Now" divider stands. */
  readonly nowIndex: number;
  readonly hasBucket: boolean;
}

export function seriesOf(input: ChartInput): Series {
  const before: ChartPoint[] = input.actual.map((m, i) => ({
    index: i,
    month: m.month,
    kind: "actual",
    value: input.bars === "bills" ? m.paid : (m.planned ?? money(0)),
    planned: m.planned,
    plannedIsEstimate: false,
    bucket: null,
  }));
  const after: ChartPoint[] = input.ahead.map((m, i) => ({
    index: before.length + i,
    month: m.month,
    kind: "estimate",
    value: input.bars === "bills" ? m.bill : m.planned,
    planned: m.planned,
    plannedIsEstimate: m.plannedIsEstimate,
    bucket: m.bucket,
  }));
  return { bars: input.bars, points: [...before, ...after], level: input.level, nowIndex: before.length, hasBucket: after.some((p) => p.bucket !== null) };
}

// ── Where the figures come from ────────────────────────────────────────────────

/** The months that have ended, oldest first. The current month is still coming, so it belongs to the months ahead. */
export function actualMonths(history: JobHistory): ActualMonth[] {
  return history.months.filter((m: HistoryMonth) => !m.stillComing).map((m) => ({ month: m.month, paid: m.paid, planned: m.planned }));
}

/** The months ahead from a forecast. `followsBillsUntil` is the month evening out starts: before it the plan is the estimate. */
export function aheadFromForecast(forecast: JobForecast, followsBillsUntil: Month | null): AheadMonth[] {
  return forecast.months.map((m) => ({
    month: m.month,
    bill: m.bill,
    planned: m.planned,
    plannedIsEstimate: followsBillsUntil !== null && m.month < followsBillsUntil,
    bucket: m.bucketEnd,
  }));
}

/** The months ahead from the estimate, with what the plan gives each month and, for a job that keeps its money, the bucket. */
export function aheadFromEstimate(
  estimate: JobEstimate,
  planned: ReadonlyMap<Month, { readonly amount: Money; readonly estimated: boolean }>,
  bucket: ReadonlyMap<Month, Money> | null,
): AheadMonth[] {
  return estimate.months.map((m: EstimateMonth) => {
    const plan = planned.get(m.month);
    return { month: m.month, bill: m.bill, planned: plan?.amount ?? money(0), plannedIsEstimate: plan?.estimated ?? false, bucket: bucket?.get(m.month) ?? null };
  });
}

// ── The scale ──────────────────────────────────────────────────────────────────

export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

/** The space round the plot for the axis labels, the "Now" label, and the month letters. */
export const chartMargin = { left: 38, right: 8, top: 24, bottom: 34 } as const;

export interface Tick {
  /** In whole units of the currency, such as kroner. */
  readonly units: number;
  readonly y: number;
}

export interface Bar {
  readonly index: number;
  readonly month: Month;
  readonly kind: ChartPoint["kind"];
  readonly value: Money;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Dot {
  readonly index: number;
  readonly month: Month;
  readonly amount: Money;
  readonly x: number;
  readonly y: number;
}

export type Side = "start" | "end";

/** A value the chart labels directly: the dearest month and the bucket's lowest point. */
export interface Mark extends Dot {
  /** Which side of the point the label sits on, so it stays inside the plot. */
  readonly side: Side;
  readonly estimated: boolean;
}

export interface Layout {
  readonly size: ChartSize;
  readonly plot: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly slot: number;
  readonly ticks: readonly Tick[];
  readonly zeroY: number;
  readonly bars: readonly Bar[];
  /** The x of the "Now" divider, or null when there is no month before it. */
  readonly now: number | null;
  readonly level: { readonly x1: number; readonly x2: number; readonly y: number; readonly amount: Money; readonly side: Side } | null;
  readonly bucket: readonly Dot[];
  readonly peak: Mark | null;
  readonly lowest: Mark | null;
  /** The centre of each month's slot, for the month letters and the focus marker. */
  readonly centres: readonly number[];
}

/** The smallest 1, 2 or 5 times a power of ten that fits the range in at most `maxTicks` steps. */
export function niceStep(rangeUnits: number, maxTicks = 5): number {
  if (!Number.isFinite(rangeUnits)) return 1;
  for (let power = 1; ; power *= 10) {
    for (const base of [1, 2, 5]) {
      const step = base * power;
      if (Math.ceil(rangeUnits / step) <= maxTicks) return step;
    }
  }
}

const floorTo = (value: number, step: number): number => Math.floor(value / step) * step;
const ceilTo = (value: number, step: number): number => Math.ceil(value / step) * step;

/**
 * Places the series on a plot of `size`. `unit` is how many minor units make one whole unit of the currency, so the axis
 * stops at round numbers such as 1k and 2k. The scale reaches below zero when the bucket does, and never hides a negative.
 */
export function layoutChart(series: Series, size: ChartSize, unit: number): Layout {
  const plot = { left: chartMargin.left, top: chartMargin.top, right: size.width - chartMargin.right, bottom: size.height - chartMargin.bottom };
  const width = plot.right - plot.left;
  const height = plot.bottom - plot.top;
  const count = Math.max(1, series.points.length);
  const slot = width / count;

  const values: number[] = [0, ...(series.level === null ? [] : [series.level.amount])];
  for (const p of series.points) values.push(p.value, ...(p.bucket === null ? [] : [p.bucket]));
  const lowestUnits = Math.floor(Math.min(...values) / unit);
  const highestUnits = Math.ceil(Math.max(...values) / unit);
  const step = niceStep(Math.max(1, highestUnits - lowestUnits));
  const low = floorTo(lowestUnits, step);
  const high = Math.max(ceilTo(highestUnits, step), low + step);

  const y = (amount: number): number => plot.bottom - ((amount / unit - low) / (high - low)) * height;
  const ticks: Tick[] = [];
  for (let units = low; units <= high; units += step) ticks.push({ units, y: y(units * unit) });

  const centres = series.points.map((_, i) => plot.left + slot * i + slot / 2);
  const barWidth = Math.min(14, Math.max(2, slot * 0.62));
  const zeroY = y(0);
  const bars: Bar[] = series.points.map((p, i) => {
    const top = y(Math.max(0, p.value));
    const bottom = zeroY;
    return { index: i, month: p.month, kind: p.kind, value: p.value, x: (centres[i] ?? 0) - barWidth / 2, y: Math.min(top, bottom), width: barWidth, height: Math.abs(bottom - top) };
  });

  const dots: Dot[] = series.points.flatMap((p, i) => (p.bucket === null ? [] : [{ index: i, month: p.month, amount: p.bucket, x: centres[i] ?? 0, y: y(p.bucket) }]));
  const sideOf = (x: number): Side => (x > plot.left + width * 0.62 ? "end" : "start");

  let peak: Mark | null = null;
  for (const bar of bars) {
    const point = series.points[bar.index];
    if (point === undefined || (peak !== null && bar.value <= peak.amount) || bar.value <= 0) continue;
    peak = { index: bar.index, month: bar.month, amount: bar.value, x: bar.x + bar.width / 2, y: bar.y, side: sideOf(bar.x), estimated: point.kind === "estimate" };
  }
  let lowest: Mark | null = null;
  for (const dot of dots) if (lowest === null || dot.amount < lowest.amount) lowest = { ...dot, side: sideOf(dot.x), estimated: true };

  const levelFrom = series.level === null ? -1 : series.points.findIndex((p) => p.month >= (series.level?.from ?? p.month));
  return {
    size,
    plot,
    slot,
    ticks,
    zeroY,
    bars,
    now: series.nowIndex > 0 ? plot.left + slot * series.nowIndex : null,
    level:
      series.level === null || levelFrom < 0
        ? null
        : { x1: plot.left + slot * levelFrom, x2: plot.right, y: y(series.level.amount), amount: series.level.amount, side: "end" },
    bucket: dots,
    peak,
    lowest,
    centres,
  };
}

// ── The table, which is the chart in words ─────────────────────────────────────

export interface TableRow {
  readonly month: Month;
  readonly kind: ChartPoint["kind"];
  /** The bill, or null for a job with no bills. */
  readonly bill: Money | null;
  readonly planned: Money | null;
  readonly plannedIsEstimate: boolean;
  readonly bucket: Money | null;
}

export interface Table {
  /** The months that have ended. */
  readonly before: readonly TableRow[];
  /** The next twelve months. */
  readonly ahead: readonly TableRow[];
  readonly hasBills: boolean;
  readonly hasBucket: boolean;
}

/** Every row is one of the chart's points, in the chart's order, so the table can never say what the chart doesn't. */
export function tableOf(series: Series): Table {
  const row = (p: ChartPoint): TableRow => ({
    month: p.month,
    kind: p.kind,
    bill: series.bars === "bills" ? p.value : null,
    planned: p.planned,
    plannedIsEstimate: p.plannedIsEstimate,
    bucket: p.bucket,
  });
  return {
    before: series.points.filter((p) => p.kind === "actual").map(row),
    ahead: series.points.filter((p) => p.kind === "estimate").map(row),
    hasBills: series.bars === "bills",
    hasBucket: series.hasBucket,
  };
}

// ── Reading one month ──────────────────────────────────────────────────────────

/** What the keyboard reads out for the month the focus marker is on. */
export type Readout =
  | { readonly kind: "paid"; readonly month: Month; readonly paid: Money; readonly planned: Money | null }
  | { readonly kind: "estimate"; readonly month: Month; readonly bill: Money; readonly planned: Money; readonly bucket: Money | null }
  | { readonly kind: "plan"; readonly month: Month; readonly planned: Money; readonly bucket: Money | null; readonly done: boolean };

export function readoutOf(series: Series, index: number): Readout | null {
  const p = series.points[index];
  if (p === undefined) return null;
  if (series.bars === "planned") return { kind: "plan", month: p.month, planned: p.planned ?? p.value, bucket: p.bucket, done: p.kind === "actual" };
  if (p.kind === "actual") return { kind: "paid", month: p.month, paid: p.value, planned: p.planned };
  return { kind: "estimate", month: p.month, bill: p.value, planned: p.planned ?? money(0), bucket: p.bucket };
}

/** The first month the focus marker lands on: this month, the first one still to come. */
export function startingIndex(series: Series): number {
  return Math.min(series.nowIndex, Math.max(0, series.points.length - 1));
}

/** Where the focus marker goes for a key, or null when the key is not the chart's. Left and right stop at the ends. */
export function moveFocus(key: string, current: number | null, series: Series): number | null {
  const last = series.points.length - 1;
  if (last < 0) return null;
  const at = current ?? startingIndex(series);
  switch (key) {
    case "ArrowRight":
      return current === null ? at : Math.min(last, at + 1);
    case "ArrowLeft":
      return current === null ? at : Math.max(0, at - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

// ── The legend and the summary ─────────────────────────────────────────────────

/** Every kind of key the legend can show. Each has its own mark in the legend and in the chart, so no meaning rests on colour. */
export type LegendKey = "paid" | "estimated" | "setAside" | "planned" | "level" | "bucket";

export function legendOf(series: Series): readonly LegendKey[] {
  const hasActual = series.points.some((p) => p.kind === "actual");
  const keys: LegendKey[] = [];
  if (series.bars === "bills") keys.push(...(hasActual ? (["paid"] as const) : []), "estimated");
  else keys.push(...(hasActual ? (["setAside"] as const) : []), "planned");
  if (series.level !== null) keys.push("level");
  if (series.hasBucket) keys.push("bucket");
  return keys;
}

export interface Summary {
  readonly bars: BarsMean;
  readonly months: number;
  readonly peak: { readonly month: Month; readonly amount: Money; readonly estimated: boolean } | null;
  /** The bucket's lowest point and its last month, when the chart has a bucket. */
  readonly bucket: { readonly lowest: { readonly month: Month; readonly amount: Money }; readonly last: { readonly month: Month; readonly amount: Money } } | null;
}

/** What a screen reader hears about the whole chart before it goes month by month. */
export function summaryOf(series: Series, layout: Layout): Summary {
  const dots = layout.bucket;
  const last = dots.at(-1);
  return {
    bars: series.bars,
    months: series.points.filter((p) => p.kind === "estimate").length,
    peak: layout.peak === null ? null : { month: layout.peak.month, amount: layout.peak.amount, estimated: layout.peak.estimated },
    bucket:
      layout.lowest === null || last === undefined
        ? null
        : { lowest: { month: layout.lowest.month, amount: layout.lowest.amount }, last: { month: last.month, amount: last.amount } },
  };
}
