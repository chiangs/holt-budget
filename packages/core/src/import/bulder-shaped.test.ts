import { describe, expect, it } from "vitest";
import { localDate } from "../dates.ts";
import { type Facts, type Transaction, makeSplit } from "../facts.ts";
import { type TransactionId, ruleId, transactionId } from "../ids.ts";
import { kr, testId } from "../testing/facts-builder.ts";
import { bankHistory, commitPlan, importHousehold, importInput, numbers, shops, statement, today } from "../testing/synthetic-statement.ts";
import { matchKey } from "./matching.ts";
import { type ImportPlan, planImport } from "./plan.ts";

declare const performance: { now(): number };

function repeatGroups(facts: Facts): number[] {
  const counts = new Map<string, number>();
  for (const t of facts.transactions.values()) counts.set(matchKey(t), (counts.get(matchKey(t)) ?? 0) + 1);
  return [...counts.values()].filter((n) => n > 1);
}

function counts(plan: ImportPlan) {
  if (!plan.ok) throw new Error(`Blocked: ${plan.blocked.kind}`);
  return plan.preview.counts;
}

describe("a Bulder-shaped export (0043)", () => {
  // 8,556 rows from January 2024 with 135 groups of identical rows, which are real repeats.
  const rows = bankHistory({ from: "2024-01-01", days: 1_045, distinctRows: 8_151, repeatGroups: 135 });

  it("makes every identical row its own transaction, and an overlapping later export adds only its new rows", () => {
    expect(rows).toHaveLength(8_556);
    const h = importHousehold();
    const plan = planImport(h.facts(), statement(rows), importInput("bulder-2026-11", 1_000_000));
    expect(counts(plan)).toMatchObject({ rows: 8_556, created: 8_556, matched: 0 });
    const imported = commitPlan(h.facts(), plan);
    expect(imported.transactions.size).toBe(8_556);
    const groups = repeatGroups(imported);
    expect([groups.length, groups.reduce((sum, n) => sum + n, 0)]).toEqual([135, 405]);

    const overlap = rows.filter((r) => r.date >= "2026-09-01");
    const later = [...overlap, ...bankHistory({ from: "2026-11-15", days: 10, distinctRows: 40, repeatGroups: 2 }).map((r) => ({ ...r, description: `${r.description} ny` }))];
    const next = planImport(imported, statement(later), importInput("bulder-2026-12", 2_000_000));
    expect(counts(next)).toMatchObject({ matched: overlap.length, created: 45 });
    const both = commitPlan(imported, next);
    expect(both.transactions.size).toBe(8_556 + 45);
    expect(repeatGroups(both)).toHaveLength(137);
  });
});

describe("planning speed", () => {
  it("plans a 4,000-row file against a 4,000-transaction history in well under a second", () => {
    const h = importHousehold({ planStart: "2026-01" });
    const rules = shops.slice(0, 5).map((shop, i) => ({ id: ruleId(testId(80_000 + i)), match: { counterparty: shop }, result: { kind: "job" as const, jobId: h.jobs.food }, origin: "set" as const, priority: 1 }));
    const start = { ...h.facts(), rules: new Map(rules.map((r) => [r.id, r])) };
    const older = bankHistory({ from: "2025-11-01", days: 240, distinctRows: 3_600, repeatGroups: 100, transferEvery: 20 });
    const history = commitPlan(start, planImport(start, statement(older), importInput("history", 1_000_000)));
    const half = older.slice(Math.floor(older.length / 2));
    const newer = bankHistory({ from: "2026-07-01", days: 120, distinctRows: 1_900, repeatGroups: 60, transferEvery: 20 }).map((r) => ({ ...r, description: `${r.description} b` }));
    const file = statement([...half, ...newer].slice(0, 4_000));
    const balances = [h.accounts.everyday, h.accounts.savings, h.accounts.bills].map((accountId) => ({ accountId, value: kr(1), asOf: today }));
    expect([history.transactions.size, file.rows.length]).toEqual([4_079, 4_000]);

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const began = performance.now();
      const plan = planImport(history, file, importInput("new", 2_000_000, balances));
      times.push(performance.now() - began);
      expect(counts(plan)).toMatchObject({ rows: 4_000, created: 1_960, matched: 2_040 });
    }
    expect(times.sort((a, b) => a - b)[2]).toBeLessThan(1_000);
  });

  it("plans 4,000 rows that all follow decided history, suggesting for each, and takes choices, in well under a second", () => {
    const h = importHousehold({ planStart: "2026-01" });
    const earlier = Array.from({ length: 4_000 }, (_, k): Transaction => {
      const amount = kr(-(k % 7) - 100);
      return {
        id: transactionId(testId(500_000 + k)),
        accountId: h.accounts.everyday,
        bookingDate: localDate(`2026-0${1 + (k % 5)}-${String(1 + (k % 28)).padStart(2, "0")}`),
        amount,
        description: `Kjøp ${k}`,
        counterparty: shops[k % shops.length] ?? "Kiwi",
        treatment: makeSplit(amount, [{ jobId: (k % shops.length) % 2 === 0 ? h.jobs.electricity : h.jobs.food, amount }]),
      };
    });
    const facts = h.facts();
    const history: Facts = { ...facts, transactions: new Map([...facts.transactions, ...earlier.map((t): [TransactionId, Transaction] => [t.id, t])]) };
    const file = statement(Array.from({ length: 4_000 }, (_, k) => ({ account: numbers.everyday, date: `2026-1${k % 2}-${String(1 + (k % 28)).padStart(2, "0")}`, amount: kr(-(k + 1)), description: `Ny ${k}`, counterparty: shops[k % shops.length] ?? "Kiwi" })));
    const choices = Array.from({ length: 200 }, (_, k) => ({ line: 2 + k * 20, treatment: { kind: "needsYou" as const } }));

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const began = performance.now();
      const plan = planImport(history, file, { ...importInput("heavy", 3_000_000), choices });
      times.push(performance.now() - began);
      expect(counts(plan)).toMatchObject({ created: 4_000, suggested: 3_800, needsYou: 200 });
    }
    expect(times.sort((a, b) => a - b)[2]).toBeLessThan(1_000);
  });
});
