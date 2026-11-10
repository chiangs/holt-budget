import { describe, expect, it } from "vitest";
import { localDate } from "../dates.ts";
import { averageEstimate } from "../testing/estimates.ts";
import { factsBuilder, kr } from "../testing/facts-builder.ts";
import { computeFigures } from "./index.ts";

const staleOn = (b: ReturnType<typeof factsBuilder>, asOf: string) =>
  computeFigures(b.facts(), localDate(asOf), { estimate: averageEstimate }).staleEnteredValues.map((s) => ({ subject: s.value.subject, reviewBy: s.reviewBy }));

describe("entered values carry a date (rule 10)", () => {
  it("flags a value once twelve months have passed since its date, not on the day itself", () => {
    const b = factsBuilder();
    b.enteredValue({ kind: "asset", subject: "House", value: kr(4_600_000), asOf: "2025-03-10" });
    expect(staleOn(b, "2026-03-10")).toEqual([]);
    expect(staleOn(b, "2026-03-11")).toEqual([{ subject: "House", reviewBy: "2026-03-10" }]);
  });

  it("counts twelve months from 29 February to 28 February", () => {
    const b = factsBuilder();
    b.enteredValue({ kind: "figure", subject: "gross-income", value: kr(1_150_000), asOf: "2024-02-29" });
    expect(staleOn(b, "2025-02-28")).toEqual([]);
    expect(staleOn(b, "2025-03-01")).toEqual([{ subject: "gross-income", reviewBy: "2025-02-28" }]);
  });

  it("looks only at the latest value for each kind and subject, oldest first", () => {
    const b = factsBuilder();
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 3, unit: "months", asOf: "2024-01-01" });
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 4, unit: "months", asOf: "2026-01-01" });
    b.enteredValue({ kind: "reference", subject: "debt-limit", value: 5, unit: "count", asOf: "2025-01-02" });
    b.enteredValue({ kind: "asset", subject: "buffer-months", value: 1, unit: "count", asOf: "2024-06-01" });
    expect(staleOn(b, "2026-06-01")).toEqual([
      { subject: "buffer-months", reviewBy: "2025-06-01" },
      { subject: "debt-limit", reviewBy: "2026-01-02" },
    ]);
  });

  it("ignores a value dated after today, and breaks a same-day tie by the newer row", () => {
    const b = factsBuilder();
    b.buffer({ monthly: kr(1_000) });
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 4, unit: "months", asOf: "2025-01-10" });
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 5, unit: "months", asOf: "2025-01-10" });
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 8, unit: "months", asOf: "2026-02-01" });
    const figures = computeFigures(b.facts(), localDate("2026-01-15"), { estimate: averageEstimate });
    expect(figures.buffer).toMatchObject({ bufferMonths: 5 });
    expect(figures.staleEnteredValues.map((s) => s.value.value)).toEqual([5]);
  });
});
