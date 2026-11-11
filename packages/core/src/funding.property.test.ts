import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Command, apply } from "./commands/apply.ts";
import { localDate, month } from "./dates.ts";
import type { Facts } from "./facts.ts";
import { computeFigures } from "./figures/index.ts";
import { type FundingOptions, fundingCommands, fundingOptions } from "./funding.ts";
import { type JobId, jobId } from "./ids.ts";
import { money } from "./money.ts";
import { factsBuilder, kr, monthlySaving, setAmount, testId } from "./testing/facts-builder.ts";
import { jobIn, monthIn, signed } from "./testing/read-figures.ts";

const today = localDate("2026-11-09");
const november = month("2026-11");
const newJob = jobId(testId(900_001));

interface JobSpec {
  readonly assigned: number;
  readonly essential: boolean;
  readonly status: "active" | "paused" | "finished";
  readonly saveUp: boolean;
}

const scenario = fc.record({
  jobs: fc.array(
    fc.record({
      assigned: fc.integer({ min: 0, max: 200_000 }),
      essential: fc.boolean(),
      status: fc.constantFrom<JobSpec["status"]>("active", "active", "active", "paused", "finished"),
      saveUp: fc.boolean(),
    }),
    { maxLength: 7 },
  ),
  /** Money in less what is assigned, so a month can have money without a job, be exact, or be over-assigned. */
  slack: fc.integer({ min: -200_000, max: 300_000 }),
  amount: fc.integer({ min: 0, max: 700_000 }),
  excluded: fc.array(fc.nat(), { maxLength: 3 }),
});
type Scenario = typeof scenario extends fc.Arbitrary<infer S> ? S : never;

function build({ jobs, slack }: Scenario): { readonly facts: Facts; readonly ids: readonly JobId[] } {
  const b = factsBuilder({ planStart: "2026-10" });
  b.group();
  b.buffer({ monthly: kr(0) });
  b.budgetMonth("2026-10", "closed");
  b.budgetMonth("2026-11", "open");
  const ids = jobs.map((j) => {
    const common = { essential: j.essential, status: j.status };
    const id = j.saveUp ? b.saveUpJob({ ...common, target: monthlySaving(money(1)) }) : b.spendJob({ ...common, plan: setAmount(money(1)) });
    if (j.assigned > 0) b.assign("2026-11", id, money(j.assigned));
    return id;
  });
  const moneyIn = Math.max(0, jobs.reduce((sum, j) => sum + j.assigned, 0) + slack);
  if (moneyIn > 0) b.income({ date: "2026-10-20", amount: money(moneyIn), fundsMonth: "2026-11" });
  return { facts: b.facts(), ids };
}

const eligible = (spec: JobSpec, excluded: boolean): boolean => spec.status === "active" && !spec.essential && !excluded && spec.assigned > 0;

function optionsOf(s: Scenario): { readonly facts: Facts; readonly ids: readonly JobId[]; readonly found: FundingOptions; readonly exclude: readonly JobId[] } {
  const { facts, ids } = build(s);
  const exclude = s.excluded.flatMap((n) => (ids.length === 0 ? [] : [ids[n % ids.length] as JobId]));
  return { facts, ids, exclude, found: fundingOptions(facts, { month: november, amount: money(s.amount), exclude }, today) };
}

describe("funding options, for any month", () => {
  it("never take from an essential, paused, finished or excluded job, never more than a job has assigned, and never from one job twice", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { ids, exclude, found } = optionsOf(s);
        for (const option of found.options) {
          const sources = option.moves.map((m) => m.from);
          expect(new Set(sources).size).toBe(sources.length);
          for (const move of option.moves) {
            const index = ids.indexOf(move.from);
            const spec = s.jobs[index] as JobSpec;
            expect(index).toBeGreaterThanOrEqual(0);
            expect(eligible(spec, exclude.includes(move.from))).toBe(true);
            expect(move.amount).toBeGreaterThan(0);
            expect(move.amount).toBeLessThanOrEqual(spec.assigned);
          }
        }
      }),
    );
  });

  it("cover the amount exactly: the money with no job and the shares add up to it, in every option", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { found } = optionsOf(s);
        for (const option of found.options) {
          expect(option.fromUnassigned).toBe(Math.min(s.amount, found.unassigned));
          expect(option.fromUnassigned + option.moves.reduce((sum, m) => sum + m.amount, 0)).toBe(s.amount);
        }
      }),
    );
  });

  it("report the shortfall exactly, and offer nothing exactly when there is one", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { found, ids, exclude } = optionsOf(s);
        const givable = s.jobs.reduce((sum, j, i) => sum + (eligible(j, exclude.includes(ids[i] as JobId)) ? j.assigned : 0), 0);
        expect(found.givable).toBe(givable);
        expect(found.shortfall).toBe(Math.max(0, s.amount - found.unassigned - givable));
        expect(found.options.length === 0).toBe(found.shortfall > 0);
      }),
    );
  });

  it("offer a single job exactly when it can cover the rest, and a split only across two or more jobs", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { found, ids, exclude } = optionsOf(s);
        const rest = s.amount - found.unassigned;
        if (rest <= 0 || found.shortfall > 0) return;
        const singles = found.options.filter((o) => o.kind === "single").map((o) => o.moves[0]?.from);
        const able = s.jobs.flatMap((j, i) => (eligible(j, exclude.includes(ids[i] as JobId)) && j.assigned >= rest ? [ids[i]] : []));
        expect(new Set(singles)).toEqual(new Set(able));
        for (const option of found.options) if (option.kind === "split") expect(option.moves.length).toBeGreaterThanOrEqual(2);
      }),
    );
  });

  it("share a split evenly: the jobs that are not at what they have all give the same, but the first of them, which gives the remainder", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { found, facts } = optionsOf(s);
        const split = found.options.find((o) => o.kind === "split");
        if (split === undefined) return;
        const figures = computeFigures(facts, today);
        const open = split.moves.filter((m) => m.amount < jobIn(figures, m.from, "2026-11").assigned.amount);
        const [first, ...others] = open;
        for (const m of others) expect(m.amount).toBe(others[0]?.amount);
        if (first !== undefined && others[0] !== undefined) expect(first.amount).toBeGreaterThanOrEqual(others[0].amount);
      }),
    );
  });

  it("make commands the app accepts for a new job, that give it the amount and use up exactly the money with no job", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { found, facts } = optionsOf(s);
        const before = monthIn(computeFigures(facts, today), "2026-11").unassigned;
        const group = [...facts.groups.keys()][0];
        const account = [...facts.accounts.keys()][0];
        if (group === undefined || account === undefined) throw new Error("the household has no group or account");
        const add: Command = {
          kind: "addJob",
          job: { id: newJob, name: "New", groupId: group, status: "active", accountId: account, essential: false, opening: money(0), kind: "spend", keepsMoney: false, plan: { mode: "setAmount", amount: money(0) }, seasonality: "irregular" },
        };
        for (const option of found.options) {
          const result = apply(facts, { kind: "batch", commands: [add, ...fundingCommands(option, newJob, november)] }, { asOf: today });
          if (!result.ok) throw new Error(`refused: ${result.refusal.message}`);
          const figures = computeFigures(result.facts, today);
          expect(jobIn(figures, newJob, "2026-11").assigned.amount).toBe(s.amount);
          expect(signed(monthIn(figures, "2026-11").unassigned)).toBe(signed(before) - option.fromUnassigned);
        }
      }),
    );
  });
});
