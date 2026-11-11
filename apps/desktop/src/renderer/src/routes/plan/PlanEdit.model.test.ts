import { type FamilyCommand, type Facts, type JobId, type Money, MoneyError, apply, assignmentKey, computeFigures, money, month, parseMoney } from "@holt/core";
import { NOK, kr } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planAssignEdit, planMove, readAmount } from "./PlanEdit.model.ts";
import { buildWorld, today } from "./PlanTestWorld.ts";

const november = month("2026-11");

function run(facts: Facts, command: FamilyCommand): Facts {
  const result = apply(facts, command as never, { asOf: today });
  if (!result.ok) throw new Error(result.refusal.message);
  return result.facts;
}

const assignedIn = (facts: Facts, jobId: JobId): Money => facts.assignments.get(assignmentKey(november, jobId))?.amount ?? money(0);

describe("typing an amount over a job's assigned amount", () => {
  const world = buildWorld();
  const edit = (text: string, current = kr(14_500)) => planAssignEdit(text, { month: november, jobId: world.jobs.mortgage, current, currency: NOK });

  it("makes an assign command for that job and month with exactly that amount", () => {
    expect(edit("19850")).toEqual({
      kind: "assign",
      amount: kr(19_850),
      command: { kind: "assign", month: november, jobId: world.jobs.mortgage, amount: kr(19_850) },
    });
  });

  it("reads the family's own ways of typing an amount", () => {
    expect(edit("19 850")).toMatchObject({ kind: "assign", amount: kr(19_850) });
    expect(edit("19,850")).toMatchObject({ kind: "assign", amount: kr(19_850) });
    expect(edit("19850,50")).toMatchObject({ kind: "assign", amount: 1_985_050 });
    expect(edit("0")).toMatchObject({ kind: "assign", amount: kr(0) });
  });

  it("changes nothing when the amount typed is the amount already assigned", () => {
    expect(edit("14500")).toEqual({ kind: "unchanged" });
    expect(edit("14 500,00")).toEqual({ kind: "unchanged" });
  });

  it("says what is wrong when the text isn't an amount, and when it is negative", () => {
    expect(edit("")).toEqual({ kind: "invalid", problem: "notAnAmount" });
    expect(edit("lots")).toEqual({ kind: "invalid", problem: "notAnAmount" });
    expect(edit("12.345,6.7")).toEqual({ kind: "invalid", problem: "notAnAmount" });
    expect(edit("-500")).toEqual({ kind: "invalid", problem: "negative" });
    expect(edit("−500")).toEqual({ kind: "invalid", problem: "negative" });
  });

  it("assigns the typed amount to that job and leaves every other job alone", () => {
    const changed = edit("19850");
    if (changed.kind !== "assign") throw new Error("Expected an assign");
    const after = run(world.facts, changed.command);
    expect(assignedIn(after, world.jobs.mortgage)).toBe(kr(19_850));
    for (const [id] of world.facts.jobs) if (id !== world.jobs.mortgage) expect(assignedIn(after, id)).toBe(assignedIn(world.facts, id));
    const figures = computeFigures(after, today).months.get(november);
    expect(figures?.unassigned.amount).toBe(kr(60_000 - 48_150 - (19_850 - 14_500)));
  });

  it("for any typed amount makes a command whose amount is what parseMoney reads, never negative", () => {
    const whole = fc.integer({ min: 0, max: 900_000_000 });
    const text = fc
      .tuple(whole, fc.option(fc.integer({ min: 0, max: 99 }), { nil: undefined }), fc.constantFrom(".", ","), fc.boolean())
      .map(([kroner, ore, separator, grouped]) => {
        const digits = grouped ? String(kroner).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : String(kroner);
        return { separator, text: ore === undefined ? digits : `${digits}${separator}${String(ore).padStart(2, "0")}` };
      });
    fc.assert(
      fc.property(text, ({ separator, text: typed }) => {
        const result = edit(typed, kr(-1));
        if (result.kind !== "assign") return false;
        return result.command.amount === parseMoney(typed, NOK, separator as "," | ".") && result.command.amount >= 0 && Number.isSafeInteger(result.command.amount);
      }),
    );
  });

  it("for any text at all never makes a negative or fractional amount, and never throws", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), (typed) => {
        const result = edit(typed, kr(-1));
        return result.kind !== "assign" || (result.command.amount >= 0 && Number.isSafeInteger(result.command.amount));
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[-−+]?[0-9 ,.]{0,14}$/), (typed) => {
        const result = edit(typed, kr(-1));
        return result.kind !== "assign" || result.command.amount >= 0;
      }),
    );
  });

  it("is the amount parseMoney reads for the same text, so nothing is rounded on the way", () => {
    const result = readAmount("1234.56", NOK);
    expect(result).toEqual({ kind: "amount", amount: parseMoney("1234.56", NOK, ".") });
    expect(() => parseMoney("12.345", NOK, ".")).toThrow(MoneyError);
    expect(readAmount("12.345", NOK)).toEqual({ kind: "invalid", problem: "notAnAmount" });
  });
});

