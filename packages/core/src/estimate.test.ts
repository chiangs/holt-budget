import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addMonths, month, type Month } from "./dates.ts";
import { estimate, isSeasonal, type EstimateInput } from "./estimate.ts";
import { money, type Money } from "./money.ts";

const kr = (whole: number): Money => money(whole * 100);

function historyFrom(start: string, amounts: readonly number[]): Map<Month, Money> {
  return new Map(amounts.map((a, i) => [addMonths(month(start), i), money(a)]));
}

// Electricity, invented sample data from design/README.md and the Plan mockup (kroner, Jan to Oct 2026).
const electricityKroner = [4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846];
const electricity = historyFrom("2026-01", electricityKroner.map((k) => k * 100));
const mockupEstimate = [3300, 4200, 4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846];

const input = (over: Partial<EstimateInput> & Pick<EstimateInput, "month">): EstimateInput => ({
  history: electricity,
  seasonality: "seasonal",
  ...over,
});

describe("the Electricity fixtures", () => {
  it("actuals sum to 28,800 kr", () => {
    expect([...electricity.values()].reduce((a, b) => a + b, 0)).toBe(kr(28_800));
  });

  it("reproduces the mockup's twelve months, November 2026 to October 2027", () => {
    const months = Array.from({ length: 12 }, (_, i) => addMonths(month("2026-11"), i));
    const amounts = months.map((m) => estimate(input({ month: m })).amount);
    expect(amounts).toEqual(mockupEstimate.map(kr));
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(kr(36_300));
  });

  it("marks only November and December as rough, with the nearest months", () => {
    const nov = estimate(input({ month: month("2026-11") }));
    const dec = estimate(input({ month: month("2026-12") }));
    const jan = estimate(input({ month: month("2027-01") }));
    expect([nov.method, nov.rough, nov.amount]).toEqual(["nearestMonths", true, kr(3300)]);
    expect([dec.method, dec.rough, dec.amount]).toEqual(["nearestMonths", true, kr(4200)]);
    expect([jan.method, jan.rough]).toEqual(["sameMonthLastYear", false]);
  });
});

describe("method precedence", () => {
  const base = input({ month: month("2026-11") });

  it("uses the override first", () => {
    const e = estimate({ ...base, override: kr(10), fixedAmount: kr(20), plannedItems: [kr(30)] });
    expect(e).toEqual({ month: base.month, amount: kr(10), method: "enteredByYou", rough: false });
  });

  it("uses the fixed amount before planned items", () => {
    expect(estimate({ ...base, fixedAmount: kr(20), plannedItems: [kr(30)] })).toMatchObject({ amount: kr(20), method: "fixed" });
  });

  it("sums planned items, and an empty list is zero", () => {
    expect(estimate({ ...base, plannedItems: [kr(30), kr(12)] })).toMatchObject({ amount: kr(42), method: "plannedItems" });
    expect(estimate({ ...base, plannedItems: [] })).toMatchObject({ amount: 0, method: "plannedItems" });
  });

  it("gives 0, average and rough for no history", () => {
    expect(estimate({ month: base.month, history: new Map(), seasonality: "seasonal" })).toEqual({
      month: base.month,
      amount: 0,
      method: "average",
      rough: true,
    });
  });
});

