import { type Month, type Money, month, money } from "@holt/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ActualMonth,
  type AheadMonth,
  type ChartInput,
  type ChartSize,
  chartMargin,
  layoutChart,
  legendOf,
  moveFocus,
  niceStep,
  readoutOf,
  seriesOf,
  startingIndex,
  summaryOf,
  tableOf,
} from "./JobChart.model.ts";

const unit = 100;
const kr = (kroner: number): Money => money(kroner * unit);
const months = (from: number, count: number): Month[] => Array.from({ length: count }, (_, i) => month(`${2026 + Math.floor((from + i) / 12)}-${String(((from + i) % 12) + 1).padStart(2, "0")}`));

/** The mockup's shape: ten ended months, then twelve ahead, with a level line and a bucket that dips in March. */
function electricity(): ChartInput {
  const bills = [4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846];
  const ahead = [3300, 4200, 4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846];
  const bucket = [3850, 2700, 1330, 400, 50, 500, 1356, 2536, 3766, 4056, 4196, 4300];
  return {
    bars: "bills",
    actual: months(0, 10).map((m, i): ActualMonth => ({ month: m, paid: kr(bills[i] ?? 0), planned: kr(2900) })),
    ahead: months(10, 12).map((m, i): AheadMonth => ({ month: m, bill: kr(ahead[i] ?? 0), planned: kr(3050), plannedIsEstimate: false, bucket: kr(bucket[i] ?? 0) })),
    level: { amount: kr(3050), from: months(10, 1)[0] as Month },
  };
}

const size: ChartSize = { width: 360, height: 236 };

describe("the series", () => {
  it("puts the ended months first as actuals and the months ahead as estimates, with the Now divider between them", () => {
    const series = seriesOf(electricity());
    expect(series.points).toHaveLength(22);
    expect(series.points.slice(0, 10).every((p) => p.kind === "actual")).toBe(true);
    expect(series.points.slice(10).every((p) => p.kind === "estimate")).toBe(true);
    expect(series.nowIndex).toBe(10);
    expect(series.points.map((p) => p.index)).toEqual(Array.from({ length: 22 }, (_, i) => i));
  });

  it("gives a spend job's columns its bills, and a save-up job's columns what its plan puts in", () => {
    const bills = seriesOf(electricity());
    expect(bills.points[0]?.value).toBe(kr(4420));
    expect(bills.points[10]?.value).toBe(kr(3300));
    const saving = seriesOf({ ...electricity(), bars: "planned" });
    expect(saving.points[0]?.value).toBe(kr(2900));
    expect(saving.points[10]?.value).toBe(kr(3050));
  });

  it("never gives an ended month a bucket, because the forecast starts now", () => {
    const series = seriesOf(electricity());
    expect(series.points.slice(0, 10).every((p) => p.bucket === null)).toBe(true);
    expect(series.hasBucket).toBe(true);
    expect(seriesOf({ ...electricity(), ahead: electricity().ahead.map((m) => ({ ...m, bucket: null })) }).hasBucket).toBe(false);
  });

  it("has a Now index of zero for a job with no history, and never past the last point", () => {
    const fresh = seriesOf({ ...electricity(), actual: [] });
    expect(fresh.nowIndex).toBe(0);
    expect(layoutChart(fresh, size, unit).now).toBeNull();
    expect(startingIndex(fresh)).toBe(0);
    expect(startingIndex(seriesOf({ bars: "bills", actual: electricity().actual, ahead: [], level: null }))).toBe(9);
  });
});

