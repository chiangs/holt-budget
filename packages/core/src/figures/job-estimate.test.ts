import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Month, addMonths, localDate, month, monthRange } from "../dates.ts";
import { type Estimate, type EstimateInput, estimate } from "../estimate.ts";
import { type Money, money } from "../money.ts";
import { electricityHousehold, electricityToday } from "../testing/electricity-household.ts";
import { factsBuilder, kr, monthlySaving, setAmount } from "../testing/facts-builder.ts";
import { snapshotOf } from "../testing/variable-cost-household.ts";
import { explainEstimate, jobEstimate } from "./job-estimate.ts";

const h = electricityHousehold();
const electricity = jobEstimate(h.facts, h.jobs.electricity, electricityToday);
const used = (m: string, kroner: number) => ({ month: m, amount: kr(kroner) });

describe("the Electricity estimate, with the mockup's numbers", () => {
  it("gives twelve months, November to October, that total 36,300 kr, or 3,025 kr a month if evened out, marked as estimates", () => {
    expect(electricity?.months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"]);
    expect(electricity?.months.map((m) => m.estimate.amount)).toEqual([3300, 4200, 4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846].map(kr));
    expect(electricity?.total).toEqual({ kind: "estimate", amount: kr(36_300) });
    expect(electricity?.monthlyAverage).toEqual({ kind: "estimate", amount: kr(3_025) });
  });

  it("says November is about the same as March, and December is the average of January and February, both rough", () => {
    const [nov, dec] = electricity?.months ?? [];
    expect([nov?.estimate.method, nov?.estimate.rough]).toEqual(["nearestMonths", true]);
    expect(nov?.basis).toEqual({ kind: "nearestMonths", peak: used("2026-01", 4_420), comparable: [used("2026-03", 3_300)] });
    expect([dec?.estimate.method, dec?.estimate.rough]).toEqual(["nearestMonths", true]);
    expect(dec?.basis).toEqual({ kind: "nearestMonths", peak: used("2026-01", 4_420), comparable: [used("2026-01", 4_420), used("2026-02", 3_980)] });
  });

  it("says January to October 2027 are the same month this year, with no trend until there is a year of bills to compare", () => {
    const [, , jan, , , , , , , , , oct] = electricity?.months ?? [];
    expect(jan?.basis).toEqual({ kind: "sameMonthLastYear", lastYear: used("2026-01", 4_420), trend: null });
    expect(oct?.basis).toEqual({ kind: "sameMonthLastYear", lastYear: used("2026-10", 2_846), trend: null });
    expect(electricity?.months.slice(2).every((m) => m.estimate.method === "sameMonthLastYear" && !m.estimate.rough)).toBe(true);
  });

  it("shows no override and no app's own figure when you typed nothing", () => {
    expect(electricity?.months.every((m) => m.appsOwn === null && m.estimate.method !== "enteredByYou")).toBe(true);
  });
});

describe("a figure you typed for a month", () => {
  const override = () => {
    const e = electricityHousehold();
    e.b.enteredValue({ kind: "estimateOverride", subject: `${e.jobs.electricity}/2027-01`, value: kr(5_000), asOf: "2026-11-02" });
    return jobEstimate(e.b.facts(), e.jobs.electricity, electricityToday);
  };

  it("replaces the estimate for that month, says it is yours, and keeps what the app would have said", () => {
    const jan = override()?.months[2];
    expect(jan?.estimate).toMatchObject({ amount: kr(5_000), method: "enteredByYou", rough: false });
    expect(jan?.basis).toEqual({ kind: "enteredByYou" });
    expect(jan?.appsOwn).toMatchObject({ amount: kr(4_420), method: "sameMonthLastYear" });
    expect(override()?.months.filter((m) => m.appsOwn !== null)).toHaveLength(1);
  });

  it("counts in the total and the average", () => {
    expect(override()?.total.amount).toBe(kr(36_880));
    expect(override()?.monthlyAverage.amount).toBe(307_333);
  });
});

describe("the current month's bill", () => {
  it("counts what is already paid when that is more than the estimate", () => {
    const e = electricityHousehold();
    e.b.spend({ date: "2026-11-05", amount: kr(-4_000), jobId: e.jobs.electricity, accountId: e.accounts.bills });
    const november = jobEstimate(e.b.facts(), e.jobs.electricity, electricityToday);
    expect([november?.months[0]?.estimate.amount, november?.months[0]?.spent, november?.months[0]?.bill]).toEqual([kr(3_300), kr(4_000), kr(4_000)]);
    expect(november?.total.amount).toBe(kr(37_000));
  });

  it("keeps the estimate while less than that is paid", () => {
    const e = electricityHousehold();
    e.b.spend({ date: "2026-11-05", amount: kr(-1_000), jobId: e.jobs.electricity, accountId: e.accounts.bills });
    const november = jobEstimate(e.b.facts(), e.jobs.electricity, electricityToday)?.months[0];
    expect([november?.spent, november?.bill]).toEqual([kr(1_000), kr(3_300)]);
  });
});

describe("the other methods", () => {
  it("scales the same month last year by the last three months against the same three a year earlier, and says what they came to", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(0)), seasonality: "seasonal" });
    const paid: [string, number][] = [["2025-08", 1_000], ["2025-09", 1_000], ["2025-10", 1_000], ["2025-11", 2_000], ["2025-12", 1_500]];
    for (const [m, amount] of paid) b.history({ date: `${m}-10`, amount: kr(-amount), jobId: job });
    for (const m of monthRange(month("2026-01"), month("2026-07"))) b.spend({ date: `${m}-10`, amount: kr(-1_500), jobId: job });
    for (const m of ["2026-08", "2026-09", "2026-10"]) b.spend({ date: `${m}-10`, amount: kr(-1_500), jobId: job });
    const nov = jobEstimate(b.facts(), job, electricityToday)?.months[0];
    expect(nov?.estimate).toMatchObject({ amount: kr(3_000), method: "sameMonthLastYear", rough: false });
    expect(nov?.basis).toEqual({
      kind: "sameMonthLastYear",
      lastYear: used("2025-11", 2_000),
      trend: {
        recent: [used("2026-08", 1_500), used("2026-09", 1_500), used("2026-10", 1_500)],
        recentTotal: kr(4_500),
        yearBefore: [used("2025-08", 1_000), used("2025-09", 1_000), used("2025-10", 1_000)],
        yearBeforeTotal: kr(3_000),
      },
    });
  });

  it("averages the last six months of an irregular job, and names them", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(0)), seasonality: "irregular" });
    const bills = [100, 200, 300, 400, 500, 600, 700, 800];
    bills.forEach((amount, i) => b.spend({ date: `${addMonths(month("2026-01"), i)}-10`, amount: kr(-amount), jobId: job }));
    const jobMonth = jobEstimate(b.facts(), job, localDate("2026-09-12"))?.months[0];
    expect(jobMonth?.estimate).toMatchObject({ amount: kr(550), method: "average", rough: false });
    expect(jobMonth?.basis).toEqual({ kind: "average", months: [300, 400, 500, 600, 700, 800].map((amount, i) => used(addMonths(month("2026-03"), i), amount)) });
  });

  it("falls back to the calendar months closest to the mirror when the mirror has no bills", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(0)), seasonality: "seasonal" });
    [900, 500, 300].forEach((amount, i) => b.spend({ date: `${addMonths(month("2026-01"), i)}-10`, amount: kr(-amount), jobId: job }));
    const oct = jobEstimate(b.facts(), job, localDate("2026-09-12"))?.months[1];
    expect(oct?.month).toBe("2026-10");
    expect(oct?.basis).toEqual({ kind: "nearestMonths", peak: used("2026-01", 900), comparable: [used("2026-03", 300)] });
  });

  it("says there is no history for a job with no bills yet, rough and 0", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(0)) });
    const result = jobEstimate(b.facts(), job, localDate("2026-01-12"));
    expect(result?.months[0]).toMatchObject({ estimate: { amount: 0, method: "average", rough: true }, basis: { kind: "noHistory" }, appsOwn: null });
    expect(result?.total.amount).toBe(0);
    expect(result?.monthlyAverage.amount).toBe(0);
  });
});

