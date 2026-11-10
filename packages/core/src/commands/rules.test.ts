import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import { month } from "../dates.ts";
import type { Facts, RuleResult } from "../facts.ts";
import { accountId, jobId, ruleId, transactionId } from "../ids.ts";
import { money } from "../money.ts";
import { ruleOf, withRules, withTransaction } from "../rules/rule-fixtures.ts";
import { accepted, changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { type ApplyResult, type Command, apply, commit } from "./apply.ts";
import { checkFacts } from "./check-facts.ts";
import { ruleMessages } from "./rules.messages.ts";

const h = commandHousehold();
const run = (command: Command, facts: Facts = h.facts): ApplyResult => apply(facts, command, { asOf: today });
const toFood: RuleResult = { kind: "job", jobId: h.jobs.food };
const kiwi = ruleOf({ n: 1, counterparty: "Kiwi", result: toFood });
const withKiwi = withRules(h.facts, kiwi);

const refusedWith = (result: ApplyResult): string | null => (result.ok ? null : result.refusal.code);

describe("addRule", () => {
  it("stores the rule exactly as given, in a household that stays sound", () => {
    const rule = ruleOf({ n: 2, counterparty: "Rema 1000", accountId: h.accounts.everyday, min: kr(-2_000), max: kr(-1), priority: 4, origin: "learned", result: toFood });
    const after = accepted(run({ kind: "addRule", rule }));
    expect(after.rules.get(rule.id)).toEqual(rule);
    expect(after.rules.size).toBe(1);
    expect(checkFacts(after)).toEqual([]);
  });

  it("stores a split by weights", () => {
    const rule = ruleOf({ n: 2, counterparty: "Folksam", result: { kind: "split", shares: [{ jobId: h.jobs.food, weight: 2 }, { jobId: h.jobs.holiday, weight: 1 }] } });
    expect(accepted(run({ kind: "addRule", rule })).rules.get(rule.id)).toEqual(rule);
  });

  it("changes nothing but the rules", () => {
    const result = run({ kind: "addRule", rule: kiwi });
    expect(result.ok && result.patch).toEqual([{ table: "rules", key: kiwi.id, before: null, after: kiwi }]);
  });

  it("can be undone", () => {
    const done = commit(h.facts, emptyChangeLog(), { kind: "addRule", rule: kiwi }, changeMeta(1), { asOf: today });
    if (!done.ok) throw new Error("refused");
    const undone = undo(done.facts, done.log);
    expect(undone.ok && undone.facts).toEqual(h.facts);
  });
});

const unknown = testId(999_999);

/** One way to reach each code the rules and the plan start own. The type makes a new code fail to compile until it has a case. */
const reach: { readonly [C in keyof typeof ruleMessages]: () => ApplyResult } = {
  ruleNotFound: () => run({ kind: "changeRule", ruleId: ruleId(unknown), changes: { priority: 1 } }),
  ruleCounterpartyMissing: () => run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "   ", result: toFood }) }),
  ruleWeightNotPositive: () => run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Folksam", result: { kind: "split", shares: [{ jobId: h.jobs.food, weight: 0 }] } }) }),
  ruleRangeBackwards: () => run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Kiwi", min: kr(-1), max: kr(-100), result: toFood }) }),
  planStartMonthOpened: () => run({ kind: "setPlanStart", planStart: month("2026-09") }),
};

