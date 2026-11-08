import { describe, expect, it } from "vitest";
import { MoneyError, add, divideUp, formatKroner, fromKroner, ore, parseKroner, roundUpTo } from "./money.ts";

describe("ore", () => {
  it("accepts whole numbers only", () => {
    expect(ore(123)).toBe(123);
    expect(() => ore(1.5)).toThrow(MoneyError);
  });
});

describe("parseKroner", () => {
  it("reads Norwegian-style amounts", () => {
    expect(parseKroner("1 234,56")).toBe(123_456);
    expect(parseKroner("-2 846,00")).toBe(-284_600);
    expect(parseKroner("+28 000")).toBe(2_800_000);
    expect(parseKroner("−449")).toBe(-44_900);
    expect(parseKroner("1.234,5")).toBe(123_450);
  });

  it("reads dot-decimal amounts when the format profile says so", () => {
    expect(parseKroner("1,234.56", ".")).toBe(123_456);
  });

  it("rejects anything that isn't an amount", () => {
    expect(() => parseKroner("12,345,6")).toThrow(MoneyError);
    expect(() => parseKroner("abc")).toThrow(MoneyError);
  });
});

describe("arithmetic", () => {
  it("adds and rounds without drift", () => {
    expect(add(ore(10), ore(20), ore(-5))).toBe(25);
    expect(roundUpTo(fromKroner(3_025), fromKroner(50))).toBe(fromKroner(3_050));
    expect(divideUp(ore(100), 3)).toBe(34);
  });
});

describe("formatKroner", () => {
  it("formats as the interface shows money", () => {
    expect(formatKroner(fromKroner(68_048))).toBe("68,048 kr");
    expect(formatKroner(fromKroner(-449))).toBe("−449 kr");
    expect(formatKroner(ore(123_456))).toBe("1,234.56 kr");
  });
});
