import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, apply } from "./commands/apply.ts";
import { type LocalDate, month, monthOf } from "./dates.ts";
import { previewEffects } from "./effects.ts";
import type { Facts } from "./facts.ts";
import { type Figures, computeFigures } from "./figures/index.ts";
import { goalOf } from "./figures/goals.ts";
import { savingsRate } from "./figures/savings-rate.ts";
import type { JobId } from "./ids.ts";
import { compareIds } from "./import/matching.ts";
import { money } from "./money.ts";
import { arbitraryScript } from "./testing/arbitrary-commands.ts";
import { planHousehold, planMonth, planToday } from "./testing/plan-household.ts";

// Core is typed without Node, so the one host function this test uses is named here.
declare const structuredClone: <T>(value: T) => T;

/** What the effects of a command should be, worked out only from the public figures of the facts before and after it. */
function expectedEffects(before: Facts, after: Facts, asOf: LocalDate) {
  const [figuresBefore, figuresAfter] = [computeFigures(before, asOf), computeFigures(after, asOf)];
  const current = monthOf(asOf);
  const assigned = (figures: Figures) => new Map([...(figures.months.get(current)?.jobs ?? [])].map(([id, jobMonth]) => [id, jobMonth.assigned.amount]));
  const [was, now] = [assigned(figuresBefore), assigned(figuresAfter)];
  const jobs = [...new Set<JobId>([...was.keys(), ...now.keys()])]
    .filter((id) => (was.get(id) ?? 0) !== (now.get(id) ?? 0))
    .sort(compareIds)
    .map((id) => [id, was.get(id) ?? 0, now.get(id) ?? 0] as const);
  const goals = [...new Set<JobId>([...figuresBefore.jobs.keys(), ...figuresAfter.jobs.keys()])].sort(compareIds).flatMap((id) => {
    const [b, a] = [goalOf(before, id, asOf), goalOf(after, id, asOf)];
    const moved = b === null || a === null || b.monthsToGo !== a.monthsToGo || b.readyMonth !== a.readyMonth;
    return (b !== null || a !== null) && moved ? [[id, b, a] as const] : [];
  });
  /** A month before the plan starts has no figures, so nothing is unassigned in it. A change of the plan start can move today there. */
  const unassigned = (figures: Figures) => figures.months.get(current)?.unassigned ?? { kind: "unassigned", amount: 0 };
  const rate = (facts: Facts) => savingsRate(facts, asOf).find((r) => r.month === current)?.tenths ?? null;
  return {
    unassigned: { before: unassigned(figuresBefore), after: unassigned(figuresAfter) },
    jobs,
    savingsRate: { before: rate(before), after: rate(after) },
    goals,
    buffer: { before: figuresBefore.buffer, after: figuresAfter.buffer },
  };
}

/** Everything a preview must satisfy for one command. Returns the facts after the command when it was accepted, and the facts as they were when it was not. */
function checkPreview(facts: Facts, command: Command, asOf: LocalDate): Facts {
  const copy = structuredClone(facts);
  const preview = previewEffects(facts, command, { asOf });
  expect(facts).toEqual(copy);

  const applied = apply(facts, command, { asOf });
  if (!applied.ok) {
    expect(preview).toEqual({ ok: false, refusal: applied.refusal });
    return facts;
  }
  if (!preview.ok) throw new Error(`the command was accepted, but the preview was refused: ${preview.refusal.message}`);
  const { effects } = preview;
  const expected = expectedEffects(facts, applied.facts, asOf);
  expect(effects.month).toBe(monthOf(asOf));
  expect(effects.unassigned).toEqual(expected.unassigned);
  expect(effects.jobs.map((j) => [j.jobId, j.before, j.after])).toEqual(expected.jobs);
  expect(effects.savingsRate).toEqual(expected.savingsRate);
  expect(effects.goals.map((g) => [g.jobId, g.before, g.after])).toEqual(expected.goals);
  expect(effects.buffer).toEqual(expected.buffer);
  return applied.facts;
}

describe("previewing the commands of random scripts", () => {
  it("never changes the facts, matches apply on refusing, equals the difference of two figure runs, and gives the unassigned money the command then gives", () => {
    fc.assert(
      fc.property(arbitraryScript({ minSteps: 5, maxSteps: 25 }), (script) => {
        let facts = script.start;
        for (const command of script.commands(() => facts)) facts = checkPreview(facts, command, script.asOf);
      }),
    );
  });

  it("is the same for a batch as for the facts that its commands one by one leave", () => {
    fc.assert(
      fc.property(arbitraryScript({ minSteps: 5, maxSteps: 25 }), fc.integer({ min: 2, max: 4 }), (script, size) => {
        let facts = script.start;
        const run: Command[] = [];
        for (const command of script.commands(() => facts)) {
          const applied = apply(facts, command, { asOf: script.asOf });
          if (applied.ok) {
            run.push(command);
            facts = applied.facts;
          }
          if (run.length === size) break;
        }
        const batch: Command = { kind: "batch", commands: run };
        const preview = previewEffects(script.start, batch, { asOf: script.asOf });
        if (!preview.ok) return;
        const expected = expectedEffects(script.start, facts, script.asOf);
        expect(preview.effects.unassigned).toEqual(expected.unassigned);
        expect(preview.effects.jobs.map((j) => [j.jobId, j.before, j.after])).toEqual(expected.jobs);
        expect(preview.effects.savingsRate).toEqual(expected.savingsRate);
        expect(preview.effects.goals.map((g) => [g.jobId, g.before, g.after])).toEqual(expected.goals);
      }),
    );
  });
});

describe("previewing changes to the mockup's November", () => {
  const { facts } = planHousehold();
  const everyJob = [...facts.jobs.keys()];
  const pick = fc.nat().map((n) => everyJob[n % everyJob.length] as JobId);
  const november = month(planMonth);
  const step: fc.Arbitrary<Command> = fc.oneof(
    fc.record({ kind: fc.constant("assign" as const), month: fc.constant(november), jobId: pick, amount: fc.integer({ min: 0, max: 2_000_000 }).map(money) }),
    fc.record({ kind: fc.constant("moveAssignment" as const), month: fc.constant(november), from: pick, to: pick, amount: fc.integer({ min: 1, max: 600_000 }).map(money) }),
    fc.record({ kind: fc.constant("changeJob" as const), jobId: pick, changes: fc.record({ status: fc.constantFrom("active" as const, "paused" as const), essential: fc.boolean() }, { requiredKeys: [] }) }),
  );

  it("gives effects equal to two figure runs for any change, and the unassigned money the change then gives", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 3 }), (commands) => {
        checkPreview(facts, commands.length === 1 ? (commands[0] as Command) : { kind: "batch", commands }, planToday);
      }),
      { numRuns: 300 },
    );
  });

  it("reaches the savings rate, the goals and the runway, not only the unassigned money", () => {
    const seen = { rate: 0, goals: 0, runway: 0 };
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 3 }), (commands) => {
        const preview = previewEffects(facts, { kind: "batch", commands }, { asOf: planToday });
        if (!preview.ok) return;
        if (preview.effects.savingsRate.before !== preview.effects.savingsRate.after) seen.rate += 1;
        if (preview.effects.goals.length > 0) seen.goals += 1;
        if (JSON.stringify(preview.effects.buffer.before) !== JSON.stringify(preview.effects.buffer.after)) seen.runway += 1;
      }),
      { numRuns: 300 },
    );
    expect(seen.rate).toBeGreaterThan(20);
    expect(seen.goals).toBeGreaterThan(20);
    expect(seen.runway).toBeGreaterThan(20);
  });
});
