import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Facts, type Job, makeSplit } from "../facts.ts";
import { accountId, jobId, ruleId } from "../ids.ts";
import type { Money } from "../money.ts";
import { ruleOf, withRules, withTransaction } from "../rules/rule-fixtures.ts";
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

describe("transactions before the plan start (decision 6 of 0047)", () => {
  const codes = (facts: Facts) => checkFacts(facts).map((v) => v.code);

  it("accepts income booked before the plan start when it funds a month from the plan start on", () => {
    expect(codes(household((b) => b.income({ date: "2026-09-20", amount: kr(9_000), fundsMonth: "2026-10" })))).toEqual([]);
    expect(codes(household((b) => b.income({ date: "2026-09-20", amount: kr(9_000), fundsMonth: "2027-03" })))).toEqual([]);
  });

  it("finds income booked before the plan start that funds an earlier month", () => {
    expect(codes(household((b) => b.income({ date: "2026-09-20", amount: kr(9_000), fundsMonth: "2026-09" })))).toEqual(["notHistoryBeforePlanStart"]);
    expect(codes(household((b) => b.income({ date: "2026-09-20", amount: kr(9_000), fundsMonth: "2026-07" })))).toEqual(["notHistoryBeforePlanStart"]);
  });

  it.each([
    ["needs you", (b: FactsBuilder) => b.needsYou({ date: "2026-09-30", amount: kr(-100) })],
    ["a transfer", (b: FactsBuilder) => b.unmatchedTransfer({ date: "2026-09-30", amount: kr(-100) })],
    ["a split", (b: FactsBuilder, food: ReturnType<FactsBuilder["spendJob"]>) => b.spend({ date: "2026-09-30", amount: kr(-100), jobId: food })],
  ])("still finds %s booked before the plan start", (_, add) => {
    expect(codes(household(add))).toEqual(["notHistoryBeforePlanStart"]);
  });

  it("never lets income from the plan start on be history, and history from it on is still a fault", () => {
    expect(codes(household((b) => b.income({ date: "2026-10-01", amount: kr(9_000), fundsMonth: "2026-11" })))).toEqual([]);
    expect(codes(household((b) => b.history({ date: "2026-10-01", amount: kr(-100) })))).toEqual(["historyFromPlanStart"]);
  });

  it("treats the first day of the plan start's month as the plan start, and the last day before it as before", () => {
    expect(codes(household((b) => b.needsYou({ date: "2026-10-01", amount: kr(-100) })))).toEqual([]);
    expect(codes(household((b) => b.needsYou({ date: "2026-09-30", amount: kr(-100) })))).toEqual(["notHistoryBeforePlanStart"]);
  });
});

describe("references from rules and from the transactions they sorted", () => {
  const base = household(() => {});
  const everyday = [...base.accounts.keys()][0] as ReturnType<typeof accountId>;
  const food = [...base.jobs.values()].find((j) => j.kind === "spend")?.id as ReturnType<typeof jobId>;
  const kiwi = ruleOf({ n: 1, counterparty: "Kiwi", accountId: everyday, result: { kind: "job", jobId: food } });

  it("accepts a rule that names a job and an account that exist", () => {
    expect(checkFacts(withRules(base, kiwi))).toEqual([]);
  });

  it("finds a rule that gives a job that doesn't exist, in a single job or in a share", () => {
    const missing = jobId(testId(999_999));
    const single = withRules(base, { ...kiwi, result: { kind: "job", jobId: missing } });
    const shared = withRules(base, { ...kiwi, result: { kind: "split", shares: [{ jobId: food, weight: 1 }, { jobId: missing, weight: 1 }] } });
    for (const facts of [single, shared]) expect(checkFacts(facts)).toEqual([{ code: "missingReference", table: "rules", key: kiwi.id, field: "result" }]);
  });

  it("finds a rule that names an account that doesn't exist", () => {
    const facts = withRules(base, { ...kiwi, match: { counterparty: "Kiwi", accountId: accountId(testId(999_999)) } });
    expect(checkFacts(facts)).toEqual([{ code: "missingReference", table: "rules", key: kiwi.id, field: "match.accountId" }]);
  });

  it("finds a transaction that names a rule that doesn't exist", () => {
    const facts = household((b) => b.needsYou({ date: "2026-10-05", amount: kr(-100) }));
    const [transaction] = [...facts.transactions.values()];
    if (transaction === undefined) throw new Error("no transaction");
    expect(checkFacts(withTransaction(facts, transaction.id, { ruleId: ruleId(testId(999_998)) }))).toEqual([{ code: "missingReference", table: "transactions", key: transaction.id, field: "ruleId" }]);
    expect(checkFacts(withTransaction(withRules(facts, kiwi), transaction.id, { ruleId: kiwi.id }))).toEqual([]);
  });
});

