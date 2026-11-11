import { describe, expect, it } from "vitest";
import { type Month, addMonths, localDate, month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { money } from "../money.ts";
import { type FactsBuilder, factsBuilder, kr, monthlySaving, setAmount } from "../testing/facts-builder.ts";
import { planHousehold, planToday } from "../testing/plan-household.ts";
import { savingsRate } from "./savings-rate.ts";

const today = localDate("2026-11-09");

/** November 2026 with two groups, one that counts towards the savings rate. Money in is the amount in kroner, booked in October. */
function household(moneyIn: number) {
  const b = factsBuilder({ planStart: "2026-10" });
  const saving = b.group({ name: "Saving", countsTowardsSavingsRate: true });
  const living = b.group({ name: "Living" });
  b.buffer({ monthly: kr(0), groupId: saving });
  b.budgetMonth("2026-10", "closed");
  b.budgetMonth("2026-11", "open");
  if (moneyIn > 0) b.income({ date: "2026-10-20", amount: kr(moneyIn), fundsMonth: "2026-11" });
  return { b, saving, living };
}

const novemberOf = (facts: Facts) => {
  const rate = savingsRate(facts, today).find((r) => r.month === "2026-11");
  if (rate === undefined) throw new Error("No rate for November");
  return rate;
};

const assign = (b: FactsBuilder, job: Parameters<FactsBuilder["assign"]>[1], kroner: number) => b.assign("2026-11", job, kr(kroner));

describe("the savings rate", () => {
  it("is saving as a share of money in, in tenths of a percent: 14.0% for the mockup's November", () => {
    const { facts } = planHousehold();
    expect(savingsRate(facts, planToday)[0]).toEqual({ month: "2026-11", saving: kr(9_500), moneyIn: kr(68_048), tenths: 140 });
  });

  it("counts every job in a group that counts, whatever its kind", () => {
    const { b, saving } = household(10_000);
    assign(b, b.spendJob({ plan: setAmount(kr(100)), groupId: saving }), 1_000);
    assign(b, b.saveUpJob({ target: monthlySaving(kr(100)), groupId: saving }), 500);
    expect(novemberOf(b.facts())).toMatchObject({ saving: kr(1_500), moneyIn: kr(10_000), tenths: 150 });
  });

  it("counts a pay-into job in any group, but no other job in a group that does not count", () => {
    const { b, living } = household(10_000);
    assign(b, b.payIntoJob({ monthly: kr(100), payInto: b.account({ scope: "paidInto" }), groupId: living }), 400);
    assign(b, b.saveUpJob({ name: "Konfirmasjon", target: monthlySaving(kr(100)), groupId: living }), 2_000);
    assign(b, b.spendJob({ plan: setAmount(kr(100)), groupId: living }), 3_000);
    expect(novemberOf(b.facts())).toMatchObject({ saving: kr(400), tenths: 40 });
  });

  it("counts a pay-into job in a group that counts once", () => {
    const { b, saving } = household(10_000);
    assign(b, b.payIntoJob({ monthly: kr(100), payInto: b.account({ scope: "paidInto" }), groupId: saving }), 400);
    expect(novemberOf(b.facts())).toMatchObject({ saving: kr(400), tenths: 40 });
  });

  it("rounds to the nearest tenth, a half up", () => {
    const { b, saving } = household(0);
    const job = b.spendJob({ plan: setAmount(kr(1)), groupId: saving });
    b.income({ date: "2026-10-21", amount: money(2_000), fundsMonth: "2026-11" });
    b.assign("2026-11", job, money(1));
    expect(novemberOf(b.facts()).tenths).toBe(1);
    b.assign("2026-11", job, money(699));
    expect(novemberOf(b.facts()).tenths).toBe(350);
    b.assign("2026-11", job, money(698));
    expect(novemberOf(b.facts()).tenths).toBe(349);
  });

  it("has no rate while no money is in, and a month with nothing saved is 0.0%", () => {
    const { b, saving } = household(0);
    assign(b, b.spendJob({ plan: setAmount(kr(100)), groupId: saving }), 1_000);
    expect(novemberOf(b.facts())).toMatchObject({ saving: kr(1_000), moneyIn: 0, tenths: null });
    const funded = household(8_000);
    assign(funded.b, funded.b.spendJob({ plan: setAmount(kr(100)), groupId: funded.living }), 1_000);
    expect(novemberOf(funded.b.facts())).toMatchObject({ saving: 0, tenths: 0 });
  });

  it("can pass 100% when more is saved than comes in", () => {
    const { b, saving } = household(1_000);
    assign(b, b.spendJob({ plan: setAmount(kr(100)), groupId: saving }), 1_500);
    expect(novemberOf(b.facts()).tenths).toBe(1_500);
  });

  it("runs from the current month to the horizon, in order, and not before", () => {
    const { b } = household(10_000);
    const rates = savingsRate(b.facts(), today);
    const months: Month[] = [];
    for (let i = 0; i <= 12; i += 1) months.push(addMonths(month("2026-11"), i));
    expect(rates.map((r) => r.month)).toEqual(months);
  });

  it("reads the plan for the months ahead, with the money that has arrived for them", () => {
    const { b, saving } = household(10_000);
    b.spendJob({ plan: setAmount(kr(2_000)), groupId: saving });
    b.income({ date: "2026-11-05", amount: kr(5_000), fundsMonth: "2026-12" });
    const december = savingsRate(b.facts(), today).find((r) => r.month === "2026-12");
    expect(december).toMatchObject({ saving: kr(2_000), moneyIn: kr(5_000), tenths: 400 });
  });

  describe("with expected income", () => {
    it("adds it to the money in, month by month", () => {
      const { b, saving } = household(10_000);
      assign(b, b.spendJob({ plan: setAmount(kr(100)), groupId: saving }), 2_000);
      const facts = b.facts();
      const rates = savingsRate(facts, today, { expectedIncome: (_, m) => (m === "2026-11" ? kr(10_000) : money(0)) });
      expect(rates[0]).toMatchObject({ moneyIn: kr(20_000), tenths: 100 });
      expect(rates[1]).toMatchObject({ moneyIn: 0, tenths: null });
    });

    it("gives the function the facts and the month it is asked about", () => {
      const { b } = household(10_000);
      const facts = b.facts();
      const asked: [Facts, Month][] = [];
      savingsRate(facts, today, { expectedIncome: (f, m) => (asked.push([f, m]), money(0)) });
      expect(asked.every(([f]) => f === facts)).toBe(true);
      expect(asked.map(([, m]) => m)[0]).toBe("2026-11");
      expect(asked).toHaveLength(13);
    });

    it("counts without it as the income that has arrived", () => {
      const { b, saving } = household(10_000);
      assign(b, b.spendJob({ plan: setAmount(kr(100)), groupId: saving }), 2_000);
      expect(novemberOf(b.facts()).tenths).toBe(200);
    });
  });
});
