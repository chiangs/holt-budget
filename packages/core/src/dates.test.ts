import { describe, expect, it } from "vitest";
import { DateError, addDays, addMonths, daysBetween, firstDayOf, lastDayOf, localDate, month, monthOf, monthRange, monthsBetween } from "./dates.ts";

describe("localDate and month", () => {
  it("accept real calendar days, including 29 February in a leap year", () => {
    expect(localDate("2026-11-08")).toBe("2026-11-08");
    expect(localDate("2028-02-29")).toBe("2028-02-29");
    expect(month("2026-11")).toBe("2026-11");
  });

  it("reject days and months that do not exist", () => {
    for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-4-1", "26-04-01", "2026-11-08T10:00", ""]) {
      expect(() => localDate(bad), bad).toThrow(DateError);
    }
    for (const bad of ["2026-13", "2026-00", "2026-1", "2026-11-08"]) expect(() => month(bad), bad).toThrow(DateError);
  });
});

describe("month arithmetic", () => {
  it("steps across year ends in both directions", () => {
    expect(addMonths(month("2026-11"), 1)).toBe("2026-12");
    expect(addMonths(month("2026-12"), 1)).toBe("2027-01");
    expect(addMonths(month("2027-01"), -1)).toBe("2026-12");
    expect(addMonths(month("2026-11"), 14)).toBe("2028-01");
    expect(addMonths(month("2026-11"), -23)).toBe("2024-12");
    expect(addMonths(month("2026-11"), 0)).toBe("2026-11");
  });

  it("counts months between and lists a range", () => {
    expect(monthsBetween(month("2026-01"), month("2026-11"))).toBe(10);
    expect(monthsBetween(month("2026-11"), month("2026-01"))).toBe(-10);
    expect(monthRange(month("2026-11"), month("2027-02"))).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthRange(month("2026-11"), month("2026-10"))).toEqual([]);
  });

  it("finds the month and the first and last day of it", () => {
    expect(monthOf(localDate("2026-11-30"))).toBe("2026-11");
    expect(firstDayOf(month("2026-02"))).toBe("2026-02-01");
    expect(lastDayOf(month("2026-02"))).toBe("2026-02-28");
    expect(lastDayOf(month("2028-02"))).toBe("2028-02-29");
    expect(lastDayOf(month("2026-12"))).toBe("2026-12-31");
  });
});

describe("day arithmetic", () => {
  it("counts days across month and year ends", () => {
    expect(daysBetween(localDate("2026-11-08"), localDate("2026-11-11"))).toBe(3);
    expect(daysBetween(localDate("2026-12-30"), localDate("2027-01-02"))).toBe(3);
    expect(daysBetween(localDate("2026-11-11"), localDate("2026-11-08"))).toBe(-3);
  });

  it("adds days without drifting at daylight saving changes", () => {
    expect(addDays(localDate("2026-03-28"), 3)).toBe("2026-03-31");
    expect(addDays(localDate("2026-10-24"), 2)).toBe("2026-10-26");
    expect(addDays(localDate("2026-03-01"), -1)).toBe("2026-02-28");
  });
});
