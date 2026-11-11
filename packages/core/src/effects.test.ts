import { describe, expect, it } from "vitest";
import { type Command, apply } from "./commands/apply.ts";
import { localDate, month } from "./dates.ts";
import { previewEffects } from "./effects.ts";
import type { Facts, Job } from "./facts.ts";
import { computeFigures } from "./figures/index.ts";
import { fundingCommands, fundingOptions } from "./funding.ts";
import { jobId } from "./ids.ts";
import { money } from "./money.ts";
import { factsBuilder, kr, monthlySaving, setAmount, testId } from "./testing/facts-builder.ts";
import { planHousehold, planMonth, planToday } from "./testing/plan-household.ts";
import { monthIn } from "./testing/read-figures.ts";

// Core is typed without Node, so the one host function this test uses is named here.
declare const structuredClone: <T>(value: T) => T;

const holidaysId = jobId(testId(900_001));

describe("what adding Holidays would do, in the mockup's November", () => {
  const { facts, jobs, groups, accounts } = planHousehold();
  const holidays: Job = {
    id: holidaysId,
    name: "Holidays",
    groupId: groups.living,
    status: "active",
    accountId: accounts.buffer,
    essential: false,
    opening: money(0),
    kind: "saveUp",
    role: "ordinary",
    target: { kind: "amountByMonth", amount: kr(21_000), readyBy: month("2027-06") },
  };
  const [split] = fundingOptions(facts, { month: month(planMonth), amount: kr(3_000), exclude: [jobs.clothes] }, planToday).options;
  if (split === undefined) throw new Error("expected a split");
  const addWithSplit: Command = { kind: "batch", commands: [{ kind: "addJob", job: holidays }, ...fundingCommands(split, holidaysId, month(planMonth))] };

  const preview = previewEffects(facts, addWithSplit, { asOf: planToday });
  if (!preview.ok) throw new Error(preview.refusal.message);
  const { effects } = preview;

  it("is for the current month", () => {
    expect(effects.month).toBe("2026-11");
  });

  it("uses up the 228 kr that had no job", () => {
    expect(effects.unassigned).toEqual({ before: { kind: "unassigned", amount: kr(228) }, after: { kind: "unassigned", amount: 0 } });
  });

  it("lists each job whose assigned amount changes: Build savings 4,500 to 3,114, Buffer 3,000 to 1,614, Holidays 0 to 3,000", () => {
    expect(effects.jobs).toHaveLength(3);
    expect(effects.jobs).toEqual(
      expect.arrayContaining([
        { jobId: jobs.build, name: "Build savings", before: kr(4_500), after: kr(3_114) },
        { jobId: jobs.buffer, name: "Buffer", before: kr(3_000), after: kr(1_614) },
        { jobId: holidaysId, name: "Holidays", before: 0, after: kr(3_000) },
      ]),
    );
  });

  it("takes the savings rate from 14.0% to 9.9%", () => {
    expect(effects.savingsRate).toEqual({ before: 140, after: 99 });
  });

  it("moves the goals: the buffer's months to go grow, and Holidays gets a date", () => {
    expect(effects.goals.map((g) => g.name).sort()).toEqual(["Buffer", "Holidays"]);
    const buffer = effects.goals.find((g) => g.jobId === jobs.buffer);
    expect(buffer?.before).toMatchObject({ target: kr(158_460), saved: kr(86_000), monthly: kr(3_000), monthsToGo: 25, readyMonth: "2028-12" });
    expect(buffer?.after).toMatchObject({ saved: kr(84_614), monthly: kr(1_614), monthsToGo: 46, readyMonth: "2030-09" });
    const holiday = effects.goals.find((g) => g.jobId === holidaysId);
    expect(holiday?.before).toBeNull();
    expect(holiday?.after).toMatchObject({ target: kr(21_000), saved: kr(3_000), monthly: kr(3_000), monthsToGo: 6, readyMonth: "2027-05" });
  });

  it("leaves out a goal whose months to go and ready month do not change", () => {
    expect(effects.goals.some((g) => g.jobId === jobs.konfirmasjon || g.jobId === jobs.christmas || g.jobId === jobs.build)).toBe(false);
  });

  it("shows the buffer's runway before and after", () => {
    expect(effects.buffer.before).toMatchObject({ kind: "buffer", balance: kr(86_000), runway: { kind: "tenthsOfAMonth", tenths: 16 } });
    expect(effects.buffer.after).toMatchObject({ kind: "buffer", balance: kr(84_614), runway: { kind: "tenthsOfAMonth", tenths: 16 } });
  });

  it("is plain data: no map or set anywhere in it", () => {
    const walk = (value: unknown): void => {
      expect(value instanceof Map || value instanceof Set).toBe(false);
      if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
    };
    walk(effects);
    expect(structuredClone(effects)).toEqual(effects);
  });

  it("is what the figures give before and after: the effects are not worked out from the old facts", () => {
    const after = apply(facts, addWithSplit, { asOf: planToday });
    if (!after.ok) throw new Error("refused");
    expect(effects.unassigned.after).toEqual(monthIn(computeFigures(after.facts, planToday), planMonth).unassigned);
    expect(effects.buffer.after).toEqual(computeFigures(after.facts, planToday).buffer);
    expect(effects.buffer.before).toEqual(computeFigures(facts, planToday).buffer);
  });

  it("changes nothing it was given and writes nothing", () => {
    const copy = structuredClone(facts);
    previewEffects(facts, addWithSplit, { asOf: planToday });
    expect(facts).toEqual(copy);
    expect(facts.jobs.has(holidaysId)).toBe(false);
  });
});

