import { describe, expect, it } from "vitest";
import { type Facts, type NeedsYouItem, type Rule, type TransactionId, apply, computeFigures, money } from "@holt/core";
import { kr } from "@holt/core/testing";
import { type NeedsYouRow, needsYouRows } from "./needsYou.model.ts";
import { decimalSeparator, planRule, ruleCommand, startingForm } from "./rule.model.ts";
import { aRuleId, buildWorld, today, withRule } from "./test-support.ts";

const world = buildWorld();
const rowsOf = (facts: Facts) => needsYouRows(facts, computeFigures(facts, today).needsYou);
const rows = rowsOf(world.facts);
const rowFor = (id: TransactionId, from: readonly NeedsYouRow[] = rows): NeedsYouRow => {
  const found = from.find((r) => r.id === id);
  if (found === undefined) throw new Error(`No row for ${id}`);
  return found;
};

const base = { id: aRuleId(1), facts: world.facts, currency: world.facts.household.values().next().value?.currency as never, separator: "." as const };
const plan = (id: TransactionId, form: Parameters<typeof planRule>[0]["form"], overrides: Partial<Parameters<typeof planRule>[0]> = {}) =>
  planRule({ ...base, row: rowFor(id), rows, form, ...overrides });
const okPlan = (id: TransactionId, form: Parameters<typeof planRule>[0]["form"], overrides: Partial<Parameters<typeof planRule>[0]> = {}) => {
  const result = plan(id, form, overrides);
  if (!result.ok) throw new Error(`Not ok: ${result.problem}`);
  return result;
};
const job = (jobId: ReturnType<typeof buildWorld>["jobs"]["phones"] | null) => ({ kind: "job", jobId }) as const;
const form = (more: Partial<ReturnType<typeof startingForm>> = {}) => ({ result: job(world.jobs.phones), onlyThisAccount: false, low: "", high: "", alsoSortOthers: true, ...more });

describe("startingForm", () => {
  it("starts from the suggestion's job", () => {
    expect(startingForm(rowFor(world.tx.lyse)).result).toEqual(job(world.jobs.electricity));
  });

  it("starts with no job chosen when there is no suggestion", () => {
    expect(startingForm(rowFor(world.tx.viaplay)).result).toEqual(job(null));
  });

  it("starts from the same split when the suggestion covers several jobs", () => {
    const [first] = world.figures.needsYou;
    if (first === undefined) throw new Error("no items");
    const item: NeedsYouItem = {
      ...first,
      suggestion: {
        kind: "sameAsLast",
        from: world.tx.lyseEarlier,
        command: { kind: "setTreatment", transactionId: first.transaction.id, treatment: { kind: "split", allocations: [{ jobId: world.jobs.electricity, amount: money(-700) }, { jobId: world.jobs.phones, amount: money(-300) }] } },
      },
    };
    const [row] = needsYouRows(world.facts, [item]);
    if (row === undefined) throw new Error("no row");
    expect(startingForm(row).result).toEqual({ kind: "sameSplit" });
    const made = planRule({ ...base, row, rows: [row], form: startingForm(row) });
    expect(made).toMatchObject({ ok: true, rule: { result: { kind: "split", shares: [{ weight: 700 }, { weight: 300 }] }, origin: "set" } });
  });
});

