import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Month, localDate, month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { AccountId } from "../ids.ts";
import { arbitraryHousehold } from "../testing/arbitrary-facts.ts";
import { factsBuilder, setAmount } from "../testing/facts-builder.ts";
import { type MovesPlan, type MonthlyMoveStatus, movesPlanFrom } from "./moves-plan.ts";
import { type Figures, computeFigures } from "./index.ts";
import { money } from "../money.ts";

const november = month("2026-11");
const today = localDate("2026-11-09");
const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map(month);

/** What the figures say each account needs (positive) or has to spare (negative) in a month. */
function signedMoves(figures: Figures, m: Month): ReadonlyMap<AccountId, number> {
  const signed = new Map<AccountId, number>();
  for (const [id, account] of figures.accounts) {
    const move = account.monthlyMoves.get(m);
    signed.set(id, move?.kind === "moveIn" ? move.amount : move?.kind === "surplus" ? -move.amount : 0);
  }
  return signed;
}

/** What the plan moves into each account less what it moves out, and what it leaves, by account. */
function afterMoves(plan: MovesPlan, signed: ReadonlyMap<AccountId, number>) {
  const net = new Map<AccountId, number>([...signed.keys()].map((id) => [id, 0]));
  for (const move of plan.monthly) {
    net.set(move.from, (net.get(move.from) ?? 0) - move.amount);
    net.set(move.to, (net.get(move.to) ?? 0) + move.amount);
  }
  return new Map([...signed].map(([id, need]) => [id, need - (net.get(id) ?? 0)]));
}

/** The checks every plan must pass, for each month given. */
function checkPlans(facts: Facts, asOf: ReturnType<typeof localDate>, checked: readonly Month[]): void {
  const figures = computeFigures(facts, asOf);
  for (const m of checked) {
    const signed = signedMoves(figures, m);
    const plan = movesPlanFrom(facts, figures, m);
    for (const move of plan.monthly) {
      expect(move.amount).toBeGreaterThan(0);
      expect(move.from).not.toBe(move.to);
      expect(signed.get(move.from) as number).toBeLessThan(0);
      expect(signed.get(move.to) as number).toBeGreaterThan(0);
    }
    const sources = new Set(plan.monthly.map((x) => x.from));
    expect(plan.monthly.some((x) => sources.has(x.to))).toBe(false);

    const surplus = [...signed.values()].filter((v) => v < 0).reduce((sum, v) => sum - v, 0);
    const need = [...signed.values()].filter((v) => v > 0).reduce((sum, v) => sum + v, 0);
    expect(plan.monthly.reduce((sum, x) => sum + x.amount, 0)).toBe(Math.min(surplus, need));

    const left = afterMoves(plan, signed);
    const unmoved = new Map(plan.unmoved.map((u) => [u.accountId, u.kind === "moveIn" ? u.amount : -u.amount]));
    for (const [id, rest] of left) expect(unmoved.get(id) ?? 0).toBe(rest);
    expect(new Set(plan.unmoved.map((u) => u.kind)).size).toBeLessThanOrEqual(1);
    expect(plan.unmoved.reduce((sum, u) => sum + (u.kind === "moveIn" ? u.amount : -u.amount), 0)).toBe(need - surplus);
  }
}

describe("the monthly moves of any household", () => {
  it("are whole moves between different accounts, out of an account with a surplus and into one that needs money, none both, and move all that can be matched", () => {
    fc.assert(fc.property(arbitraryHousehold(), ({ facts, asOf }) => checkPlans(facts, asOf, months)));
  });

  it("do the same where some money has no job or too much is assigned, which random households seldom reach", () => {
    fc.assert(fc.property(balanced, fc.integer({ min: -60_000, max: 60_000 }), (recipe, slack) => checkPlans(household({ ...recipe, income: [Math.max(0, (recipe.income[0] ?? 0) + slack), ...recipe.income.slice(1)] }).b.facts(), today, [november])));
  });

  it("give the same plan however the rows are held", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), ({ facts, asOf }) => {
        const reversed: Facts = {
          ...facts,
          accounts: new Map([...facts.accounts].reverse()),
          jobs: new Map([...facts.jobs].reverse()),
          moves: new Map([...facts.moves].reverse()),
          transactions: new Map([...facts.transactions].reverse()),
        };
        const [figures, figuresReversed] = [computeFigures(facts, asOf), computeFigures(reversed, asOf)];
        for (const m of months) expect(movesPlanFrom(reversed, figuresReversed, m)).toEqual(movesPlanFrom(facts, figures, m));
      }),
    );
  });
});