describe("seasonal with a year of history", () => {
  // Aug to Oct 2025 at 1,000 kr; Nov 2025 at 2,000 kr; Aug to Oct 2026 at the given figures.
  const build = (now: [number, number, number]) => {
    const h = historyFrom("2025-08", [1000, 1000, 1000, 2000, 0, 0, 0, 0, 0, 0, 0, 0, ...now]);
    for (const m of ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]) h.set(month(m), money(1500));
    return h;
  };

  it("scales last November by the trend", () => {
    const h = build([1500, 1500, 1500]);
    expect(estimate({ month: month("2026-11"), history: h, seasonality: "seasonal" })).toMatchObject({
      amount: 3000,
      method: "sameMonthLastYear",
      rough: false,
    });
  });

  it("rounds half up when applying the trend", () => {
    const h = historyFrom("2025-08", [1000, 1000, 1000, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 1000, 1000, 1001]);
    expect(estimate({ month: month("2026-11"), history: h, seasonality: "seasonal" }).amount).toBe(1501);
  });

  it("uses the plain same month when the trend months are missing", () => {
    const h = historyFrom("2025-11", [777, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(estimate({ month: month("2026-11"), history: h, seasonality: "seasonal" }).amount).toBe(777);
  });

  it("does not overflow on very large amounts", () => {
    const big = 4_000_000_000_000_000;
    const h = historyFrom("2025-08", [1, 1, 1, big, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2]);
    expect(estimate({ month: month("2026-11"), history: h, seasonality: "seasonal" }).amount).toBe(2 * big);
  });
});

describe("nearest months, for any month", () => {
  // Peak in July (index 6): a hot-climate cooling cost. Data Apr to Sep.
  const summer = historyFrom("2026-04", [200, 300, 500, 900, 400, 250]);
  const at = (m: string) => estimate({ month: month(m), history: summer, seasonality: "seasonal" });

  it("mirrors the month across the peak", () => {
    expect(at("2026-10")).toMatchObject({ amount: 200, method: "nearestMonths", rough: true }); // three after July mirrors April
  });

  it("averages the peak and its mirror next to the peak", () => {
    const h = historyFrom("2026-02", [900, 400, 100]); // peak February
    expect(estimate({ month: month("2027-01"), history: h, seasonality: "seasonal" }).amount).toBe(650); // January: March and February
  });

  it("falls back to the calendar months closest to the mirror when it has no data", () => {
    // History Jan to Mar only; peak Jan. October mirrors April, which is missing. March (3) is closest.
    const h = historyFrom("2026-01", [900, 500, 300]);
    expect(estimate({ month: month("2026-10"), history: h, seasonality: "seasonal" }).amount).toBe(300);
  });
});

describe("irregular", () => {
  it("averages the last six months only", () => {
    const h = historyFrom("2026-01", [9000, 9000, 100, 200, 300, 400, 500, 600]);
    expect(estimate({ month: month("2026-09"), history: h, seasonality: "irregular" })).toEqual({
      month: month("2026-09"),
      amount: 350,
      method: "average",
      rough: false,
    });
  });

  it("rounds half up and is rough with fewer than three months", () => {
    const h = historyFrom("2026-01", [1, 2]);
    expect(estimate({ month: month("2026-03"), history: h, seasonality: "irregular" })).toMatchObject({ amount: 2, rough: true });
  });
});

describe("isSeasonal", () => {
  const year = (low: number, high: number) => historyFrom("2025-11", [high, ...Array<number>(10).fill(low), low + 1]);

  it("obeys the family's choice", () => {
    expect(isSeasonal(new Map(), "seasonal")).toBe(true);
    expect(isSeasonal(year(100, 1000), "irregular")).toBe(false);
  });

  it("auto needs twelve months and a 1.3 spread", () => {
    expect(isSeasonal(year(1000, 1300), "auto")).toBe(true);
    expect(isSeasonal(year(1000, 1299), "auto")).toBe(false);
    expect(isSeasonal(historyFrom("2026-01", [100, 5000, 100]), "auto")).toBe(false);
  });

  it("treats an all-zero year as not seasonal", () => {
    expect(isSeasonal(historyFrom("2025-11", Array<number>(12).fill(0)), "auto")).toBe(false);
  });
});

describe("estimate properties", () => {
  const historyArb = fc
    .array(fc.tuple(fc.integer({ min: 0, max: 35 }), fc.integer({ min: 0, max: 100_000_000 })), { maxLength: 36 })
    .map((pairs) => new Map(pairs.map(([i, a]) => [addMonths(month("2024-01"), i), money(a)] as const)));
  const seasonalityArb = fc.constantFrom("auto", "seasonal", "irregular" as const);
  const monthArb = fc.integer({ min: 0, max: 60 }).map((i) => addMonths(month("2024-01"), i));

  it("is a whole number of minor units and never negative for non-negative history", () => {
    fc.assert(
      fc.property(historyArb, seasonalityArb, monthArb, (history, seasonality, m) => {
        const { amount } = estimate({ month: m, history, seasonality });
        expect(Number.isSafeInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("always lets an override win", () => {
    fc.assert(
      fc.property(historyArb, seasonalityArb, monthArb, fc.integer({ min: -1000, max: 1000 }), (history, seasonality, m, o) => {
        const e = estimate({ month: m, history, seasonality, override: money(o), fixedAmount: kr(5), plannedItems: [kr(7)] });
        expect(e).toEqual({ month: m, amount: o, method: "enteredByYou", rough: false });
      }),
    );
  });

  it("keeps the method of an override, a fixed amount or planned items however much history there is", () => {
    const supplied = fc.constantFrom<Partial<EstimateInput>>(
      { override: kr(1) },
      { fixedAmount: kr(2) },
      { plannedItems: [kr(3)] },
    );
    fc.assert(
      fc.property(historyArb, historyArb, seasonalityArb, monthArb, supplied, (a, b, seasonality, m, extra) => {
        const more = new Map([...a, ...b]);
        const before = estimate({ month: m, history: a, seasonality, ...extra });
        const after = estimate({ month: m, history: more, seasonality, ...extra });
        expect(after).toEqual(before);
      }),
    );
  });

  it("returns a flat history's amount for any month and seasonality", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 36 }),
        seasonalityArb,
        monthArb,
        (flat, length, seasonality, m) => {
          const history = historyFrom("2024-01", Array<number>(length).fill(flat));
          expect(estimate({ month: m, history, seasonality }).amount).toBe(flat);
        },
      ),
    );
  });
});
