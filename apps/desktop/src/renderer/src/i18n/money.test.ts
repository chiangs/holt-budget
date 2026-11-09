import { describe, expect, it } from "vitest";
import { formatMoney } from "./money.ts";

const nbsp = " ";

describe("formatMoney", () => {
  it("M4: writes kroner as 'amount kr' in English and in Norwegian", () => {
    expect(formatMoney(6_804_800, "NOK", "en-GB")).toBe(`68,048 kr`);
    expect(formatMoney(6_804_800, "NOK", "nb-NO")).toBe(`68${nbsp}048 kr`);
  });

  it("M5: follows Intl for other currencies", () => {
    expect(formatMoney(6_804_800, "USD", "en-US")).toBe("$68,048");
    expect(formatMoney(6_804_800, "EUR", "en-GB")).toBe("€68,048");
    expect(formatMoney(68_048, "JPY", "en-US")).toBe("¥68,048");
  });

  it("M5: shows decimals only when the amount has them", () => {
    expect(formatMoney(6_804_850, "NOK", "en-GB")).toBe(`68,048.50 kr`);
    expect(formatMoney(5, "NOK", "en-GB")).toBe(`0.05 kr`);
    expect(formatMoney(6_804_805, "USD", "en-US")).toBe("$68,048.05");
  });

  it("M5: handles zero, negative and large amounts", () => {
    expect(formatMoney(0, "NOK", "en-GB")).toBe(`0 kr`);
    expect(formatMoney(-0, "NOK", "en-GB")).toBe(`0 kr`);
    expect(formatMoney(-22_800, "NOK", "en-GB")).toBe(`-228 kr`);
    expect(formatMoney(-22_850, "NOK", "en-GB")).toBe(`-228.50 kr`);
    expect(formatMoney(123_456_789_000, "NOK", "en-GB")).toBe(`1,234,567,890 kr`);
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD", "en-US")).toBe("$90,071,992,547,409.91");
  });

  it("M6: takes minor units and the currency's own digit count", () => {
    expect(formatMoney(6_804_800, "NOK", "en-GB")).toBe(`68,048 kr`);
    expect(formatMoney(68_048_000, "KWD", "en-US")).toBe(`KWD${nbsp}68,048`);
    expect(formatMoney(68_048_001, "KWD", "en-US")).toBe(`KWD${nbsp}68,048.001`);
  });

  it("M6: refuses amounts that are not integers", () => {
    for (const bad of [1.5, 0.1 + 0.2, Number.NaN, Infinity, -Infinity, 2 ** 53]) {
      expect(() => formatMoney(bad, "NOK", "en-GB"), String(bad)).toThrow(RangeError);
    }
  });

  it("refuses a currency code Intl does not know", () => {
    expect(() => formatMoney(100, "kroner", "en-GB")).toThrow();
  });
});