describe("which jobs have an estimate", () => {
  it("is nothing for a job with no bills to estimate, and for a job that isn't there", () => {
    const b = factsBuilder();
    const holiday = b.saveUpJob({ target: monthlySaving(kr(500)) });
    expect(jobEstimate(b.facts(), holiday, localDate("2026-02-10"))).toBeNull();
    expect(jobEstimate(h.facts, "00000000-0000-7000-8000-00000000ffff" as typeof h.jobs.electricity, electricityToday)).toBeNull();
  });

  it("reads the facts and changes none", () => {
    const before = snapshotOf(h.facts);
    jobEstimate(h.facts, h.jobs.electricity, electricityToday);
    expect(snapshotOf(h.facts)).toEqual(before);
  });
});

describe("explainEstimate", () => {
  const history = new Map<Month, Money>([
    [month("2026-01"), kr(900)],
    [month("2026-02"), kr(500)],
    [month("2026-03"), kr(300)],
  ]);
  const input: EstimateInput = { month: month("2026-10"), history, seasonality: "seasonal" };

  it("never offers months that don't give the estimate: a figure that disagrees is unexplained, not misdescribed", () => {
    const real = estimate(input);
    expect(explainEstimate(input, real).kind).toBe("nearestMonths");
    const tampered: Estimate = { ...real, amount: money(real.amount + 1) };
    expect(explainEstimate(input, tampered)).toEqual({ kind: "unexplained" });
    expect(explainEstimate(input, { ...real, method: "average" })).toEqual({ kind: "unexplained" });
  });

  it("names the method for a figure from outside the history", () => {
    expect(explainEstimate({ ...input, fixedAmount: kr(10) }, estimate({ ...input, fixedAmount: kr(10) }))).toEqual({ kind: "fixed" });
    expect(explainEstimate({ ...input, plannedItems: [kr(10)] }, estimate({ ...input, plannedItems: [kr(10)] }))).toEqual({ kind: "plannedItems" });
  });

  it("explains every estimate of any history, and names only months that are in it", () => {
    const months = monthRange(month("2024-09"), month("2026-10"));
    const arbitraryHistory = fc
      .array(fc.option(fc.integer({ min: 1, max: 2_000_000 }), { nil: null }), { minLength: months.length, maxLength: months.length })
      .map((amounts) => new Map(months.flatMap((m, i) => (amounts[i] === null || amounts[i] === undefined ? [] : [[m, money(amounts[i] as number)] as const]))));
    fc.assert(
      fc.property(arbitraryHistory, fc.constantFrom("auto", "seasonal", "irregular"), fc.integer({ min: 0, max: 11 }), (data, seasonality, ahead) => {
        const target = addMonths(month("2026-11"), ahead);
        const asked: EstimateInput = { month: target, history: data, seasonality };
        const result = estimate(asked);
        const basis = explainEstimate(asked, result);
        expect(basis.kind).not.toBe("unexplained");
        const named = basis.kind === "average" ? basis.months : basis.kind === "nearestMonths" ? [basis.peak, ...basis.comparable] : basis.kind === "sameMonthLastYear" ? [basis.lastYear, ...(basis.trend?.recent ?? []), ...(basis.trend?.yearBefore ?? [])] : [];
        for (const u of named) expect(data.get(u.month)).toBe(u.amount);
        if (basis.kind === "noHistory") expect(data.size).toBe(0);
      }),
      { numRuns: 600 },
    );
  });
});
