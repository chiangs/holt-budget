import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addMonths, localDate, monthOf } from "../dates.ts";
import { money } from "../money.ts";
import { arbitraryHousehold } from "../testing/arbitrary-facts.ts";
import { averageEstimate } from "../testing/estimates.ts";
import { factsBuilder, kr, monthlySaving, setAmount } from "../testing/facts-builder.ts";
import { monthIn } from "../testing/read-figures.ts";
import { computeFigures } from "./index.ts";

const figuresOf = (b: ReturnType<typeof factsBuilder>, asOf: string) => computeFigures(b.facts(), localDate(asOf), { estimate: averageEstimate });

describe("the buffer's target and runway", () => {
  const household = () => {
    const b = factsBuilder();
    b.budgetMonth("2026-01");
    const assign = (job: ReturnType<typeof b.spendJob>, kroner: number) => b.assign("2026-01", job, kr(kroner));
    assign(b.spendJob({ name: "Mortgage", plan: setAmount(kr(14_500)), essential: true }), 14_500);
    assign(b.spendJob({ name: "Food", plan: setAmount(kr(6_000)), essential: true }), 6_000);
    assign(b.spendJob({ name: "Eating out", plan: setAmount(kr(2_000)) }), 2_000);
    assign(b.spendJob({ name: "Union fees", plan: setAmount(kr(1_000)), essential: true, status: "paused" }), 1_000);
    assign(b.saveUpJob({ name: "Konfirmasjon", target: monthlySaving(kr(2_000)), essential: true }), 2_000);
    const buffer = b.buffer({ monthly: kr(2_000), opening: kr(50_000) });
    assign(buffer, 2_000);
    return { b, buffer };
  };

  it("is buffer months × this month's total for active essential spend jobs, 3 months unless you set it", () => {
    const { b, buffer } = household();
    expect(figuresOf(b, "2026-01-15").buffer).toEqual({
      kind: "buffer",
      jobId: buffer,
      balance: kr(52_000),
      bufferMonths: 3,
      essentialMonthly: kr(20_500),
      target: kr(61_500),
      runway: { kind: "tenthsOfAMonth", tenths: 25 },
    });
  });

  it("follows your latest buffer-months setting", () => {
    const { b } = household();
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 4, unit: "months", asOf: "2026-01-02" });
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 6, unit: "months", asOf: "2026-01-10" });
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 9, unit: "months", asOf: "2026-02-01" });
    expect(figuresOf(b, "2026-01-15").buffer).toMatchObject({ bufferMonths: 6, target: kr(123_000) });
  });

  it("rounds the target up to whole øre when the setting has a fraction of a month", () => {
    const b = factsBuilder();
    b.buffer({ monthly: kr(1_000) });
    const food = b.spendJob({ plan: setAmount(money(1_000_001)), essential: true });
    b.budgetMonth("2026-01");
    b.assign("2026-01", food, money(1_000_001));
    b.enteredValue({ kind: "reference", subject: "buffer-months", value: 2.5, unit: "months", asOf: "2026-01-02" });
    expect(figuresOf(b, "2026-01-15").buffer).toMatchObject({ essentialMonthly: 1_000_001, target: 2_500_003 });
  });

  it("gives no runway below zero, and none at all without essential spending", () => {
    const b = factsBuilder();
    const buffer = b.buffer({ monthly: kr(2_000) });
    const food = b.spendJob({ plan: setAmount(kr(6_000)), essential: true });
    b.budgetMonth("2026-01");
    b.assign("2026-01", buffer, kr(2_000));
    b.assign("2026-01", food, kr(6_000));
    b.spend({ date: "2026-01-05", amount: kr(-5_000), jobId: buffer });
    expect(figuresOf(b, "2026-01-15").buffer).toMatchObject({ balance: kr(-3_000), runway: { kind: "tenthsOfAMonth", tenths: 0 } });

    b.assign("2026-01", food, kr(0));
    expect(figuresOf(b, "2026-01-15").buffer).toMatchObject({ target: 0, runway: { kind: "noEssentials" } });
  });

  it("says when there is no buffer yet, and refuses facts with two", () => {
    const b = factsBuilder();
    expect(figuresOf(b, "2026-01-15").buffer).toEqual({ kind: "noBuffer" });
    b.buffer({ monthly: kr(1_000) });
    b.buffer({ monthly: kr(1_000) });
    expect(() => figuresOf(b, "2026-01-15")).toThrow(/one buffer/);
  });
});

describe("next month's money is not the buffer (rule 11)", () => {
  it("counts income for next month that has arrived by today, and keeps it out of the buffer and the runway", () => {
    const b = factsBuilder();
    b.buffer({ monthly: kr(2_000), opening: kr(30_000) });
    b.spendJob({ plan: setAmount(kr(10_000)), essential: true });
    const without = figuresOf(b, "2026-01-25");
    b.income({ date: "2026-01-20", amount: kr(70_000), fundsMonth: "2026-02" });
    b.income({ date: "2026-01-28", amount: kr(1_000), fundsMonth: "2026-02" });
    const withIncome = figuresOf(b, "2026-01-25");

    expect(withIncome.nextMonthsMoney).toEqual({ month: "2026-02", amount: kr(70_000) });
    expect(withIncome.buffer).toEqual(without.buffer);
    expect(monthIn(withIncome, "2026-02").income).toBe(kr(70_000));
  });

  it("lets a late contribution fund the month it was meant for", () => {
    const b = factsBuilder();
    b.income({ date: "2026-02-03", amount: kr(32_000), fundsMonth: "2026-01", source: "contribution" });
    const figures = figuresOf(b, "2026-02-10");
    expect(monthIn(figures, "2026-01").income).toBe(kr(32_000));
    expect(monthIn(figures, "2026-02").income).toBe(0);
    expect(monthIn(figures, "2026-02").carriedIn).toBe(kr(32_000));
    expect(figures.nextMonthsMoney.amount).toBe(0);
  });

  it("holds for any household: money for next month never changes the buffer or a bucket", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), fc.integer({ min: 1, max: 10_000_000 }), fc.nat(), (household, amount, accountIndex) => {
        const { asOf, sharedAccounts } = household;
        const next = addMonths(monthOf(asOf), 1);
        const before = computeFigures(household.facts, asOf, { estimate: averageEstimate });
        const after = computeFigures(
          household.withMore((b) => b.income({ accountId: sharedAccounts[accountIndex % sharedAccounts.length] ?? b.defaultAccount(), date: asOf, amount: money(amount), fundsMonth: next })),
          asOf,
          { estimate: averageEstimate },
        );

        expect(after.nextMonthsMoney.amount).toBe(before.nextMonthsMoney.amount + amount);
        expect(after.buffer).toEqual(before.buffer);
        for (const [job, figures] of before.jobs) expect(after.jobs.get(job)?.bucket).toEqual(figures.bucket);
      }),
    );
  });
});
