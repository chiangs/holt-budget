import { describe, expect, it } from "vitest";
import { computeFigures } from "../figures/index.ts";
import type { Facts, Rule } from "../facts.ts";
import { type JobId, type TransactionId, ruleId } from "../ids.ts";
import { currency } from "../money.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { type RowSpec, commitPlan, importHousehold, importInput, numbers, statement, today } from "../testing/synthetic-statement.ts";
import { type ImportPlan, type ImportPreview, planImport } from "./plan.ts";

function preview(plan: ImportPlan): ImportPreview {
  if (!plan.ok) throw new Error(`Blocked: ${plan.blocked.kind}`);
  return plan.preview;
}

const shop = (date: string, amount = kr(-120), description = "Kiwi Sentrum"): RowSpec => ({ account: numbers.everyday, date, amount, description, counterparty: "Kiwi" });

function withRules(facts: Facts, ...rules: Rule[]): Facts {
  return { ...facts, rules: new Map(rules.map((r) => [r.id, r])) };
}

const rule = (n: number, counterparty: string, jobId: JobId, priority = 1): Rule => ({ id: ruleId(testId(70_000 + n)), match: { counterparty }, result: { kind: "job", jobId }, origin: "set", priority });

describe("planImport refuses a file it can't import", () => {
  it("refuses the same file while its import is live, and accepts it again once that import is undone", () => {
    const h = importHousehold();
    const file = statement([shop("2026-11-02")]);
    const first = planImport(h.facts(), file, importInput("abc", 10_000));
    const imported = commitPlan(h.facts(), first);
    expect(planImport(imported, file, importInput("abc", 20_000))).toEqual({ ok: false, blocked: { kind: "duplicateFile", batchId: preview(first).batchId } });
    expect(planImport(imported, file, importInput("abd", 20_000)).ok).toBe(true);
  });

  it("refuses a file in another currency before it looks at the rows", () => {
    const h = importHousehold();
    const file = statement([{ ...shop("2026-11-02"), account: numbers.stranger }], { currency: currency("EUR") });
    expect(planImport(h.facts(), file, importInput("eur", 10_000))).toEqual({ ok: false, blocked: { kind: "wrongCurrency", file: "EUR", household: "NOK" } });
  });

  it("refuses a file with no rows", () => {
    expect(planImport(importHousehold().facts(), statement([]), importInput("empty", 10_000))).toEqual({ ok: false, blocked: { kind: "noRows" } });
  });

  it("refuses a file whose rows all belong to accounts the household doesn't have, and names them", () => {
    const file = statement([
      { ...shop("2026-11-02"), account: numbers.stranger, accountName: "Someone else" },
      { ...shop("2026-11-03"), account: numbers.stranger },
    ]);
    expect(planImport(importHousehold().facts(), file, importInput("other", 10_000))).toEqual({
      ok: false,
      blocked: { kind: "noKnownAccounts", leftOut: [{ account: numbers.stranger, accountName: "Someone else", rows: 2 }] },
    });
  });
});

describe("planImport matches by counting", () => {
  it("leaves out rows for an account the household doesn't have and imports the rest", () => {
    const h = importHousehold();
    const plan = planImport(h.facts(), statement([shop("2026-11-02"), { ...shop("2026-11-02"), account: numbers.stranger }]), importInput("mixed", 10_000));
    expect(preview(plan).counts).toMatchObject({ rows: 2, created: 1, leftOut: 1 });
    expect(preview(plan).leftOut).toEqual([{ account: numbers.stranger, rows: 1 }]);
    expect([...commitPlan(h.facts(), plan).importRows.values()].map((r) => r.accountId)).toEqual([h.accounts.everyday]);
  });

  it("makes two identical rows in one file two transactions", () => {
    const h = importHousehold();
    const after = commitPlan(h.facts(), planImport(h.facts(), statement([shop("2026-11-02"), shop("2026-11-02")]), importInput("twice", 10_000)));
    expect(after.transactions.size).toBe(2);
  });

  it("backs the existing transactions in ID order with the first rows, and creates one for each row over", () => {
    const h = importHousehold();
    const older = h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "kiwi sentrum" });
    const newer = h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "KIWI   Sentrum " });
    const plan = planImport(h.facts(), statement([shop("2026-11-02"), shop("2026-11-02"), shop("2026-11-02")]), importInput("three", 10_000));
    const after = commitPlan(h.facts(), plan);
    const rows = [...after.importRows.values()].sort((a, b) => a.line - b.line);
    expect(rows.slice(0, 2).map((r) => r.backs)).toEqual([older, newer]);
    expect(preview(plan).counts).toMatchObject({ matched: 2, created: 1 });
    expect(after.transactions.size).toBe(3);
  });

  it("never matches on the bank's reference alone", () => {
    const h = importHousehold();
    const first = commitPlan(h.facts(), planImport(h.facts(), statement([{ ...shop("2026-11-02"), reference: "1234567890" }]), importInput("one", 10_000)));
    const plan = planImport(first, statement([{ ...shop("2026-11-02", kr(-120), "Kiwi Torget"), reference: "1234567890" }]), importInput("two", 20_000));
    expect(preview(plan).counts).toMatchObject({ matched: 0, created: 1 });
  });

  it("keeps a pending row, backs nothing with it, and creates the transaction when a later file books it", () => {
    const h = importHousehold();
    const plan = planImport(h.facts(), statement([{ ...shop("2026-11-05"), pending: true }]), importInput("pending", 10_000));
    const after = commitPlan(h.facts(), plan);
    expect(preview(plan).counts).toMatchObject({ pending: 1, created: 0 });
    expect([...after.importRows.values()].map((r) => [r.pending, r.backs])).toEqual([[true, null]]);
    expect(after.transactions.size).toBe(0);
    const booked = commitPlan(after, planImport(after, statement([shop("2026-11-05")]), importInput("booked", 20_000)));
    expect(booked.transactions.size).toBe(1);
  });
});