describe("the rule a decision would make", () => {
  it("matches the payee, gives the job, and is limited to money out for a payment", () => {
    const { rule } = okPlan(world.tx.viaplay, form());
    expect(rule.id).toBe(base.id);
    expect(rule.match).toEqual({ counterparty: "Viaplay Group", max: -1 });
    expect(rule.result).toEqual({ kind: "job", jobId: world.jobs.phones });
  });

  it("is limited to money in for a refund, so the purchases from the same shop stay out of it", () => {
    const { rule } = okPlan(world.tx.shopRefund, form({ result: job(world.jobs.food) }));
    expect(rule.match).toEqual({ counterparty: "Nærbutikken Fjord", min: 1 });
  });

  it("names the account only when the family asks", () => {
    expect(okPlan(world.tx.viaplay, form()).rule.match.accountId).toBeUndefined();
    expect(okPlan(world.tx.viaplay, form({ onlyThisAccount: true })).rule.match.accountId).toBe(world.accounts.everyday);
  });

  it("turns a typed range of whole kroner into bounds on the signed amount", () => {
    expect(okPlan(world.tx.viaplay, form({ low: "100", high: "500" })).rule.match).toMatchObject({ min: kr(-500), max: kr(-100) });
    expect(okPlan(world.tx.viaplay, form({ high: "500" })).rule.match).toMatchObject({ min: kr(-500), max: -1 });
    expect(okPlan(world.tx.viaplay, form({ low: "100" })).rule.match).toMatchObject({ max: kr(-100) });
    expect(okPlan(world.tx.shopRefund, form({ result: job(world.jobs.food), low: "10", high: "99,50" }), { separator: "," }).rule.match).toMatchObject({ min: kr(10), max: 9_950 });
  });

  it("says what is wrong rather than make a rule from a bad form", () => {
    expect(plan(world.tx.viaplay, form({ result: job(null) }))).toEqual({ ok: false, problem: "chooseJob" });
    expect(plan(world.tx.viaplay, form({ result: { kind: "sameSplit" } }))).toEqual({ ok: false, problem: "chooseJob" });
    expect(plan(world.tx.viaplay, form({ low: "lots" }))).toEqual({ ok: false, problem: "badAmount" });
    expect(plan(world.tx.viaplay, form({ high: "-5" }))).toEqual({ ok: false, problem: "badAmount" });
    expect(plan(world.tx.viaplay, form({ low: "600", high: "500" }))).toEqual({ ok: false, problem: "rangeBackwards" });
    expect(plan(world.tx.viaplay, form({ high: "0" }))).toEqual({ ok: false, problem: "rangeBackwards" });
  });
});

describe("origin and priority", () => {
  it("is learned when the family chose something other than the suggestion, and set otherwise", () => {
    expect(okPlan(world.tx.lyse, form({ result: job(world.jobs.phones) })).rule.origin).toBe("learned");
    expect(okPlan(world.tx.lyse, form({ result: job(world.jobs.electricity) })).rule.origin).toBe("set");
    expect(okPlan(world.tx.viaplay, form()).rule.origin).toBe("set");
  });

  it("starts at 0, and goes one above a rule that already matches this transaction so the new one wins", () => {
    expect(okPlan(world.tx.viaplay, form()).rule.priority).toBe(0);
    const existing: Rule = { id: aRuleId(2), match: { counterparty: "viaplay group" }, result: { kind: "job", jobId: world.jobs.food }, origin: "set", priority: 4 };
    const facts = withRule(world.facts, existing);
    const withExisting = rowsOf(facts);
    const made = planRule({ ...base, facts, row: rowFor(world.tx.viaplay, withExisting), rows: withExisting, form: form() });
    expect(made).toMatchObject({ ok: true, rule: { priority: 5 } });
  });
});

describe("the other waiting transactions the rule would sort", () => {
  it("are those from the same payee going the same way, and no others", () => {
    const { others } = okPlan(world.tx.shopOne, form({ result: job(world.jobs.food) }));
    expect(others.map((r) => r.id)).toEqual([world.tx.shopTwo]);
  });

  it("leave out a transaction the app would merge away", () => {
    const mergeRow: NeedsYouRow = { ...rowFor(world.tx.shopTwo), suggestion: { kind: "merge", command: { kind: "mergeTransactions", keep: world.tx.shopOne, drop: world.tx.shopTwo }, result: null, jobs: [], shares: null, basis: null } };
    const list = rows.map((r) => (r.id === world.tx.shopTwo ? mergeRow : r));
    const { others } = okPlan(world.tx.shopOne, form({ result: job(world.jobs.food) }), { rows: list });
    expect(others).toEqual([]);
  });

  it("leave out a transaction a stronger rule would sort", () => {
    const stronger: Rule = { id: aRuleId(3), match: { counterparty: "Nærbutikken Fjord", max: money(-1) }, result: { kind: "job", jobId: world.jobs.phones }, origin: "set", priority: 9 };
    const facts = withRule(world.facts, stronger);
    const list = rowsOf(facts);
    const made = planRule({ ...base, facts, row: rowFor(world.tx.shopOne, list), rows: list, form: form({ result: job(world.jobs.food) }) });
    expect(made).toMatchObject({ ok: true, rule: { priority: 10 } });
    expect(made.ok && made.others.map((r) => r.id)).toEqual([world.tx.shopTwo]);
  });
});