describe("the scale", () => {
  it("stops the axis at round numbers that reach the highest figure", () => {
    const layout = layoutChart(seriesOf(electricity()), size, unit);
    expect(layout.ticks.map((t) => t.units)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(layout.zeroY).toBe(layout.ticks[0]?.y);
  });

  it("reaches below zero when the bucket does, and the negative month sits under the zero line", () => {
    const input = electricity();
    const low: ChartInput = { ...input, ahead: input.ahead.map((m, i) => (i === 4 ? { ...m, bucket: kr(-375) } : m)) };
    const layout = layoutChart(seriesOf(low), size, unit);
    expect(layout.ticks[0]?.units).toBeLessThan(0);
    const dip = layout.bucket.find((d) => d.amount === kr(-375));
    expect(dip).toBeDefined();
    expect(dip?.y).toBeGreaterThan(layout.zeroY);
    expect(layout.lowest?.amount).toBe(kr(-375));
  });

  it("labels the dearest month and puts the lowest point's label on the minimum, on the month it falls in", () => {
    const layout = layoutChart(seriesOf(electricity()), size, unit);
    expect(layout.peak).toMatchObject({ month: "2026-01", amount: kr(4420), estimated: false });
    expect(layout.lowest).toMatchObject({ month: "2027-03", amount: kr(50), estimated: true });
    const dot = layout.bucket.find((d) => d.month === "2027-03");
    expect(layout.lowest?.x).toBe(dot?.x);
    expect(layout.lowest?.y).toBe(dot?.y);
  });

  it("draws the level line from the month it starts to the right edge", () => {
    const layout = layoutChart(seriesOf(electricity()), size, unit);
    expect(layout.level?.amount).toBe(kr(3050));
    expect(layout.level?.x1).toBe(layout.now);
    expect(layout.level?.x2).toBe(layout.plot.right);
  });

  it("draws no level line when its month is after the last point", () => {
    const input = { ...electricity(), level: { amount: kr(3050), from: month("2099-01") } };
    expect(layoutChart(seriesOf(input), size, unit).level).toBeNull();
  });

  it("finds the smallest round step for a range", () => {
    expect(niceStep(4.4)).toBe(1);
    expect(niceStep(6)).toBe(2);
    expect(niceStep(11)).toBe(5);
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

const amount = fc.integer({ min: 0, max: 60_000 }).map(kr);
const bucketAmount = fc.integer({ min: -20_000, max: 60_000 }).map(kr);

const input = fc
  .record({
    before: fc.integer({ min: 0, max: 12 }),
    after: fc.integer({ min: 1, max: 12 }),
    bars: fc.constantFrom("bills", "planned"),
    withBucket: fc.boolean(),
    withLevel: fc.boolean(),
  })
  .chain(({ before, after, bars, withBucket, withLevel }) =>
    fc.record({
      bars: fc.constant(bars),
      actual: fc.array(fc.record({ paid: amount, planned: fc.option(amount, { nil: null }) }), { minLength: before, maxLength: before }),
      ahead: fc.array(fc.record({ bill: amount, planned: amount, plannedIsEstimate: fc.boolean(), bucket: withBucket ? bucketAmount : fc.constant(null) }), { minLength: after, maxLength: after }),
      level: withLevel ? fc.record({ amount, offset: fc.integer({ min: 0, max: after - 1 }) }) : fc.constant(null),
    }),
  )
  .map((raw): ChartInput => {
    const all = months(0, raw.actual.length + raw.ahead.length);
    return {
      bars: raw.bars,
      actual: raw.actual.map((a, i) => ({ month: all[i] as Month, paid: a.paid, planned: a.planned })),
      ahead: raw.ahead.map((a, i) => ({ ...a, month: all[raw.actual.length + i] as Month })),
      level: raw.level === null ? null : { amount: raw.level.amount, from: all[raw.actual.length + raw.level.offset] as Month },
    };
  });

const sizes = fc.record({ width: fc.integer({ min: 260, max: 900 }), height: fc.integer({ min: 160, max: 320 }) });

describe("the marks, for any series", () => {
  const within = (value: number, low: number, high: number): boolean => value >= low - 0.001 && value <= high + 0.001;

  it("keep every bar, point and line inside the plot area", () => {
    fc.assert(
      fc.property(input, sizes, (data, box) => {
        const layout = layoutChart(seriesOf(data), box, unit);
        const { plot } = layout;
        for (const bar of layout.bars) {
          expect(within(bar.x, plot.left, plot.right) && within(bar.x + bar.width, plot.left, plot.right)).toBe(true);
          expect(within(bar.y, plot.top, plot.bottom) && within(bar.y + bar.height, plot.top, plot.bottom)).toBe(true);
        }
        for (const dot of layout.bucket) expect(within(dot.x, plot.left, plot.right) && within(dot.y, plot.top, plot.bottom)).toBe(true);
        if (layout.level !== null) {
          expect(within(layout.level.y, plot.top, plot.bottom)).toBe(true);
          expect(within(layout.level.x1, plot.left, plot.right) && within(layout.level.x2, plot.left, plot.right)).toBe(true);
        }
        for (const tick of layout.ticks) expect(within(tick.y, plot.top, plot.bottom)).toBe(true);
        expect(within(layout.zeroY, plot.top, plot.bottom)).toBe(true);
        expect(chartMargin.left).toBeLessThan(plot.right);
      }),
    );
  });

  it("stand each bar on the zero line at a height that matches its value", () => {
    fc.assert(
      fc.property(input, sizes, (data, box) => {
        const series = seriesOf(data);
        const layout = layoutChart(series, box, unit);
        const tallest = Math.max(...series.points.map((p) => p.value));
        const bars = layout.bars;
        expect(bars).toHaveLength(series.points.length);
        for (const bar of bars) {
          expect(bar.y + bar.height).toBeCloseTo(layout.zeroY, 3);
          const point = series.points[bar.index];
          expect(point?.value === 0 ? bar.height < 0.001 : bar.height > 0).toBe(true);
          if (tallest > 0 && point !== undefined) expect(bar.height <= (bars.find((b) => series.points[b.index]?.value === tallest)?.height ?? 0) + 0.001).toBe(true);
        }
      }),
    );
  });

  it("put the lowest label on the bucket's minimum, with the first month it reaches it", () => {
    fc.assert(
      fc.property(input, sizes, (data, box) => {
        const series = seriesOf(data);
        const layout = layoutChart(series, box, unit);
        const buckets = series.points.flatMap((p) => (p.bucket === null ? [] : [p]));
        if (buckets.length === 0) {
          expect(layout.lowest).toBeNull();
          return;
        }
        const minimum = Math.min(...buckets.map((p) => p.bucket as number));
        const first = buckets.find((p) => p.bucket === minimum);
        expect(layout.lowest?.amount).toBe(minimum);
        expect(layout.lowest?.month).toBe(first?.month);
        const dot = layout.bucket.find((d) => d.index === first?.index);
        expect(layout.lowest?.y).toBe(dot?.y);
        expect(layout.lowest?.x).toBe(dot?.x);
      }),
    );
  });

  it("mark the dearest bar as the peak", () => {
    fc.assert(
      fc.property(input, sizes, (data, box) => {
        const series = seriesOf(data);
        const layout = layoutChart(series, box, unit);
        const tallest = Math.max(...series.points.map((p) => p.value));
        if (tallest <= 0) expect(layout.peak).toBeNull();
        else expect(layout.peak?.amount).toBe(tallest);
      }),
    );
  });

  it("have a table row for every point, in the chart's order, saying the same figures", () => {
    fc.assert(
      fc.property(input, (data) => {
        const series = seriesOf(data);
        const table = tableOf(series);
        const rows = [...table.before, ...table.ahead];
        expect(rows).toHaveLength(series.points.length);
        rows.forEach((row, i) => {
          const point = series.points[i];
          expect(row.month).toBe(point?.month);
          expect(row.kind).toBe(point?.kind);
          expect(row.planned).toBe(point?.planned);
          expect(row.bucket).toBe(point?.bucket);
          expect(row.plannedIsEstimate).toBe(point?.plannedIsEstimate);
          expect(row.bill).toBe(series.bars === "bills" ? point?.value : null);
        });
        expect(table.hasBucket).toBe(series.hasBucket);
        expect(table.hasBills).toBe(series.bars === "bills");
      }),
    );
  });

  it("read out the same figures as the table, for every month", () => {
    fc.assert(
      fc.property(input, (data) => {
        const series = seriesOf(data);
        series.points.forEach((point, i) => {
          const readout = readoutOf(series, i);
          expect(readout?.month).toBe(point.month);
          if (readout?.kind === "estimate") {
            expect(readout.bill).toBe(point.value);
            expect(readout.planned).toBe(point.planned ?? 0);
            expect(readout.bucket).toBe(point.bucket);
          }
          if (readout?.kind === "paid") expect(readout.paid).toBe(point.value);
        });
        expect(readoutOf(series, series.points.length)).toBeNull();
        expect(readoutOf(series, -1)).toBeNull();
      }),
    );
  });
});

describe("the table", () => {
  it("lists the next twelve months apart from the months that have ended", () => {
    const table = tableOf(seriesOf(electricity()));
    expect(table.before).toHaveLength(10);
    expect(table.ahead).toHaveLength(12);
    expect(table.ahead[0]).toMatchObject({ month: "2026-11", bill: kr(3300), planned: kr(3050), bucket: kr(3850) });
    expect(table.before[0]).toMatchObject({ month: "2026-01", kind: "actual", bill: kr(4420), planned: kr(2900), bucket: null });
  });
});

describe("the keyboard", () => {
  const series = seriesOf(electricity());

  it("starts on this month, the first one still to come", () => {
    expect(moveFocus("ArrowRight", null, series)).toBe(10);
    expect(moveFocus("ArrowLeft", null, series)).toBe(10);
  });

  it("moves one month at a time and stops at both ends", () => {
    expect(moveFocus("ArrowRight", 10, series)).toBe(11);
    expect(moveFocus("ArrowLeft", 10, series)).toBe(9);
    expect(moveFocus("ArrowLeft", 0, series)).toBe(0);
    expect(moveFocus("ArrowRight", 21, series)).toBe(21);
    expect(moveFocus("Home", 10, series)).toBe(0);
    expect(moveFocus("End", 10, series)).toBe(21);
  });

  it("leaves every other key to the page", () => {
    for (const key of ["ArrowUp", "ArrowDown", "j", "k", "Enter", "Escape", "Tab"]) expect(moveFocus(key, 10, series)).toBeNull();
  });

  it("never moves outside the months, whatever the keys", () => {
    fc.assert(
      fc.property(input, fc.array(fc.constantFrom("ArrowLeft", "ArrowRight", "Home", "End", "x"), { maxLength: 40 }), (data, keys) => {
        const s = seriesOf(data);
        let at: number | null = null;
        for (const key of keys) at = moveFocus(key, at, s) ?? at;
        if (at !== null) {
          expect(at).toBeGreaterThanOrEqual(0);
          expect(at).toBeLessThan(s.points.length);
        }
      }),
    );
  });
});

describe("the legend and the summary", () => {
  it("names a key for each kind of mark the chart draws, and only those", () => {
    expect(legendOf(seriesOf(electricity()))).toEqual(["paid", "estimated", "level", "bucket"]);
    expect(legendOf(seriesOf({ ...electricity(), level: null, ahead: electricity().ahead.map((m) => ({ ...m, bucket: null })) }))).toEqual(["paid", "estimated"]);
    expect(legendOf(seriesOf({ ...electricity(), actual: [] }))).toEqual(["estimated", "level", "bucket"]);
    expect(legendOf(seriesOf({ ...electricity(), bars: "planned", level: null }))).toEqual(["setAside", "planned", "bucket"]);
  });

  it("says the dearest month, the bucket's lowest point and where the bucket ends", () => {
    const series = seriesOf(electricity());
    const summary = summaryOf(series, layoutChart(series, size, unit));
    expect(summary.months).toBe(12);
    expect(summary.peak).toEqual({ month: "2026-01", amount: kr(4420), estimated: false });
    expect(summary.bucket).toEqual({ lowest: { month: "2027-03", amount: kr(50) }, last: { month: "2027-10", amount: kr(4300) } });
  });

  it("says nothing about a bucket when the chart has none", () => {
    const series = seriesOf({ ...electricity(), ahead: electricity().ahead.map((m) => ({ ...m, bucket: null })) });
    expect(summaryOf(series, layoutChart(series, size, unit)).bucket).toBeNull();
  });
});