describe("planImport treats each new transaction", () => {
  it("makes a transaction from before the plan start history, with the job of a rule that gives one", () => {
    const h = importHousehold();
    const facts = withRules(h.facts(), rule(1, "Kiwi", h.jobs.food));
    const plan = planImport(facts, statement([shop("2026-09-15"), { ...shop("2026-09-16"), counterparty: "Rema" }]), importInput("history", 10_000));
    expect(preview(plan).sample.map((s) => [s.treatment, s.why])).toEqual([
      [{ kind: "history", jobId: h.jobs.food }, { kind: "history" }],
      [{ kind: "history", jobId: null }, { kind: "history" }],
    ]);
  });

  it("gives a transaction from the plan start on the treatment of the best rule, and records the rule", () => {
    const h = importHousehold();
    const facts = withRules(h.facts(), rule(1, "Kiwi", h.jobs.electricity, 1), rule(2, "kiwi", h.jobs.food, 5));
    const after = commitPlan(facts, planImport(facts, statement([shop("2026-11-02")]), importInput("rule", 10_000)));
    const [t] = after.transactions.values();
    expect(t?.treatment).toEqual({ kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-120) }] });
    expect(t?.ruleId).toBe(ruleId(testId(70_002)));
  });

  it("leaves a transaction no rule covers waiting in needs you", () => {
    const h = importHousehold();
    const plan = planImport(h.facts(), statement([shop("2026-11-02")]), importInput("plain", 10_000));
    expect(preview(plan).sample.map((s) => s.why)).toEqual([{ kind: "firstPayment" }]);
    expect(preview(plan).counts).toMatchObject({ created: 1, needsYou: 1, byRule: 0, history: 0, transfers: 0 });
  });

  it("keeps a near match one day apart waiting in needs you, even when a rule covers it", () => {
    const h = importHousehold();
    const earlier = h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum" });
    const facts = withRules(h.facts(), rule(1, "Kiwi", h.jobs.food));
    const plan = planImport(facts, statement([shop("2026-11-03")]), importInput("near", 10_000));
    const [line] = preview(plan).sample;
    expect(line?.why).toEqual({ kind: "nearMatch", of: earlier });
    expect(line?.treatment).toEqual({ kind: "needsYou" });
    expect(preview(plan).nearMatches).toEqual([{ transactionId: line?.transactionId, line: 2, of: earlier }]);
  });

  it("finds no near match in a transaction that another row of the same file backs", () => {
    const h = importHousehold();
    h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "Kiwi Sentrum" });
    const plan = planImport(h.facts(), statement([shop("2026-11-02"), shop("2026-11-03")]), importInput("both", 10_000));
    expect(preview(plan).nearMatches).toEqual([]);
    expect(preview(plan).counts).toMatchObject({ matched: 1, created: 1 });
  });
});

