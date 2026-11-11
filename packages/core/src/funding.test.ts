import { describe, expect, it } from "vitest";
import { type Command, apply } from "./commands/apply.ts";
import { localDate, month } from "./dates.ts";
import type { Job } from "./facts.ts";
import { computeFigures } from "./figures/index.ts";
import { type FundingOption, fundingCommands, fundingOptions } from "./funding.ts";
import { type JobId, jobId } from "./ids.ts";
import { money } from "./money.ts";
import { accepted } from "./testing/command-household.ts";
import { factsBuilder, kr, monthlySaving, setAmount, testId } from "./testing/facts-builder.ts";
import { planHousehold, planMonth, planToday } from "./testing/plan-household.ts";
import { jobIn, monthIn, signed } from "./testing/read-figures.ts";

const today = localDate("2026-11-09");
const november = month("2026-11");
const newJob = jobId(testId(900_001));

describe("where the money for a new job could come from, in the mockup's household", () => {
  const { facts, jobs, groups, accounts } = planHousehold();
  const request = { month: month(planMonth), amount: kr(3_000) };
  const holidays: Job = {
    id: newJob,
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
  const addHolidays: Command = { kind: "addJob", job: holidays };
  const withOption = (option: FundingOption) => accepted(apply(facts, { kind: "batch", commands: [addHolidays, ...fundingCommands(option, newJob, month(planMonth))] }, { asOf: planToday }));

  it("takes the 228 kr with no job first, then splits the other 2,772 kr between Build savings and Buffer, or takes it from either alone", () => {
    const found = fundingOptions(facts, { ...request, exclude: [jobs.clothes] }, planToday);
    expect(found).toEqual({
      month: "2026-11",
      amount: kr(3_000),
      unassigned: kr(228),
      givable: kr(7_500),
      shortfall: 0,
      options: [
        {
          kind: "split",
          fromUnassigned: kr(228),
          moves: [
            { from: jobs.build, amount: kr(1_386) },
            { from: jobs.buffer, amount: kr(1_386) },
          ],
        },
        { kind: "single", fromUnassigned: kr(228), moves: [{ from: jobs.build, amount: kr(2_772) }] },
        { kind: "single", fromUnassigned: kr(228), moves: [{ from: jobs.buffer, amount: kr(2_772) }] },
      ],
    });
  });

  it("gives Build savings 4,500 to 3,114 kr and Buffer 3,000 to 1,614 kr once the split is made", () => {
    const [split] = fundingOptions(facts, { ...request, exclude: [jobs.clothes] }, planToday).options;
    if (split === undefined) throw new Error("expected a split");
    const figures = computeFigures(withOption(split), planToday);
    expect(jobIn(figures, jobs.build, planMonth).assigned.amount).toBe(kr(3_114));
    expect(jobIn(figures, jobs.buffer, planMonth).assigned.amount).toBe(kr(1_614));
    expect(jobIn(figures, newJob, planMonth).assigned.amount).toBe(kr(3_000));
    expect(monthIn(figures, planMonth).unassigned).toEqual({ kind: "unassigned", amount: 0 });
  });

  it("offers Clothes and kids as well when the family has not ruled it out", () => {
    const { options } = fundingOptions(facts, request, planToday);
    expect(options.map((o) => [o.kind, o.moves.map((m) => [m.from, m.amount])])).toEqual([
      [
        "split",
        [
          [jobs.build, kr(924)],
          [jobs.buffer, kr(924)],
          [jobs.clothes, kr(924)],
        ],
      ],
      ["single", [[jobs.build, kr(2_772)]]],
      ["single", [[jobs.buffer, kr(2_772)]]],
      ["single", [[jobs.clothes, kr(2_772)]]],
    ]);
  });

  it("never offers an essential job: not food, not a bill, not Konfirmasjon, not a child's savings", () => {
    const offered = new Set(fundingOptions(facts, { ...request, amount: kr(10_000) }, planToday).options.flatMap((o) => o.moves.map((m) => m.from)));
    expect([...offered].sort()).toEqual([jobs.build, jobs.buffer, jobs.clothes].sort());
  });

  it("makes every option a change the app accepts, and leaves nothing without a job", () => {
    const before = computeFigures(facts, planToday);
    for (const option of fundingOptions(facts, request, planToday).options) {
      const figures = computeFigures(withOption(option), planToday);
      expect(jobIn(figures, newJob, planMonth).assigned.amount).toBe(kr(3_000));
      expect(monthIn(figures, planMonth).unassigned).toEqual({ kind: "unassigned", amount: 0 });
      for (const move of option.moves) {
        expect(jobIn(figures, move.from, planMonth).assigned.amount).toBe(jobIn(before, move.from, planMonth).assigned.amount - move.amount);
      }
    }
  });

  it("adds to what an existing job already has when told so, instead of replacing it", () => {
    const [split] = fundingOptions(facts, { month: month(planMonth), amount: kr(1_000) }, planToday).options;
    if (split === undefined) throw new Error("expected a split");
    const assignedAfter = (alreadyAssigned?: ReturnType<typeof kr>) => {
      const commands = fundingCommands(split, jobs.konfirmasjon, month(planMonth), alreadyAssigned);
      return jobIn(computeFigures(accepted(apply(facts, { kind: "batch", commands }, { asOf: planToday })), planToday), jobs.konfirmasjon, planMonth).assigned.amount;
    };
    expect(assignedAfter(kr(1_500))).toBe(kr(2_500));
    expect(assignedAfter()).toBe(kr(1_000));
  });

  it("builds the commands in order: the money with no job is assigned first, then each share is moved", () => {
    const [split] = fundingOptions(facts, { ...request, exclude: [jobs.clothes] }, planToday).options;
    if (split === undefined) throw new Error("expected a split");
    expect(fundingCommands(split, newJob, month(planMonth))).toEqual([
      { kind: "assign", month: "2026-11", jobId: newJob, amount: kr(228) },
      { kind: "moveAssignment", month: "2026-11", from: jobs.build, to: newJob, amount: kr(1_386) },
      { kind: "moveAssignment", month: "2026-11", from: jobs.buffer, to: newJob, amount: kr(1_386) },
    ]);
  });
});

/** An open month holding the given jobs, each assigned an amount in kroner, with `moneyIn` kroner arrived for it. */
function monthWith(spec: readonly { readonly assigned: number; readonly essential?: boolean; readonly status?: "active" | "paused" }[], moneyIn: number) {
  const b = factsBuilder({ planStart: "2026-10" });
  b.group();
  b.buffer({ monthly: kr(0) });
  b.budgetMonth("2026-10", "closed");
  b.budgetMonth("2026-11", "open");
  const ids = spec.map((s, i) => {
    const job = b.spendJob({ name: `Job ${i + 1}`, plan: setAmount(kr(s.assigned)), essential: s.essential ?? false, status: s.status ?? "active" });
    b.assign("2026-11", job, kr(s.assigned));
    return job;
  });
  if (moneyIn > 0) b.income({ date: "2026-10-20", amount: kr(moneyIn), fundsMonth: "2026-11" });
  return { b, ids, facts: b.facts() };
}

const optionsFor = (facts: ReturnType<typeof monthWith>["facts"], amount: number, exclude: readonly JobId[] = []) =>
  fundingOptions(facts, { month: november, amount: kr(amount), exclude }, today);

describe("the options", () => {
  it("need no job to give anything when the money with no job covers the amount", () => {
    const { facts } = monthWith([{ assigned: 1_000 }], 1_500);
    const found = optionsFor(facts, 400);
    expect(found).toMatchObject({ unassigned: kr(500), shortfall: 0 });
    expect(found.options).toEqual([{ kind: "unassigned", fromUnassigned: kr(400), moves: [] }]);
    const [option] = found.options;
    expect(fundingCommands(option as FundingOption, newJob, november)).toEqual([{ kind: "assign", month: "2026-11", jobId: newJob, amount: kr(400) }]);
  });

  it("take the whole amount from jobs when the month has no money without a job, or is over-assigned", () => {
    const none = monthWith([{ assigned: 1_000 }], 1_000);
    expect(optionsFor(none.facts, 300)).toMatchObject({ unassigned: 0, options: [{ kind: "single", fromUnassigned: 0, moves: [{ amount: kr(300) }] }] });
    const over = monthWith([{ assigned: 1_000 }], 400);
    expect(signed(monthIn(computeFigures(over.facts, today), "2026-11").unassigned)).toBe(-kr(600));
    expect(optionsFor(over.facts, 300)).toMatchObject({ unassigned: 0, options: [{ kind: "single", fromUnassigned: 0, moves: [{ amount: kr(300) }] }] });
  });

  it("offer a split only when two or more jobs share it", () => {
    const one = monthWith([{ assigned: 1_000 }], 1_000);
    expect(optionsFor(one.facts, 300).options.map((o) => o.kind)).toEqual(["single"]);
    const two = monthWith([{ assigned: 1_000 }, { assigned: 500 }], 1_500);
    expect(optionsFor(two.facts, 300).options.map((o) => o.kind)).toEqual(["split", "single", "single"]);
  });

  it("order the jobs by what they have assigned, largest first, and a tie by ID", () => {
    const { facts, ids } = monthWith([{ assigned: 400 }, { assigned: 900 }, { assigned: 400 }], 1_700);
    const [split] = optionsFor(facts, 300).options;
    expect(split?.moves.map((m) => m.from)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it("give the remainder of the shares to the first job", () => {
    const { facts, ids } = monthWith([{ assigned: 300 }, { assigned: 200 }, { assigned: 100 }], 600);
    const [split] = fundingOptions(facts, { month: november, amount: money(10) }, today).options;
    expect(split).toMatchObject({
      kind: "split",
      moves: [
        { from: ids[0], amount: 4 },
        { from: ids[1], amount: 3 },
        { from: ids[2], amount: 3 },
      ],
    });
  });

  it("never take more than a job has assigned, and share what it cannot give among the others", () => {
    const { facts, ids } = monthWith([{ assigned: 5 }, { assigned: 100 }], 105);
    expect(optionsFor(facts, 60).options[0]).toMatchObject({
      kind: "split",
      moves: [
        { from: ids[1], amount: kr(55) },
        { from: ids[0], amount: kr(5) },
      ],
    });
    const small = monthWith([{ assigned: 3 }, { assigned: 100 }], 103);
    expect(optionsFor(small.facts, 11).options[0]).toMatchObject({
      kind: "split",
      moves: [
        { from: small.ids[1], amount: kr(8) },
        { from: small.ids[0], amount: kr(3) },
      ],
    });
  });

  it("give the remainder to the next job when the first cannot take it, so the first jobs are filled to what they have", () => {
    const b = factsBuilder({ planStart: "2026-10" });
    b.group();
    b.buffer({ monthly: kr(0) });
    b.budgetMonth("2026-10", "closed");
    b.budgetMonth("2026-11", "open");
    const ids = Array.from({ length: 5 }, (_, i) => {
      const job = b.spendJob({ name: `Job ${i + 1}`, plan: setAmount(money(3)) });
      b.assign("2026-11", job, money(3));
      return job;
    });
    b.income({ date: "2026-10-20", amount: money(15), fundsMonth: "2026-11" });
    const [split] = fundingOptions(b.facts(), { month: november, amount: money(14) }, today).options;
    expect(split?.moves.map((m) => [m.from, m.amount])).toEqual([
      [ids[0], 3],
      [ids[1], 3],
      [ids[2], 3],
      [ids[3], 3],
      [ids[4], 2],
    ]);
  });

  it("offer a single job only when it can cover the amount alone", () => {
    const { facts, ids } = monthWith([{ assigned: 100 }, { assigned: 60 }, { assigned: 30 }], 190);
    expect(optionsFor(facts, 70).options.filter((o) => o.kind === "single").map((o) => o.moves[0]?.from)).toEqual([ids[0]]);
    expect(optionsFor(facts, 60).options.filter((o) => o.kind === "single").map((o) => o.moves[0]?.from)).toEqual([ids[0], ids[1]]);
  });

  it("leave out essential jobs, paused jobs, jobs with nothing assigned, and jobs the family excludes", () => {
    const { facts, ids } = monthWith(
      [{ assigned: 900, essential: true }, { assigned: 800, status: "paused" }, { assigned: 0 }, { assigned: 700 }, { assigned: 600 }, { assigned: 500 }],
      3_500,
    );
    const offered = (exclude: readonly JobId[]) => new Set(optionsFor(facts, 100, exclude).options.flatMap((o) => o.moves.map((m) => m.from)));
    expect([...offered([])].sort()).toEqual([ids[3], ids[4], ids[5]].sort());
    expect([...offered([ids[3] as JobId])].sort()).toEqual([ids[4], ids[5]].sort());
  });

  it("say what is left when the jobs that could give do not hold enough, and offer nothing", () => {
    const { facts } = monthWith([{ assigned: 100 }, { assigned: 50 }, { assigned: 900, essential: true }], 1_100);
    expect(optionsFor(facts, 300)).toMatchObject({ unassigned: kr(50), givable: kr(150), shortfall: kr(100), options: [] });
    expect(optionsFor(facts, 200)).toMatchObject({ shortfall: 0 });
    expect(optionsFor(facts, 200).options.length).toBeGreaterThan(0);
    expect(optionsFor(facts, 201)).toMatchObject({ shortfall: kr(1), options: [] });
  });

  it("have a shortfall of the whole amount in a month with no jobs to take from", () => {
    const { facts } = monthWith([], 0);
    expect(optionsFor(facts, 50)).toMatchObject({ unassigned: 0, givable: 0, shortfall: kr(50), options: [] });
  });

  it("need nothing for an amount of 0", () => {
    const { facts } = monthWith([{ assigned: 100 }], 100);
    const { options } = optionsFor(facts, 0);
    expect(options).toEqual([{ kind: "unassigned", fromUnassigned: 0, moves: [] }]);
    expect(fundingCommands(options[0] as FundingOption, newJob, november)).toEqual([]);
  });

  it("refuse an amount that is negative or not whole", () => {
    const { facts } = monthWith([{ assigned: 100 }], 100);
    expect(() => fundingOptions(facts, { month: november, amount: money(-1) }, today)).toThrow(RangeError);
    expect(() => fundingOptions(facts, { month: november, amount: 1.5 as never }, today)).toThrow(RangeError);
  });

  it("know nothing of a month outside the plan, so offer nothing for it", () => {
    const { facts } = monthWith([{ assigned: 100 }], 100);
    expect(fundingOptions(facts, { month: month("2024-01"), amount: kr(10) }, today)).toMatchObject({ unassigned: 0, givable: 0, shortfall: kr(10), options: [] });
  });

  it("have options for a month the family has not opened, but the commands are refused there", () => {
    const b = factsBuilder({ planStart: "2026-10" });
    b.group();
    b.buffer({ monthly: kr(0) });
    const save = b.saveUpJob({ target: monthlySaving(kr(1_000)) });
    b.budgetMonth("2026-10", "closed");
    b.income({ date: "2026-10-20", amount: kr(5_000), fundsMonth: "2026-12" });
    const found = fundingOptions(b.facts(), { month: month("2026-12"), amount: kr(2_000) }, today);
    const [option] = found.options;
    if (option === undefined) throw new Error("expected an option");
    expect(found.unassigned).toBeGreaterThan(0);
    const result = apply(b.facts(), { kind: "batch", commands: fundingCommands(option, save, month("2026-12")) }, { asOf: today });
    expect(result).toMatchObject({ ok: false, refusal: { code: "monthNotOpen" } });
  });
});
