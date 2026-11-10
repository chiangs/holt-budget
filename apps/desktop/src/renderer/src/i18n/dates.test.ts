import { localDate } from "@holt/core";
import { describe, expect, it } from "vitest";
import { daysBetween, formatDay, formatFullDay } from "./dates.ts";

describe("dates", () => {
  it("writes a calendar day the way the mockups do, whatever the time zone", () => {
    expect(formatDay(localDate("2026-10-19"), "en-GB")).toBe("19 Oct");
    expect(formatFullDay(localDate("2026-01-01"), "en-GB")).toBe("1 Jan 2026");
  });

  it("counts whole days, across a month end and a leap day", () => {
    expect(daysBetween(localDate("2026-10-17"), localDate("2026-11-06"))).toBe(20);
    expect(daysBetween(localDate("2028-02-28"), localDate("2028-03-01"))).toBe(2);
    expect(daysBetween(localDate("2026-11-06"), localDate("2026-11-03"))).toBe(-3);
  });
});
