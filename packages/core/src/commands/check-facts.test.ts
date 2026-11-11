import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Facts, type Job, makeSplit } from "../facts.ts";
import { accountId, agreementId, jobId, personId, ruleId } from "../ids.ts";
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
  agreementPersonNotAdult: () => household((b) => b.agreement({ person: b.person({ kind: "child" }), amount: kr(1_000) })),
  agreementAccountNotShared: () => household((b) => b.agreement({ accountId: b.account({ scope: "paidInto" }), amount: kr(1_000) })),
  agreementAmountNotPositive: () => household((b) => b.agreement({ amount: kr(0) })),
  agreementDayOutOfRange: () => household((b) => b.agreement({ amount: kr(1_000), day: 29 })),
  agreementEndsBeforeStart: () => household((b) => b.agreement({ amount: kr(1_000), from: "2026-10", to: "2026-09" })),
  transferSameJob: () => household((b) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: bufferOf(b), amount: kr(100) })),
  transferAmountNotPositive: () => household((b) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: b.saveUpJob({ target: monthlySaving(kr(100)) }), amount: kr(0) })),
  transferMonthNotStarted: () => household((b) => b.bucketTransfer({ month: "2026-11", from: bufferOf(b), to: b.saveUpJob({ target: monthlySaving(kr(100)) }), amount: kr(100) })),
  transferJobKeepsNoMoney: () => household((b, food) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: food, amount: kr(100) })),
  transferOutOfBufferNeedsReason: () => household((b) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: b.saveUpJob({ target: monthlySaving(kr(100)) }), amount: kr(100), reason: "  " })),
  incomeAgreementNotContribution: () => household((b) => b.income({ date: "2026-10-05", amount: kr(9_000), fundsMonth: "2026-11", source: "other", agreement: b.agreement({ amount: kr(9_000) }) })),
};

/** The household's buffer, made by `household`. */
function bufferOf(b: FactsBuilder): ReturnType<FactsBuilder["buffer"]> {
  const found = [...b.facts().jobs.values()].find((job) => job.kind === "saveUp" && job.role === "buffer");
  if (found === undefined) throw new Error("no buffer");
  return found.id;
}

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


describe("contribution agreements and bucket transfers", () => {
  const sound = (add: (b: FactsBuilder, food: ReturnType<FactsBuilder["spendJob"]>) => void) => household(add);
  const codes = (facts: Facts) => checkFacts(facts).map((v) => `${v.code}:${v.table}.${v.field ?? ""}`);

  it("accepts an agreement, a transfer and an income that names its agreement when all of them fit", () => {
    const facts = sound((b) => {
      const agreement = b.agreement({ amount: kr(9_000), from: "2026-10", to: "2027-09", day: 28 });
      b.income({ date: "2026-10-05", amount: kr(9_000), fundsMonth: "2026-11", agreement });
      b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: b.saveUpJob({ target: monthlySaving(kr(100)) }), amount: kr(100), reason: "Seed Holiday" });
    });
    expect(checkFacts(facts)).toEqual([]);
  });

  it("accepts the first and the last usual day, and an agreement that ends in the month it starts", () => {
    expect(checkFacts(sound((b) => { b.agreement({ amount: kr(1), day: 1, from: "2026-10", to: "2026-10" }); b.agreement({ amount: kr(1), day: 28 }); }))).toEqual([]);
  });

  it("finds a day of 0 and a day with a fraction", () => {
    expect(codes(sound((b) => b.agreement({ amount: kr(1), day: 0 })))).toEqual(["agreementDayOutOfRange:contributionAgreements.day"]);
    expect(codes(sound((b) => b.agreement({ amount: kr(1), day: 15.5 })))).toEqual(["agreementDayOutOfRange:contributionAgreements.day"]);
  });

  it("finds an agreement whose person or account doesn't exist", () => {
    const base = sound((b) => b.agreement({ amount: kr(1_000) }));
    const [agreement] = [...base.contributionAgreements.values()];
    if (agreement === undefined) throw new Error("no agreement");
    const row = (change: object) => ({ ...base, contributionAgreements: new Map([[agreement.id, { ...agreement, ...change }]]) });
    expect(codes(row({ personId: personId(testId(999_999)) }))).toEqual(["missingReference:contributionAgreements.personId"]);
    expect(codes(row({ accountId: accountId(testId(999_999)) }))).toEqual(["missingReference:contributionAgreements.accountId"]);
  });

  it("finds a transfer whose jobs don't exist, naming the side", () => {
    const base = sound((b) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: bufferOf(b), amount: kr(1) }));
    const [transfer] = [...base.bucketTransfers.values()];
    if (transfer === undefined) throw new Error("no transfer");
    const row = (change: object) => ({ ...base, bucketTransfers: new Map([[transfer.id, { ...transfer, ...change }]]) });
    expect(codes(row({ to: jobId(testId(999_999)) }))).toEqual(["missingReference:bucketTransfers.to"]);
    expect(codes(row({ from: jobId(testId(999_999)) }))).toEqual(["missingReference:bucketTransfers.from"]);
  });

  it("finds a transfer into or out of a job that doesn't keep its money, whichever side", () => {
    const into = sound((b, food) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: food, amount: kr(100) }));
    const out = sound((b, food) => b.bucketTransfer({ month: "2026-10", from: food, to: bufferOf(b), amount: kr(100) }));
    expect(codes(into)).toEqual(["transferJobKeepsNoMoney:bucketTransfers.to"]);
    expect(codes(out)).toEqual(["transferJobKeepsNoMoney:bucketTransfers.from"]);
    const kept = sound((b) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: b.spendJob({ plan: evenOut(kr(500), "2026-10") }), amount: kr(100) }));
    expect(codes(kept)).toEqual([]);
  });

  it("asks for a reason only when the money leaves the buffer", () => {
    const withoutReason = (from: "buffer" | "other") =>
      sound((b) => {
        const other = b.saveUpJob({ target: monthlySaving(kr(100)) });
        b.bucketTransfer({ month: "2026-10", from: from === "buffer" ? bufferOf(b) : other, to: from === "buffer" ? other : bufferOf(b), amount: kr(100), reason: "" });
      });
    expect(codes(withoutReason("buffer"))).toEqual(["transferOutOfBufferNeedsReason:bucketTransfers.reason"]);
    expect(codes(withoutReason("other"))).toEqual([]);
  });

  it("finds an income that names an agreement that doesn't exist", () => {
    const facts = sound((b) => b.income({ date: "2026-10-05", amount: kr(9_000), fundsMonth: "2026-11", agreement: agreementId(testId(999_999)) }));
    expect(codes(facts)).toEqual(["missingReference:transactions.treatment.agreement"]);
  });

  it("finds an amount with a fraction in an agreement and a transfer", () => {
    expect(codes(sound((b) => b.agreement({ amount: 1000.5 as Money })))).toEqual(["notWholeMoney:contributionAgreements.amount"]);
    expect(codes(sound((b) => b.bucketTransfer({ month: "2026-10", from: bufferOf(b), to: b.saveUpJob({ target: monthlySaving(kr(1)) }), amount: 10.5 as Money })))).toContain("notWholeMoney:bucketTransfers.amount");
  });
});
