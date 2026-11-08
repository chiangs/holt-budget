import { describe, expect, it } from "vitest";
import { currency, fromMajor, type Money } from "./money.ts";
import { bucketPath, evenedMonthlyAmount, minimumSeed } from "./even-out.ts";

// The Electricity example from the mockups (design/README.md).
// Jan–Oct 2026 actuals, then estimates for Nov 2026–Oct 2027.
const NOK = currency("NOK");
const fromKroner = (kroner: number): Money => fromMajor(kroner, NOK);
const step = fromKroner(50);
const kr = (values: number[]): Money[] => values.map(fromKroner);
const actualJanToOct = kr([4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846]);
const estimateNovToOct = kr([3300, 4200, 4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846]);
const total = (xs: Money[]) => xs.reduce<number>((a, b) => a + b, 0);

describe("the Electricity fixture", () => {
  it("matches the figures in the mockups", () => {
    expect(total(actualJanToOct)).toBe(fromKroner(28_800));
    expect(total(estimateNovToOct)).toBe(fromKroner(36_300));
  });
});

describe("evenedMonthlyAmount", () => {
  it("is the 12-month estimate ÷ 12, rounded up to 50 kr", () => {
    // 36,300 ÷ 12 = 3,025, rounded up to 3,050
    expect(evenedMonthlyAmount(estimateNovToOct, step)).toBe(fromKroner(3_050));
  });

  it("is zero for no months", () => {
    expect(evenedMonthlyAmount([], step)).toBe(0);
  });
});

describe("bucketPath", () => {
  const monthly = fromKroner(3_050);

  it("starting now with 4,100 kr stays above zero, lowest 150 kr in March, 4,400 kr by October", () => {
    const path = bucketPath({ bills: estimateNovToOct, monthly, seed: fromKroner(4_100) });
    const ends = path.map((m) => (m.bucketEnd ?? 0) / 100);
    expect(ends).toEqual([3850, 2700, 1330, 400, 150, 500, 1356, 2536, 3766, 4056, 4196, 4400]);
    expect(Math.min(...ends)).toBe(150);
  });

  it("starting in April follows the bills until then and fills to 4,250 kr by October", () => {
    const path = bucketPath({ bills: estimateNovToOct, monthly, startIndex: 5 });
    expect(path.slice(0, 5).every((m) => m.bucketEnd === null && m.planned === m.bill)).toBe(true);
    expect(path.at(-1)?.bucketEnd).toBe(fromKroner(4_250));
  });
});

describe("minimumSeed", () => {
  it("needs 3,950 kr to start in November without going below zero", () => {
    expect(minimumSeed(estimateNovToOct, fromKroner(3_050), { step })).toBe(fromKroner(3_950));
  });

  it("suggests 4,100 kr with a 150 kr margin", () => {
    expect(minimumSeed(estimateNovToOct, fromKroner(3_050), { step, margin: fromKroner(150) })).toBe(fromKroner(4_100));
  });

  it("needs nothing when evening out starts in April", () => {
    expect(minimumSeed(estimateNovToOct, fromKroner(3_050), { step, startIndex: 5 })).toBe(0);
  });
});