describe("refusals", () => {
  it.each(Object.keys(reach) as (keyof typeof ruleMessages)[])("the app refuses with %s", (code) => {
    expect(refusedWith(reach[code]())).toBe(code);
  });

  it("refuses a rule with the ID of a rule that exists", () => {
    expect(refusedWith(run({ kind: "addRule", rule: { ...kiwi, priority: 9 } }, withKiwi))).toBe("idTaken");
  });

  it.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53]])("refuses a share with the weight %s", (weight) => {
    const result: RuleResult = { kind: "split", shares: [{ jobId: h.jobs.food, weight: 1 }, { jobId: h.jobs.holiday, weight }] };
    expect(refusedWith(run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Folksam", result }) }))).toBe("ruleWeightNotPositive");
  });

  it("refuses an empty counterparty of any kind of whitespace", () => {
    for (const counterparty of ["", " ", "\t\n"]) expect(refusedWith(run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty, result: toFood }) }))).toBe("ruleCounterpartyMissing");
  });

  it("refuses a job the app can't find, in a single job or in any share", () => {
    const missing = jobId(unknown);
    expect(refusedWith(run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Kiwi", result: { kind: "job", jobId: missing } }) }))).toBe("jobNotFound");
    const result: RuleResult = { kind: "split", shares: [{ jobId: h.jobs.food, weight: 1 }, { jobId: missing, weight: 1 }] };
    expect(refusedWith(run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Kiwi", result }) }))).toBe("jobNotFound");
  });

  it("refuses an account the app can't find", () => {
    expect(refusedWith(run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Kiwi", accountId: accountId(unknown), result: toFood }) }))).toBe("accountNotFound");
  });

  it("accepts a range whose ends are equal, and a range with one end", () => {
    expect(run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Kiwi", min: kr(-100), max: kr(-100), result: toFood }) }).ok).toBe(true);
    expect(run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "Kiwi", min: kr(100), result: toFood }) }).ok).toBe(true);
  });

  it("leaves the facts untouched when it refuses", () => {
    const before = JSON.stringify([...withKiwi.rules]);
    run({ kind: "addRule", rule: ruleOf({ n: 2, counterparty: "", result: toFood }) }, withKiwi);
    expect(JSON.stringify([...withKiwi.rules])).toBe(before);
  });
});

describe("changeRule", () => {
  const rule = ruleOf({ n: 1, counterparty: "Kiwi", accountId: h.accounts.everyday, min: kr(-500), max: kr(-1), priority: 2, origin: "learned", result: toFood });
  const facts = withRules(h.facts, rule);

  it("changes only what it names", () => {
    const after = accepted(run({ kind: "changeRule", ruleId: rule.id, changes: { priority: 7 } }, facts)).rules.get(rule.id);
    expect(after).toEqual({ ...rule, priority: 7 });
  });

  it("replaces the whole match and the whole result", () => {
    const match = { counterparty: "Rema 1000" };
    const result: RuleResult = { kind: "job", jobId: h.jobs.holiday };
    const after = accepted(run({ kind: "changeRule", ruleId: rule.id, changes: { match, result } }, facts)).rules.get(rule.id);
    expect(after).toEqual({ ...rule, match, result });
  });

  it("keeps the ID and the origin", () => {
    const after = accepted(run({ kind: "changeRule", ruleId: rule.id, changes: { priority: 0 } }, facts)).rules.get(rule.id);
    expect(after).toMatchObject({ id: rule.id, origin: "learned" });
  });

  it("holds the changed rule to the same limits as a new rule", () => {
    const change = (changes: Extract<Command, { kind: "changeRule" }>["changes"]) => refusedWith(run({ kind: "changeRule", ruleId: rule.id, changes }, facts));
    expect(change({ match: { counterparty: " " } })).toBe("ruleCounterpartyMissing");
    expect(change({ match: { counterparty: "Kiwi", min: kr(-1), max: kr(-9) } })).toBe("ruleRangeBackwards");
    expect(change({ result: { kind: "split", shares: [{ jobId: h.jobs.food, weight: -3 }] } })).toBe("ruleWeightNotPositive");
    expect(change({ result: { kind: "job", jobId: jobId(unknown) } })).toBe("jobNotFound");
    expect(change({ match: { counterparty: "Kiwi", accountId: accountId(unknown) } })).toBe("accountNotFound");
  });

  it("does not touch a transaction the rule once sorted", () => {
    const sorted = withTransaction(facts, h.transactions.shopping, { ruleId: rule.id });
    const after = accepted(run({ kind: "changeRule", ruleId: rule.id, changes: { result: { kind: "job", jobId: h.jobs.holiday } } }, sorted));
    expect(after.transactions.get(h.transactions.shopping)).toEqual(sorted.transactions.get(h.transactions.shopping));
  });
});

describe("deleteRule", () => {
  const sorted = withTransaction(withKiwi, h.transactions.shopping, { ruleId: kiwi.id });

  it("removes the rule", () => {
    expect(accepted(run({ kind: "deleteRule", ruleId: kiwi.id }, withKiwi)).rules.size).toBe(0);
  });

  it("lets go of the rule on each transaction it sorted, and keeps their treatments", () => {
    const after = accepted(run({ kind: "deleteRule", ruleId: kiwi.id }, sorted));
    const shopping = after.transactions.get(h.transactions.shopping);
    expect(shopping).toEqual({ ...sorted.transactions.get(h.transactions.shopping), ruleId: undefined });
    expect(shopping && "ruleId" in shopping).toBe(false);
    expect(checkFacts(after)).toEqual([]);
  });

  it("leaves transactions that another rule sorted", () => {
    const other = ruleOf({ n: 2, counterparty: "Rema 1000", result: toFood });
    const facts = withTransaction(withRules(sorted, other), h.transactions.salary, { ruleId: other.id });
    const after = accepted(run({ kind: "deleteRule", ruleId: kiwi.id }, facts));
    expect(after.transactions.get(h.transactions.salary)?.ruleId).toBe(other.id);
  });

  it("refuses a rule the app can't find", () => {
    expect(refusedWith(run({ kind: "deleteRule", ruleId: ruleId(unknown) }))).toBe("ruleNotFound");
  });

  it("can be undone, and puts back the rule and the transactions it sorted", () => {
    const done = commit(sorted, emptyChangeLog(), { kind: "deleteRule", ruleId: kiwi.id }, changeMeta(1), { asOf: today });
    if (!done.ok) throw new Error("refused");
    const undone = undo(done.facts, done.log);
    expect(undone.ok && undone.facts).toEqual(sorted);
  });
});

describe("a rule and the rest of the facts", () => {
  it("stops the app deleting a job a rule gives, and says why", () => {
    const rule = ruleOf({ n: 1, counterparty: "Hobby shop", result: { kind: "job", jobId: h.jobs.unused } });
    const result = run({ kind: "deleteJob", jobId: h.jobs.unused }, withRules(h.facts, rule));
    expect(!result.ok && result.refusal).toMatchObject({ code: "jobInUse" });
  });

  it("stops the app recording a transaction that names a rule that doesn't exist", () => {
    const transaction = { id: transactionId(unknown), accountId: h.accounts.everyday, bookingDate: today, amount: money(-100), description: "Kiwi", treatment: { kind: "needsYou" } as const, ruleId: ruleId(unknown) };
    const result = run({ kind: "recordTransaction", transaction });
    expect(!result.ok && result.refusal).toMatchObject({ code: "breaksFacts", violations: [{ code: "missingReference", table: "transactions", field: "ruleId" }] });
  });
});
