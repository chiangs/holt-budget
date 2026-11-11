import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import { month } from "../dates.ts";
import type { ContributionAgreement, Facts } from "../facts.ts";
import { accountId, agreementId, personId } from "../ids.ts";
import { accepted, changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { type Command, apply, commit } from "./apply.ts";

const h = commandHousehold();
const run = (command: Command, facts: Facts = h.facts) => apply(facts, command, { asOf: today });
const newId = agreementId(testId(830_001));

const agreement: ContributionAgreement = { id: newId, personId: h.people.alex, accountId: h.accounts.savings, amount: kr(3_000), day: 25, from: month("2026-11") };
const add = (change: Partial<ContributionAgreement> = {}) => run({ kind: "addAgreement", agreement: { ...agreement, ...change } });
const refusalOf = (result: ReturnType<typeof run>) => (result.ok ? "accepted" : result.refusal.code);

describe("adding an agreement", () => {
  it("stores what was given, with or without a last month", () => {
    expect(accepted(add()).contributionAgreements.get(newId)).toEqual(agreement);
    const ending = { ...agreement, to: month("2027-10") };
    expect(accepted(add({ to: month("2027-10") })).contributionAgreements.get(newId)).toEqual(ending);
  });

  it("is refused for a person who isn't there, and for a child", () => {
    expect(refusalOf(add({ personId: personId(testId(999_999)) }))).toBe("personNotFound");
    expect(refusalOf(add({ personId: h.people.mia }))).toBe("personNotAdult");
  });

  it("is refused for an account that isn't there, and for an account the household only pays into", () => {
    expect(refusalOf(add({ accountId: accountId(testId(999_999)) }))).toBe("accountNotFound");
    expect(refusalOf(add({ accountId: h.accounts.child }))).toBe("accountNotShared");
  });

  it("is refused for an amount that is zero or less", () => {
    expect(refusalOf(add({ amount: kr(0) }))).toBe("amountNotPositive");
    expect(refusalOf(add({ amount: kr(-1) }))).toBe("amountNotPositive");
    expect(refusalOf(add({ amount: 1 as ContributionAgreement["amount"] }))).toBe("accepted");
  });

  it("accepts the first and the last day the money can usually land, and refuses a day outside them", () => {
    expect([1, 15, 28].map((day) => refusalOf(add({ day })))).toEqual(["accepted", "accepted", "accepted"]);
    expect([0, 29, 31, -1, 2.5].map((day) => refusalOf(add({ day })))).toEqual(Array(5).fill("dayOutOfRange"));
  });

  it("is refused when it ends before it starts, and accepted when it ends in its first month", () => {
    expect(refusalOf(add({ to: month("2026-10") }))).toBe("agreementEndsBeforeStart");
    expect(refusalOf(add({ to: month("2026-11") }))).toBe("accepted");
  });

  it("is refused for an ID that is taken", () => {
    expect(refusalOf(run({ kind: "addAgreement", agreement: { ...agreement, id: h.agreements.contribution } }))).toBe("idTaken");
  });
});

describe("changing an agreement", () => {
  const change = (changes: Extract<Command, { kind: "changeAgreement" }>["changes"], facts: Facts = h.facts) => run({ kind: "changeAgreement", agreementId: h.agreements.contribution, changes }, facts);
  const before = h.facts.contributionAgreements.get(h.agreements.contribution) as ContributionAgreement;

  it("changes the fields it names and keeps the rest, including who pays and from which month", () => {
    const after = accepted(change({ amount: kr(9_500), day: 27, accountId: h.accounts.savings })).contributionAgreements.get(h.agreements.contribution);
    expect(after).toEqual({ ...before, amount: kr(9_500), day: 27, accountId: h.accounts.savings });
  });

  it("ends an agreement by setting its last month, and runs it on again with null", () => {
    const ended = accepted(change({ to: month("2027-06") }));
    expect(ended.contributionAgreements.get(h.agreements.contribution)).toEqual({ ...before, to: month("2027-06") });
    const running = accepted(change({ to: null }, ended));
    expect(running.contributionAgreements.get(h.agreements.contribution)).toEqual(before);
    expect(Object.hasOwn(running.contributionAgreements.get(h.agreements.contribution) ?? {}, "to")).toBe(false);
  });

  it("keeps an ended agreement, and the income that names it", () => {
    const paid = commandHouseholdWithPaidContribution();
    const ended = accepted(run({ kind: "changeAgreement", agreementId: paid.agreement, changes: { to: month("2026-11") } }, paid.facts));
    expect(ended.contributionAgreements.has(paid.agreement)).toBe(true);
    expect([...ended.transactions.values()].some((t) => t.treatment.kind === "income" && t.treatment.agreement === paid.agreement)).toBe(true);
  });

  it("is refused for an agreement that isn't there", () => {
    expect(refusalOf(run({ kind: "changeAgreement", agreementId: newId, changes: { day: 3 } }))).toBe("agreementNotFound");
  });

  it("is refused for what an added agreement would be refused for", () => {
    expect(refusalOf(change({ amount: kr(0) }))).toBe("amountNotPositive");
    expect(refusalOf(change({ day: 29 }))).toBe("dayOutOfRange");
    expect(refusalOf(change({ accountId: h.accounts.child }))).toBe("accountNotShared");
    expect(refusalOf(change({ accountId: accountId(testId(999_999)) }))).toBe("accountNotFound");
    expect(refusalOf(change({ to: month("2026-09") }))).toBe("agreementEndsBeforeStart");
  });

  it("can be undone, which restores the agreement exactly", () => {
    const changed = commit(h.facts, emptyChangeLog(), { kind: "changeAgreement", agreementId: h.agreements.contribution, changes: { amount: kr(1), to: month("2027-01") } }, changeMeta(1), { asOf: today });
    if (!changed.ok) throw new Error("refused");
    const undone = undo(changed.facts, changed.log);
    expect(undone.ok && undone.facts).toEqual(h.facts);
  });
});

function commandHouseholdWithPaidContribution() {
  const household = commandHousehold();
  const income = household.transactions.salary;
  const row = household.facts.transactions.get(income);
  if (row === undefined || row.treatment.kind !== "income") throw new Error("the household's salary is income");
  const agreement = household.agreements.contribution;
  const facts: Facts = { ...household.facts, transactions: new Map([...household.facts.transactions, [income, { ...row, treatment: { ...row.treatment, agreement } }]]) };
  return { facts, agreement };
}

describe("income that names an agreement", () => {
  it("is accepted for a contribution, and refused for any other source, and for an agreement that isn't there", () => {
    const named = (source: "contribution" | "recurring" | "other", agreement = h.agreements.contribution) =>
      run({ kind: "setTreatment", transactionId: h.transactions.salary, treatment: { kind: "income", fundsMonth: month("2026-11"), source, agreement } });
    expect(refusalOf(named("contribution"))).toBe("accepted");
    expect(accepted(named("contribution")).transactions.get(h.transactions.salary)?.treatment).toEqual({ kind: "income", fundsMonth: month("2026-11"), source: "contribution", agreement: h.agreements.contribution });
    for (const source of ["recurring", "other"] as const) {
      const result = named(source);
      expect(!result.ok && result.refusal.code === "breaksFacts" && result.refusal.violations.map((v) => v.code)).toEqual(["incomeAgreementNotContribution"]);
    }
    const missing = named("contribution", agreementId(testId(999_999)));
    expect(!missing.ok && missing.refusal.code === "breaksFacts" && missing.refusal.violations).toEqual([{ code: "missingReference", table: "transactions", key: h.transactions.salary, field: "treatment.agreement" }]);
  });

  it("stops naming the agreement when the family sets the treatment again without it", () => {
    const paid = commandHouseholdWithPaidContribution();
    const after = accepted(run({ kind: "setTreatment", transactionId: h.transactions.salary, treatment: { kind: "income", fundsMonth: month("2026-11"), source: "contribution" } }, paid.facts));
    expect(Object.hasOwn(after.transactions.get(h.transactions.salary)?.treatment ?? {}, "agreement")).toBe(false);
  });
});
