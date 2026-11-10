import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MoneyError, add, currency, divideUp, fromMajor, money, parseMoney, roundUpTo, subtract } from "./money.ts";

const NOK = currency("NOK");
const JPY = currency("JPY");
const amount = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

describe("rule 1: money is whole minor units", () => {
  it("is refused for anything that isn't a safe integer", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }).filter((x) => !Number.isSafeInteger(x)), (x) => {
        expect(() => money(x)).toThrow(MoneyError);
      }),
    );
  });

  it("stays whole through every operation", () => {
    fc.assert(
      fc.property(amount, amount, fc.integer({ min: 1, max: 10_000 }), fc.integer({ min: 1, max: 100_000 }), (a, b, parts, step) => {
        const results = [add(money(a), money(b)), subtract(money(a), money(b)), roundUpTo(money(a), money(step)), fromMajor(a % 1_000_000, NOK), fromMajor(a % 1_000_000, JPY)];
        for (const r of results) expect(Number.isSafeInteger(r)).toBe(true);
        expect(Number.isSafeInteger(divideUp(money(Math.abs(a)), parts))).toBe(true);
      }),
    );
  });

  it("rounds up to the step without losing a unit and without overshooting a whole step", () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 1, max: 100_000 }), (a, step) => {
        const rounded = roundUpTo(money(a), money(step));
        expect(rounded % step === 0).toBe(true);
        expect(rounded).toBeGreaterThanOrEqual(a);
        expect(rounded - a).toBeLessThan(step);
      }),
    );
  });

  it("splits a total into parts that cover it, with no fraction of a unit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), fc.integer({ min: 1, max: 1000 }), (total, parts) => {
        const each = divideUp(money(total), parts);
        expect(each * parts).toBeGreaterThanOrEqual(total);
        expect(each * parts - total).toBeLessThan(parts);
      }),
    );
  });

  it("reads an amount the bank wrote to the exact minor units, never through a fraction", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.integer({ min: 0, max: 99 }), fc.boolean(), (whole, cents, negative) => {
        const text = `${negative ? "-" : ""}${whole},${String(cents).padStart(2, "0")}`;
        const magnitude = whole * 100 + cents;
        const expected = negative && magnitude !== 0 ? -magnitude : magnitude;
        expect(parseMoney(text, NOK)).toBe(expected);
      }),
    );
  });

  it("never produces negative zero, which differs from zero under Object.is", () => {
    expect(Object.is(money(-0), 0)).toBe(true);
    expect(Object.is(roundUpTo(money(-5), money(50)), 0)).toBe(true);
    expect(Object.is(parseMoney("-0,00", NOK), 0)).toBe(true);
    expect(Object.is(add(money(-3), money(3)), 0)).toBe(true);
  });

  it("refuses an amount with more digits than the currency has", () => {
    expect(() => parseMoney("12,345", NOK)).toThrow(MoneyError);
    expect(() => parseMoney("12,5", JPY)).toThrow(MoneyError);
  });
});