/** Accounts that each need some assigned, with the money in the month adding up to what is assigned in all of them. */
const balanced = fc
  .record({
    assigned: fc.array(fc.integer({ min: 0, max: 80_000 }), { minLength: 2, maxLength: 5 }),
    weights: fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 5, maxLength: 5 }),
  })
  .map(({ assigned, weights }) => {
    const total = assigned.reduce((sum, v) => sum + v, 0);
    const usable = weights.slice(0, assigned.length);
    const weightSum = usable.reduce((sum, v) => sum + v, 0);
    const income = usable.map((w) => (weightSum === 0 ? 0 : Math.floor((total * w) / weightSum)));
    income[0] = (income[0] ?? 0) + (total - income.reduce((sum, v) => sum + v, 0));
    return { assigned, income };
  });

function household({ assigned, income }: { readonly assigned: readonly number[]; readonly income: readonly number[] }) {
  const b = factsBuilder({ planStart: "2026-10" });
  const accounts = assigned.map((_, i) => b.account({ name: `Account ${i + 1}` }));
  b.group();
  b.buffer({ monthly: money(0) });
  b.budgetMonth("2026-10", "closed");
  b.budgetMonth("2026-11", "open");
  assigned.forEach((amount, i) => {
    const job = b.spendJob({ plan: setAmount(money(amount)), accountId: accounts[i] as AccountId });
    if (amount > 0) b.assign("2026-11", job, money(amount));
  });
  income.forEach((amount, i) => {
    if (amount > 0) b.income({ date: "2026-10-20", amount: money(amount), fundsMonth: "2026-11", accountId: accounts[i] as AccountId });
  });
  return { b, accounts };
}

describe("the monthly moves of a household where every krone has a job", () => {
  it("net to zero: money in equals money out, and every account's net after the moves is zero", () => {
    fc.assert(
      fc.property(balanced, (recipe) => {
        const facts = household(recipe).b.facts();
        const figures = computeFigures(facts, today);
        const signed = signedMoves(figures, november);
        const plan = movesPlanFrom(facts, figures, november);
        expect(plan.unmoved).toEqual([]);
        const totalOut = plan.monthly.reduce((sum, x) => sum + x.amount, 0);
        const need = [...signed.values()].filter((v) => v > 0).reduce((sum, v) => sum + v, 0);
        expect(totalOut).toBe(need);
        for (const rest of afterMoves(plan, signed).values()) expect(rest).toBe(0);
      }),
    );
  });

  const rank = (s: MonthlyMoveStatus): number => (s.kind === "done" ? 2 : s.kind === "partlyDone" ? 1 : 0);

  it("only get closer to done as transfers between the accounts are imported", () => {
    fc.assert(
      fc.property(balanced, fc.array(fc.record({ from: fc.nat(), to: fc.nat(), amount: fc.integer({ min: 1, max: 120_000 }), day: fc.integer({ min: 1, max: 28 }), inOctober: fc.boolean() }), { maxLength: 4 }), (recipe, transfers) => {
        const { b, accounts } = household(recipe);
        const before = movesPlanFrom(b.facts(), computeFigures(b.facts(), today), november);
        for (const t of transfers) {
          const [from, to] = [accounts[t.from % accounts.length] as AccountId, accounts[t.to % accounts.length] as AccountId];
          if (from === to) continue;
          const date = t.inOctober ? `2026-10-${String(15 + (t.day % 14)).padStart(2, "0")}` : `2026-11-0${1 + (t.day % 8)}`;
          b.transfer({ from, to, date, amount: money(t.amount) });
        }
        const after = movesPlanFrom(b.facts(), computeFigures(b.facts(), today), november);
        expect(after.monthly.map((m) => [m.from, m.to, m.amount])).toEqual(before.monthly.map((m) => [m.from, m.to, m.amount]));
        after.monthly.forEach((m, i) => {
          expect(rank(m.status)).toBeGreaterThanOrEqual(rank((before.monthly[i] as (typeof before.monthly)[number]).status));
          if (m.status.kind === "partlyDone") {
            expect(m.status.done).toBeGreaterThan(0);
            expect(m.status.done).toBeLessThan(m.amount);
          }
        });
      }),
    );
  });
});
