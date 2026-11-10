import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Facts, type Job, makeSplit } from "../facts.ts";
import { jobId } from "../ids.ts";
import type { Money } from "../money.ts";
import { arbitraryScript } from "../testing/arbitrary-commands.ts";
import { commandHousehold } from "../testing/command-household.ts";
import { type FactsBuilder, evenOut, factsBuilder, kr, monthlySaving, setAmount, testId } from "../testing/facts-builder.ts";
import { type ViolationCode, checkFacts } from "./check-facts.ts";

/** A sound household with a buffer and a food job, planned from October 2026 with October open, plus whatever `add` makes. */
function household(add: (b: FactsBuilder, food: ReturnType<FactsBuilder["spendJob"]>) => void, options: { readonly buffer?: boolean } = {}): Facts {
  const b = factsBuilder({ planStart: "2026-10" });
  b.account({ name: "Everyday" });
  if (options.buffer ?? true) b.buffer({ monthly: kr(1_000) });
  const food = b.spendJob({ name: "Food", plan: setAmount(kr(5_000)) });
  b.budgetMonth("2026-10", "open");
  add(b, food);
  return b.facts();
}

function withJob(facts: Facts, job: Job): Facts {
  return { ...facts, jobs: new Map([...facts.jobs, [job.id, job]]) };
}

const cases: { readonly [C in ViolationCode]: () => Facts } = {
  missingReference: () => household((b) => b.assign("2026-10", jobId(testId(999_999)), kr(100))),
  noBuffer: () => household(() => {}, { buffer: false }),
  moreThanOneBuffer: () => household((b) => b.buffer({ name: "Second buffer", monthly: kr(500) })),
  bufferTarget: () => {
    const facts = household(() => {});
    const ordinary = [...facts.jobs.values()].find((j) => j.kind === "spend")!;
    return withJob(facts, { ...ordinary, id: jobId(testId(999_998)), kind: "saveUp", role: "ordinary", target: { kind: "bufferMonths", monthly: kr(100) } });
  },
  budgetMonthBeforePlanStart: () => household((b) => b.budgetMonth("2026-09", "closed")),
  assignmentBeforePlanStart: () => household((b, food) => b.assign("2026-09", food, kr(100))),
  assignmentInPlannedMonth: () => household((b, food) => b.assign("2026-11", food, kr(100))),
  historyFromPlanStart: () => household((b) => b.history({ date: "2026-10-01", amount: kr(-100) })),
  notHistoryBeforePlanStart: () => household((b) => b.needsYou({ date: "2026-09-30", amount: kr(-100) })),
  splitDoesNotAddUp: () => {
    let food = jobId(testId(1));
    const facts = household((b, f) => {
      food = f;
      b.spend({ date: "2026-10-05", amount: kr(-200), jobId: f });
    });
    const [t] = [...facts.transactions.values()];
    if (t === undefined) throw new Error("no transaction");
    return { ...facts, transactions: new Map([[t.id, { ...t, treatment: makeSplit(kr(-100), [{ jobId: food, amount: kr(-100) }]) }]]) };
  },
  payIntoNotPaidInto: () => household((b) => b.payIntoJob({ monthly: kr(500), payInto: b.account({ name: "Shared savings" }) })),
  evenOutKeepsMoney: () => household((b) => b.spendJob({ name: "Electricity", plan: evenOut(kr(3_050), "2026-10"), keepsMoney: false })),
  notWholeMoney: () => household((b, food) => b.assign("2026-10", food, 1.5 as Money)),
};

describe("checkFacts", () => {
  it("finds nothing wrong with a sound household", () => {
    expect(checkFacts(household(() => {}))).toEqual([]);
    expect(checkFacts(commandHousehold().facts)).toEqual([]);
  });

  it.each(Object.keys(cases) as ViolationCode[])("finds %s", (code) => {
    const found = checkFacts(cases[code]());
    expect([...new Set(found.map((v) => v.code))]).toEqual([code]);
  });

  it("names the row at fault", () => {
    const facts = household((b) => b.saveUpJob({ name: "Holiday", target: monthlySaving(kr(1_000)), opening: 0.5 as Money }));
    const holiday = [...facts.jobs.values()].find((j) => j.name === "Holiday")!;
    expect(checkFacts(facts)).toEqual([{ code: "notWholeMoney", table: "jobs", key: holiday.id, field: "opening" }]);
  });

  it("finds nothing wrong with any household the generated setup commands build", () => {
    fc.assert(
      fc.property(arbitraryScript({ minSteps: 1, maxSteps: 1 }), (script) => {
        expect(checkFacts(script.start)).toEqual([]);
      }),
    );
  });
});