describe("other changes", () => {
  const { facts, jobs } = planHousehold();
  const run = (command: Command, input: Facts = facts) => {
    const result = previewEffects(input, command, { asOf: planToday });
    if (!result.ok) throw new Error(result.refusal.message);
    return result.effects;
  };

  it("shows over-assigned money when a change assigns more than there is", () => {
    const effects = run({ kind: "assign", month: month(planMonth), jobId: jobs.clothes, amount: kr(3_028) });
    expect(effects.unassigned.after).toEqual({ kind: "unassigned", amount: 0 });
    const over = run({ kind: "assign", month: month(planMonth), jobId: jobs.clothes, amount: kr(3_500) });
    expect(over.unassigned).toEqual({ before: { kind: "unassigned", amount: kr(228) }, after: { kind: "overAssigned", amount: kr(472) } });
    expect(over.jobs).toEqual([{ jobId: jobs.clothes, name: "Clothes and kids", before: kr(2_800), after: kr(3_500) }]);
  });

  it("shows nothing moving for a change that touches no assignment", () => {
    const effects = run({ kind: "changeHousehold", changes: { name: "Another name" } });
    expect(effects.jobs).toEqual([]);
    expect(effects.goals).toEqual([]);
    expect(effects.unassigned.after).toEqual(effects.unassigned.before);
    expect(effects.savingsRate.after).toBe(effects.savingsRate.before);
    expect(effects.buffer.after).toEqual(effects.buffer.before);
  });

  it("moves the runway when an essential job is given less, since the monthly total falls", () => {
    const effects = run({ kind: "assign", month: month(planMonth), jobId: jobs.food, amount: kr(7_100) });
    expect(effects.buffer.before).toMatchObject({ essentialMonthly: kr(52_820), runway: { tenths: 16 } });
    expect(effects.buffer.after).toMatchObject({ essentialMonthly: kr(45_720), runway: { tenths: 18 } });
  });

  it("says a saving that has no target has no months to go, so it is no goal change", () => {
    const effects = run({ kind: "assign", month: month(planMonth), jobId: jobs.build, amount: kr(1_000) });
    expect(effects.goals).toEqual([]);
    expect(effects.jobs).toEqual([{ jobId: jobs.build, name: "Build savings", before: kr(4_500), after: kr(1_000) }]);
  });

  it("names a job that a batch removes, with nothing after", () => {
    const b = factsBuilder({ planStart: "2026-10" });
    b.group();
    b.buffer({ monthly: kr(0) });
    const gone = b.spendJob({ name: "Gone", plan: setAmount(kr(0)) });
    b.budgetMonth("2026-10", "closed");
    b.budgetMonth("2026-11", "open");
    b.assign("2026-11", gone, kr(100));
    const effects = run(
      {
        kind: "batch",
        commands: [
          { kind: "assign", month: month("2026-11"), jobId: gone, amount: kr(0) },
          { kind: "deleteJob", jobId: gone },
        ],
      },
      b.facts(),
    );
    expect(effects.jobs).toEqual([{ jobId: gone, name: "Gone", before: kr(100), after: 0 }]);
  });

  it("has no rate while no money is in", () => {
    const b = factsBuilder({ planStart: "2026-10" });
    b.group({ countsTowardsSavingsRate: true });
    b.buffer({ monthly: kr(0) });
    const job = b.saveUpJob({ target: monthlySaving(kr(10)) });
    b.budgetMonth("2026-10", "closed");
    b.budgetMonth("2026-11", "open");
    expect(run({ kind: "assign", month: month("2026-11"), jobId: job, amount: kr(500) }, b.facts()).savingsRate).toEqual({ before: null, after: null });
  });
});

describe("a change the app refuses", () => {
  const { facts, jobs } = planHousehold();

  it("comes back as the refusal apply gives, with no effects", () => {
    const command: Command = { kind: "moveAssignment", month: month(planMonth), from: jobs.clothes, to: jobs.build, amount: kr(9_999) };
    const refused = apply(facts, command, { asOf: planToday });
    if (refused.ok) throw new Error("expected a refusal");
    expect(previewEffects(facts, command, { asOf: planToday })).toEqual({ ok: false, refusal: refused.refusal });
  });

  it("refuses a whole batch for one refused command", () => {
    const command: Command = {
      kind: "batch",
      commands: [
        { kind: "assign", month: month(planMonth), jobId: jobs.clothes, amount: kr(100) },
        { kind: "assign", month: month("2027-03"), jobId: jobs.clothes, amount: kr(100) },
      ],
    };
    expect(previewEffects(facts, command, { asOf: planToday })).toMatchObject({ ok: false, refusal: { code: "monthNotOpen" } });
  });
});

describe("expected income", () => {
  const { facts, jobs } = planHousehold();

  it("is counted into the money in, from the facts before and the facts after the change", () => {
    const asked: Facts[] = [];
    const result = previewEffects(facts, { kind: "assign", month: month(planMonth), jobId: jobs.build, amount: kr(1_000) }, { asOf: planToday, expectedIncome: (f) => (asked.push(f), kr(10_000)) });
    if (!result.ok) throw new Error("refused");
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe(facts);
    expect(asked[1]).not.toBe(facts);
    expect(result.effects.savingsRate).toEqual({ before: 122, after: 77 });
  });
});

describe("a month the plan has not reached", () => {
  it("has nothing to report before the plan starts, and still says what the change does elsewhere", () => {
    const { facts } = planHousehold();
    const result = previewEffects(facts, { kind: "changeHousehold", changes: { name: "Another name" } }, { asOf: localDate("2026-09-15") });
    if (!result.ok) throw new Error("refused");
    expect(result.effects).toMatchObject({ month: "2026-09", unassigned: { before: { kind: "unassigned", amount: 0 }, after: { kind: "unassigned", amount: 0 } }, jobs: [], goals: [], savingsRate: { before: null, after: null } });
  });
});
