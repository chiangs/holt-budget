import { describe, expect, it } from "vitest";
import { MoneyError, add, currency, divideUp, fromMajor, minorUnitDigits, money, parseMoney, roundUpTo } from "./money.ts";

const NOK = currency("NOK");
const USD = currency("USD");
const JPY = currency("JPY");
const KWD = currency("KWD");

describe("money", () => {
  it("accepts whole numbers only", () => {
    expect(money(123)).toBe(123);
    expect(() => money(1.5)).toThrow(MoneyError);
  });
});

describe("currency", () => {
  it("accepts ISO 4217 codes the runtime knows", () => {
    expect(currency("NOK")).toBe("NOK");
    expect(currency("EUR")).toBe("EUR");
  });

  it("rejects anything else", () => {
    expect(() => currency("nok")).toThrow(MoneyError);
    expect(() => currency("KRONER")).toThrow(MoneyError);
    expect(() => currency("ZZZ")).toThrow(MoneyError);
    expect(() => currency("")).toThrow(MoneyError);
  });

  it("knows how many minor-unit digits each currency has", () => {
    expect(minorUnitDigits(NOK)).toBe(2);
    expect(minorUnitDigits(USD)).toBe(2);
    expect(minorUnitDigits(JPY)).toBe(0);
    expect(minorUnitDigits(KWD)).toBe(3);
  });
});

describe("fromMajor", () => {
  it("scales by the currency's minor units", () => {
    expect(fromMajor(50, NOK)).toBe(5_000);
    expect(fromMajor(50, JPY)).toBe(50);
    expect(fromMajor(50, KWD)).toBe(50_000);
  });

  it("refuses fractions", () => {
    expect(() => fromMajor(1.5, NOK)).toThrow(MoneyError);
  });
});

describe("parseMoney", () => {
  it("reads Norwegian-style amounts", () => {
    expect(parseMoney("1 234,56", NOK)).toBe(123_456);
    expect(parseMoney("-2 846,00", NOK)).toBe(-284_600);
    expect(parseMoney("+28 000", NOK)).toBe(2_800_000);
    expect(parseMoney("−449", NOK)).toBe(-44_900);
    expect(parseMoney("1.234,5", NOK)).toBe(123_450);
  });

  it("reads dot-decimal amounts when the format profile says so", () => {
    expect(parseMoney("1,234.56", USD, ".")).toBe(123_456);
    expect(parseMoney("12,345", NOK, ".")).toBe(1_234_500); // the comma is then a thousands mark
  });

  it("ignores non-breaking and narrow spaces between digit groups", () => {
    expect(parseMoney("1 234,56", NOK)).toBe(123_456);
    expect(parseMoney("1 234,56", NOK)).toBe(123_456);
  });

  it("follows the currency's minor units", () => {
    expect(parseMoney("1 234", JPY)).toBe(1_234);
    expect(parseMoney("1,234", JPY, ".")).toBe(1_234);
    expect(parseMoney("1.234,567", KWD)).toBe(1_234_567);
    expect(parseMoney("1.5", KWD, ".")).toBe(1_500);
  });

  it("rejects anything that isn't an amount in that currency", () => {
    expect(() => parseMoney("12,345,6", NOK)).toThrow(MoneyError);
    expect(() => parseMoney("abc", NOK)).toThrow(MoneyError);
    expect(() => parseMoney("12,345", NOK)).toThrow(MoneyError); // three decimals is not a krone amount
    expect(() => parseMoney("12,5", JPY)).toThrow(MoneyError);
    expect(() => parseMoney("1,234.567", USD, ".")).toThrow(MoneyError);
  });
});

describe("arithmetic", () => {
  it("adds and rounds without drift", () => {
    expect(add(money(10), money(20), money(-5))).toBe(25);
    expect(roundUpTo(fromMajor(3_025, NOK), fromMajor(50, NOK))).toBe(fromMajor(3_050, NOK));
    expect(divideUp(money(100), 3)).toBe(34);
  });

  it("refuses to divide a negative total, where rounding up would no longer cover it", () => {
    expect(() => divideUp(money(-100), 3)).toThrow(MoneyError);
  });
});