describe("the change that makes the rule", () => {
  const result = okPlan(world.tx.shopOne, form({ result: job(world.jobs.food) }));
  const row = rowFor(world.tx.shopOne);

  function run(alsoSortOthers: boolean): Facts {
    const { command } = ruleCommand(result, row, alsoSortOthers);
    const outcome = apply(world.facts, command, { asOf: today });
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    return outcome.facts;
  }

  it("is one batch: the rule first, then the transaction with the rule named", () => {
    const { command, sorted } = ruleCommand(result, row, false);
    expect(sorted).toBe(1);
    expect(command.kind).toBe("batch");
    if (command.kind !== "batch") return;
    expect(command.commands.map((c) => c.kind)).toEqual(["addRule", "setTreatment"]);
    expect(command.commands[1]).toMatchObject({ kind: "setTreatment", transactionId: world.tx.shopOne, ruleId: base.id });
  });

  it("adds the rule and sorts this transaction in the same change", () => {
    const after = run(false);
    expect(after.rules.get(base.id)).toMatchObject({ match: { counterparty: "Nærbutikken Fjord" }, origin: "set" });
    const sorted = after.transactions.get(world.tx.shopOne);
    expect(sorted?.ruleId).toBe(base.id);
    expect(sorted?.treatment).toMatchObject({ kind: "split", allocations: [{ jobId: world.jobs.food, amount: kr(-230) }] });
    expect(after.transactions.get(world.tx.shopTwo)?.treatment.kind).toBe("needsYou");
  });

  it("sorts the other matching transactions too when asked, each scaled to its own amount", () => {
    const after = run(true);
    expect(after.transactions.get(world.tx.shopTwo)).toMatchObject({ ruleId: base.id, treatment: { kind: "split", allocations: [{ jobId: world.jobs.food, amount: kr(-310) }] } });
    const waiting = computeFigures(after, today).needsYou.map((i) => i.transaction.id);
    expect(waiting).not.toContain(world.tx.shopOne);
    expect(waiting).not.toContain(world.tx.shopTwo);
    expect(waiting).toContain(world.tx.shopRefund);
  });

  it("counts the transactions it sorts, this one and the others when asked", () => {
    expect(ruleCommand(result, row, false).sorted).toBe(1);
    expect(ruleCommand(result, row, true).sorted).toBe(2);
  });

  it("is refused whole when core refuses one part, and changes nothing", () => {
    const other = { ...result, rule: { ...result.rule, result: { kind: "job", jobId: world.jobs.food } } } as const;
    const gone = { ...row, id: "00000000-0000-7000-8000-00000000dead" as TransactionId, transaction: { ...row.transaction, id: "00000000-0000-7000-8000-00000000dead" as TransactionId } };
    const outcome = apply(world.facts, ruleCommand(other, gone, false).command, { asOf: today });
    expect(outcome).toMatchObject({ ok: false, refusal: { code: "transactionNotFound" } });
  });
});

describe("decimalSeparator", () => {
  it("follows the language the family types in", () => {
    expect(decimalSeparator("en-GB")).toBe(".");
    expect(decimalSeparator("nb-NO")).toBe(",");
  });
});