describe("planImport pairs transfers", () => {
  const transfer = (date: string, from = numbers.everyday, to = numbers.savings, amount = 2_000): RowSpec[] => [
    { account: from, date, amount: kr(-amount), description: "Overføring" },
    { account: to, date, amount: kr(amount), description: "Overføring" },
  ];

  it("pairs two sides in different accounts within 3 days and marks the matching move at the bank done", () => {
    const h = importHousehold();
    const move = h.builder.move({ from: h.accounts.everyday, to: h.accounts.savings, amount: kr(2_000), month: "2026-11" });
    const file = statement([transfer("2026-11-02")[0]!, { ...transfer("2026-11-05")[1]! }]);
    const plan = planImport(h.facts(), file, importInput("pair", 10_000));
    const after = commitPlan(h.facts(), plan);
    const [outgoing, incoming] = preview(plan).sample.map((s) => s.transactionId) as [TransactionId, TransactionId];
    expect(preview(plan).transfers).toEqual([{ outgoing, incoming, completesMove: move }]);
    expect(after.transactions.get(outgoing)?.treatment).toEqual({ kind: "transfer", partner: incoming });
    expect(after.transactions.get(incoming)?.treatment).toEqual({ kind: "transfer", partner: outgoing });
    expect(after.moves.get(move)).toMatchObject({ status: "done", completedBy: outgoing });
    expect(preview(plan).counts).toMatchObject({ transfers: 2, needsYou: 0 });
  });

  it("pairs a new side with one already waiting", () => {
    const h = importHousehold();
    const waiting = h.builder.needsYou({ accountId: h.accounts.savings, date: "2026-11-03", amount: kr(2_000), description: "Fra brukskonto" });
    const plan = planImport(h.facts(), statement([transfer("2026-11-02")[0]!]), importInput("half", 10_000));
    expect(commitPlan(h.facts(), plan).transactions.get(waiting)?.treatment.kind).toBe("transfer");
  });

  it("leaves both sides waiting when either has more than one candidate, or the sides are four days apart", () => {
    const h = importHousehold();
    const ambiguous = statement([...transfer("2026-11-02"), { account: numbers.bills, date: "2026-11-03", amount: kr(2_000), description: "Overføring" }]);
    expect(preview(planImport(h.facts(), ambiguous, importInput("many", 10_000))).transfers).toEqual([]);
    const apart = statement([transfer("2026-11-02")[0]!, transfer("2026-11-06")[1]!]);
    expect(preview(planImport(h.facts(), apart, importInput("apart", 10_000))).transfers).toEqual([]);
  });

  it("never pairs a payment into an account the household pays into, which is saving", () => {
    const h = importHousehold();
    const plan = planImport(h.facts(), statement(transfer("2026-11-02", numbers.everyday, numbers.child)), importInput("child", 10_000));
    expect(preview(plan).transfers).toEqual([]);
  });
});

describe("planImport checks the balance the family typed", () => {
  it("says an account matches, differs by how much, or wasn't checked, and never adjusts a balance", () => {
    const h = importHousehold();
    const file = statement([shop("2026-11-02"), { ...shop("2026-11-03", kr(-500), "Strøm"), account: numbers.bills }, { ...shop("2026-11-03", kr(100), "Renter"), account: numbers.savings }]);
    const plan = planImport(h.facts(), file, {
      ...importInput("balance", 10_000, [
        { accountId: h.accounts.everyday, value: kr(9_880), asOf: today },
        { accountId: h.accounts.bills, value: kr(-450), asOf: today },
      ]),
    });
    const [everyday, bills, savings] = preview(plan).accounts;
    expect(everyday?.balance).toEqual({ kind: "matches", accountId: h.accounts.everyday, asOf: today, entered: kr(9_880), calculated: kr(9_880) });
    expect(bills?.balance).toMatchObject({ kind: "differs", entered: kr(-450), calculated: kr(-500), difference: kr(50) });
    expect(savings?.balance).toEqual({ kind: "notChecked", accountId: h.accounts.savings });

    const after = commitPlan(h.facts(), plan);
    expect([...after.enteredValues.values()].map((v) => [v.kind, v.subject, v.value, v.asOf])).toEqual([
      ["accountBalance", h.accounts.everyday, kr(9_880), today],
      ["accountBalance", h.accounts.bills, kr(-450), today],
    ]);
    expect(computeFigures(after, today).accounts.get(h.accounts.bills)?.balance.amount).toBe(kr(-500));
  });

  it("shows at most a bounded sample of the new transactions", () => {
    const h = importHousehold();
    const rows = Array.from({ length: 70 }, (_, i) => ({ ...shop("2026-11-02", kr(-(i + 1))), counterparty: `Shop ${i}` }));
    const plan = planImport(h.facts(), statement(rows), importInput("many", 10_000));
    expect(preview(plan).counts.created).toBe(70);
    expect(preview(plan).sample).toHaveLength(50);
    expect(preview(plan).sample.map((s) => s.line)).toEqual(Array.from({ length: 50 }, (_, i) => i + 2));
  });
});
