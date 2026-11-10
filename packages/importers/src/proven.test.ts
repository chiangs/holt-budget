import { describe, expect, it } from "vitest";
import { formats } from "./index.ts";
import { isUnprovenFormat, unprovenFormats } from "./proven.ts";

describe("which formats are unproven", () => {
  it("the page's list is exactly the formats that say they have not read a real file", () => {
    expect([...unprovenFormats].sort()).toEqual(formats.filter((format) => !format.proven).map((format) => format.id).sort());
  });

  it("OFX is unproven and the two banks' CSV formats are proven", () => {
    expect(isUnprovenFormat("ofx")).toBe(true);
    expect(isUnprovenFormat("bulder-csv")).toBe(false);
    expect(isUnprovenFormat("sparebank1-csv")).toBe(false);
  });
});
