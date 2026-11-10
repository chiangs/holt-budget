import { describe, expect, it } from "vitest";
import { ruleOf, withRules } from "../rules/rule-fixtures.ts";
import { accepted, commandHousehold, today } from "../testing/command-household.ts";
import { apply } from "./apply.ts";

const h = commandHousehold();
const rule = ruleOf({ n: 3, counterparty: "Shop", result: { kind: "job", jobId: h.jobs.food } });
const facts = withRules(h.facts, rule);
const shopping = h.transactions.shopping;
const amount = h.facts.transactions.get(shopping)!.amount;

describe("setTreatment", () => {
  it("records the rule that gave the treatment, so the screen can say which rule applied", () => {
    const after = accepted(apply(facts, { kind: "setTreatment", transactionId: shopping, treatment: { kind: "split", allocations: [{ jobId: h.jobs.food, amount }] }, ruleId: rule.id }, { asOf: today }));
    expect(after.transactions.get(shopping)?.ruleId).toBe(rule.id);
  });

  it("forgets the rule when the family decides by hand", () => {
    const ruled = accepted(apply(facts, { kind: "setTreatment", transactionId: shopping, treatment: { kind: "split", allocations: [{ jobId: h.jobs.food, amount }] }, ruleId: rule.id }, { asOf: today }));
    const byHand = accepted(apply(ruled, { kind: "setTreatment", transactionId: shopping, treatment: { kind: "split", allocations: [{ jobId: h.jobs.unused, amount }] } }, { asOf: today }));
    expect(byHand.transactions.get(shopping)).not.toHaveProperty("ruleId");
  });
});

describe("setNote", () => {
  it("keeps the other fields and removes the note when it is emptied", () => {
    const noted = accepted(apply(h.facts, { kind: "setNote", transactionId: shopping, note: "Present" }, { asOf: today }));
    const cleared = accepted(apply(noted, { kind: "setNote", transactionId: shopping, note: "   " }, { asOf: today }));
    expect(cleared.transactions.get(shopping)).toEqual(h.facts.transactions.get(shopping));
  });
});
