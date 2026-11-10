import { describe, expect, it } from "vitest";
import { localDate } from "../dates.ts";
import type { EnteredValue, Facts } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import { enteredValueId } from "../ids.ts";
import { accepted, commandHousehold, today } from "../testing/command-household.ts";
import { testId } from "../testing/facts-builder.ts";
import { apply } from "./apply.ts";

const bufferMonths = (n: number, value: number, asOf: string): EnteredValue => ({
  id: enteredValueId(testId(300_000 + n)),
  kind: "reference",
  subject: "buffer-months",
  value,
  unit: "months",
  asOf: localDate(asOf),
  source: "entered by you",
});

describe("entering a value (rule 10)", () => {
  const h = commandHousehold();
  const enter = (facts: Facts, value: EnteredValue) => accepted(apply(facts, { kind: "enterValue", value }, { asOf: today }));
  const first = bufferMonths(1, 3, "2026-10-01");
  const second = bufferMonths(2, 4, "2026-11-01");
  const both = enter(enter(h.facts, first), second);

  it("adds a row and keeps every earlier value for the same setting", () => {
    expect([...both.enteredValues.values()]).toEqual([first, second]);
  });

  it("the latest value is the one the figures use", () => {
    const figures = computeFigures(both, today);
    expect(figures.buffer.kind === "buffer" && figures.buffer.bufferMonths).toBe(4);
  });

  it("never replaces a value with the same ID", () => {
    expect(apply(both, { kind: "enterValue", value: { ...first, value: 6 } }, { asOf: today })).toMatchObject({ ok: false, refusal: { code: "idTaken" } });
  });
});
