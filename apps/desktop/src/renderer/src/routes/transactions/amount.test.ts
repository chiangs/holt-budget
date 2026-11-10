import { describe, expect, it } from "vitest";
import { amountText } from "./amount.ts";

describe("amountText", () => {
  it("shows money out with a minus sign and money in with a plus", () => {
    expect(amountText(-284_600, "NOK", "en-GB")).toBe("−2,846 kr");
    expect(amountText(2_800_000, "NOK", "en-GB")).toBe("+28,000 kr");
    expect(amountText(0, "NOK", "en-GB")).toBe("0 kr");
  });

  it("keeps the øre when they matter, and follows the language", () => {
    expect(amountText(-120_050, "NOK", "en-GB")).toBe("−1,200.50 kr");
    expect(amountText(-120_050, "NOK", "nb-NO")).toMatch(/^[−-]1\s200,50 kr$/u);
  });
});