describe("moving money", () => {
  const world = buildWorld();
  const plan = (form: Parameters<typeof planMove>[0]) => planMove(form, { month: november, currency: NOK, assignedOf: (id) => assignedIn(world.facts, id) });

  it("moves from one job's assignment to another's, in that direction", () => {
    const result = plan({ from: world.jobs.food, to: { kind: "job", jobId: world.jobs.buffer }, amountText: "500" });
    expect(result).toEqual({
      kind: "move",
      amount: kr(500),
      command: { kind: "moveAssignment", month: november, from: world.jobs.food, to: world.jobs.buffer, amount: kr(500) },
    });
    if (result.kind !== "move") return;
    const after = run(world.facts, result.command);
    expect(assignedIn(after, world.jobs.food)).toBe(kr(14_200 - 500));
    expect(assignedIn(after, world.jobs.buffer)).toBe(kr(2_000 + 500));
    expect(computeFigures(after, today).months.get(november)?.assigned).toBe(computeFigures(world.facts, today).months.get(november)?.assigned);
  });

  it("moves money from a job back to unassigned by lowering what the job has", () => {
    const result = plan({ from: world.jobs.food, to: { kind: "unassigned" }, amountText: "500" });
    expect(result).toMatchObject({ kind: "move", amount: kr(500), command: { kind: "assign", jobId: world.jobs.food, amount: kr(13_700) } });
    if (result.kind !== "move") return;
    const before = computeFigures(world.facts, today).months.get(november)?.unassigned.amount ?? 0;
    const after = computeFigures(run(world.facts, result.command), today).months.get(november)?.unassigned.amount ?? 0;
    expect(after - before).toBe(kr(500));
  });

  it("brings an over-assigned month back to zero", () => {
    const over = buildWorld({ income: 48_150 - 1_000 });
    const result = planMove({ from: over.jobs.food, to: { kind: "unassigned" }, amountText: "1000" }, { month: november, currency: NOK, assignedOf: () => kr(14_200) });
    if (result.kind !== "move") throw new Error("Expected a move");
    const unassigned = computeFigures(run(over.facts, result.command), today).months.get(november)?.unassigned;
    expect(unassigned).toEqual({ kind: "unassigned", amount: 0 });
  });

  it("says what is missing or wrong before it makes a command", () => {
    const food = world.jobs.food;
    const buffer: { kind: "job"; jobId: JobId } = { kind: "job", jobId: world.jobs.buffer };
    expect(plan({ from: null, to: buffer, amountText: "5" })).toEqual({ kind: "problem", problem: "chooseFrom" });
    expect(plan({ from: food, to: null, amountText: "5" })).toEqual({ kind: "problem", problem: "chooseTo" });
    expect(plan({ from: food, to: { kind: "job", jobId: food }, amountText: "5" })).toEqual({ kind: "problem", problem: "sameJob" });
    expect(plan({ from: food, to: buffer, amountText: "" })).toEqual({ kind: "problem", problem: "notAnAmount" });
    expect(plan({ from: food, to: buffer, amountText: "-5" })).toEqual({ kind: "problem", problem: "negative" });
    expect(plan({ from: food, to: buffer, amountText: "0" })).toEqual({ kind: "problem", problem: "notAbove" });
  });

  it("won't move more than the job has assigned, and will move all of it", () => {
    const buffer: { kind: "job"; jobId: JobId } = { kind: "job", jobId: world.jobs.buffer };
    expect(plan({ from: world.jobs.food, to: buffer, amountText: "14201" })).toEqual({ kind: "problem", problem: "tooMuch" });
    expect(plan({ from: world.jobs.food, to: buffer, amountText: "14200" })).toMatchObject({ kind: "move", amount: kr(14_200) });
  });

  it("for any amount up to what the job has, moves exactly that much and changes nothing else", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 14_200 }), (kroner) => {
        const result = plan({ from: world.jobs.food, to: { kind: "job", jobId: world.jobs.mortgage }, amountText: String(kroner) });
        if (result.kind !== "move") return false;
        const after = run(world.facts, result.command);
        return (
          assignedIn(after, world.jobs.food) === kr(14_200 - kroner) &&
          assignedIn(after, world.jobs.mortgage) === kr(14_500 + kroner) &&
          assignedIn(after, world.jobs.buffer) === assignedIn(world.facts, world.jobs.buffer)
        );
      }),
    );
  });
});
