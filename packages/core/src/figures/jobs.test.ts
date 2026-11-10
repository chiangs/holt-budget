import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Month, localDate, month, monthRange } from "../dates.ts";
import type { EstimateInput } from "../estimate.ts";
import { bucketPath } from "../even-out.ts";
import { overrideSubject } from "../facts.ts";
import { type Money, money } from "../money.ts";
import { arbitraryHousehold } from "../testing/arbitrary-facts.ts";
import { averageEstimate, estimateByMonth } from "../testing/estimates.ts";
import { amountByMonth, evenOut, factsBuilder, followBills, kr, monthlySaving, setAmount } from "../testing/facts-builder.ts";
import { jobIn, monthIn } from "../testing/read-figures.ts";
import { type EstimateFunction, computeFigures } from "./index.ts";

type Builder = ReturnType<typeof factsBuilder>;
const figuresOf = (b: Builder, asOf: string, estimate: EstimateFunction = averageEstimate) => computeFigures(b.facts(), localDate(asOf), { estimate });
const byMonth = (entries: Record<string, number>): ReadonlyMap<Month, Money> => new Map(Object.entries(entries).map(([m, kroner]) => [month(m), kr(kroner)]));

describe("what a planned month projects (decision record 0046)", () => {
  const estimates = estimateByMonth(byMonth({ "2026-02": 3_300, "2026-03": 4_200 }));

  it("uses the set amount, the estimate when following the bills, and the monthly amount once evened out", () => {
    const b = factsBuilder();
    const food = b.spendJob({ plan: setAmount(kr(5_000)) });
    const water = b.spendJob({ plan: followBills() });
    const electricity = b.spendJob({ plan: evenOut(kr(3_050), "2026-03") });
    const figures = figuresOf(b, "2026-01-15", estimates);

    expect(jobIn(figures, food, "2026-02").assigned).toEqual({ kind: "projection", amount: kr(5_000) });
    expect(jobIn(figures, water, "2026-02").assigned).toEqual({
      kind: "estimate",
      amount: kr(3_300),
      estimate: { month: "2026-02", amount: kr(3_300), method: "nearestMonths", rough: true },
    });
    expect(jobIn(figures, electricity, "2026-02").assigned).toMatchObject({ kind: "estimate", amount: kr(3_300) });
    expect(jobIn(figures, electricity, "2026-03").assigned).toEqual({ kind: "projection", amount: kr(3_050) });
  });

  it("spreads what a save-up job still needs over the months to its date, rounded up to whole øre, and nothing after", () => {
    const b = factsBuilder();
    const tyres = b.saveUpJob({ target: amountByMonth(kr(10_000), "2026-03") });
    const funded = b.saveUpJob({ target: amountByMonth(kr(10_000), "2026-03"), opening: kr(12_000) });
    const figures = figuresOf(b, "2026-01-15");

    expect(["2026-01", "2026-02", "2026-03", "2026-04"].map((m) => jobIn(figures, tyres, m).assigned.amount)).toEqual([333_334, 333_333, 333_333, 0]);
    expect(jobIn(figures, tyres, "2026-03").money).toEqual({ kind: "bucket", start: money(666_667), end: kr(10_000) });
    expect(jobIn(figures, funded, "2026-01").assigned.amount).toBe(0);
  });

  it("matches the Holidays mockup: 21,000 kr by June, starting in December, is 3,000 kr a month", () => {
    const b = factsBuilder({ planStart: "2025-12" });
    const holidays = b.saveUpJob({ target: amountByMonth(kr(21_000), "2026-06") });
    expect(jobIn(figuresOf(b, "2025-11-20"), holidays, "2025-12").assigned.amount).toBe(kr(3_000));
  });

  it("uses the monthly amount for a monthly save-up job, the buffer and a pay-into job", () => {
    const b = factsBuilder();
    const child = b.account({ scope: "paidInto" });
    const christmas = b.saveUpJob({ target: monthlySaving(kr(1_200)) });
    const buffer = b.buffer({ monthly: kr(2_000) });
    const eldste = b.payIntoJob({ monthly: kr(500), payInto: child });
    const figures = figuresOf(b, "2026-01-15");
    expect([christmas, buffer, eldste].map((job) => jobIn(figures, job, "2026-02").assigned)).toEqual([
      { kind: "projection", amount: kr(1_200) },
      { kind: "projection", amount: kr(2_000) },
      { kind: "projection", amount: kr(500) },
    ]);
  });

  it("projects nothing for a paused, finished or archived job, but an open month keeps what the family assigned", () => {
    const b = factsBuilder();
    const jobs = (["paused", "finished", "archived"] as const).map((status) => b.spendJob({ plan: setAmount(kr(800)), status }));
    const [paused] = jobs;
    if (paused === undefined) throw new Error("no paused job");
    b.budgetMonth("2026-01");
    b.assign("2026-01", paused, kr(700));
    const figures = figuresOf(b, "2026-01-15");

    expect(jobs.map((job) => jobIn(figures, job, "2026-02").assigned)).toEqual(jobs.map(() => ({ kind: "projection", amount: 0 })));
    expect(jobIn(figures, paused, "2026-01").assigned).toEqual({ kind: "assignment", amount: kr(700) });
  });

  it("gives an open month's job its assignment or nothing, and ignores an assignment stored in a planned month", () => {
    const b = factsBuilder();
    const food = b.spendJob({ plan: setAmount(kr(5_000)) });
    b.budgetMonth("2026-01", "closed");
    b.assign("2026-02", food, kr(9_999));
    const figures = figuresOf(b, "2026-01-15");
    expect(jobIn(figures, food, "2026-01").assigned).toEqual({ kind: "assignment", amount: 0 });
    expect(jobIn(figures, food, "2026-02").assigned).toEqual({ kind: "projection", amount: kr(5_000) });
  });

  it("passes the family's estimate override for that job and month to the estimates", () => {
    const b = factsBuilder();
    const water = b.spendJob({ plan: followBills() });
    b.enteredValue({ kind: "estimateOverride", subject: overrideSubject(water, month("2026-02")), value: kr(5_000), asOf: "2026-01-10" });
    const figures = figuresOf(b, "2026-01-15", estimates);
    expect(jobIn(figures, water, "2026-02").assigned).toMatchObject({ amount: kr(5_000), estimate: { method: "enteredByYou" } });
    expect(jobIn(figures, water, "2026-03").assigned.amount).toBe(kr(4_200));
  });
});

describe("spending, leftovers and over (decisions 2 and 13)", () => {
  const plan = () => {
    const b = factsBuilder();
    b.budgetMonth("2026-01");
    b.budgetMonth("2026-02");
    b.income({ date: "2025-12-20", amount: kr(20_000), fundsMonth: "2026-01" });
    return b;
  };

  it("returns a spend job's leftover to unassigned once the month has ended, and shows it as left until then", () => {
    const b = plan();
    const food = b.spendJob({ plan: setAmount(kr(5_000)) });
    b.assign("2026-01", food, kr(5_000));
    b.spend({ date: "2026-01-12", amount: kr(-4_200), jobId: food });

    expect(jobIn(figuresOf(b, "2026-01-31"), food, "2026-01").money).toEqual({ kind: "left", amount: kr(800) });
    const february = figuresOf(b, "2026-02-01");
    expect(jobIn(february, food, "2026-01").money).toEqual({ kind: "returned", amount: kr(800) });
    expect(monthIn(february, "2026-02").carriedIn).toBe(kr(15_000 + 800));
  });

  it("keeps the leftover in the bucket when the job carries over", () => {
    const b = plan();
    const car = b.spendJob({ plan: setAmount(kr(3_200)), keepsMoney: true });
    b.assign("2026-01", car, kr(3_200));
    b.assign("2026-02", car, kr(3_200));
    b.spend({ date: "2026-01-12", amount: kr(-640), jobId: car });

    const figures = figuresOf(b, "2026-02-10");
    expect(jobIn(figures, car, "2026-01").money).toEqual({ kind: "bucket", start: 0, end: kr(2_560) });
    expect(jobIn(figures, car, "2026-02").money).toEqual({ kind: "bucket", start: kr(2_560), end: kr(5_760) });
    expect(monthIn(figures, "2026-02").carriedIn).toBe(kr(16_800));
    expect(figures.jobs.get(car)?.bucket).toEqual({ kind: "kept", balance: kr(5_760) });
  });

  it("shows a job that spent more than assigned as over, keeps it there, and leaves next month's money alone", () => {
    const b = plan();
    const food = b.spendJob({ plan: setAmount(kr(5_000)) });
    b.assign("2026-01", food, kr(5_000));
    b.assign("2026-02", food, kr(5_000));
    b.spend({ date: "2026-01-12", amount: kr(-5_500), jobId: food });

    const figures = figuresOf(b, "2026-03-10");
    expect(jobIn(figures, food, "2026-01").money).toEqual({ kind: "over", amount: kr(500) });
    expect(monthIn(figures, "2026-02").carriedIn).toBe(kr(15_000));
    expect(jobIn(figures, food, "2026-02").money).toEqual({ kind: "returned", amount: kr(5_000) });
    expect(figures.jobs.get(food)?.bucket).toEqual({ kind: "absent" });
  });

  it("keeps an evened-out job's money in its bucket, whatever its carry-over switch says", () => {
    const b = plan();
    const electricity = b.spendJob({ plan: evenOut(kr(3_050), "2026-01"), keepsMoney: false, opening: kr(4_100) });
    b.assign("2026-01", electricity, kr(3_050));
    b.spend({ date: "2026-01-19", amount: kr(-3_300), jobId: electricity });
    const figures = figuresOf(b, "2026-02-10");
    expect(jobIn(figures, electricity, "2026-01").money).toEqual({ kind: "bucket", start: kr(4_100), end: kr(3_850) });
    expect(monthIn(figures, "2026-02").carriedIn).toBe(kr(20_000 - 3_050));
  });

  it("keeps the bucket of a paused or archived job in its account", () => {
    const b = plan();
    const bike = b.saveUpJob({ target: monthlySaving(kr(500)), status: "paused", opening: kr(1_500) });
    const old = b.spendJob({ plan: setAmount(kr(400)), keepsMoney: true, status: "archived", opening: kr(250) });
    const figures = figuresOf(b, "2026-02-10");
    expect(figures.jobs.get(bike)?.bucket).toEqual({ kind: "kept", balance: kr(1_500) });
    expect(figures.accounts.get(b.defaultAccount())?.buckets).toEqual([
      { jobId: bike, amount: kr(1_500) },
      { jobId: old, amount: kr(250) },
    ]);
  });

  it("shows a bucket that ends a month below zero as short", () => {
    const b = plan();
    const electricity = b.spendJob({ plan: evenOut(kr(3_050), "2026-01") });
    b.assign("2026-01", electricity, kr(3_050));
    b.spend({ date: "2026-01-19", amount: kr(-4_420), jobId: electricity });
    expect(jobIn(figuresOf(b, "2026-01-25"), electricity, "2026-01").money).toEqual({ kind: "short", start: 0, end: kr(-1_370) });
  });

  it("counts a refund as less spent, and a split against each of its jobs", () => {
    const b = plan();
    const food = b.spendJob({ plan: setAmount(kr(5_000)) });
    const clothes = b.spendJob({ plan: setAmount(kr(2_800)) });
    b.spend({ date: "2026-01-05", amount: kr(-1_000), jobId: food });
    b.spend({ date: "2026-01-09", amount: kr(300), jobId: food });
    b.split({ date: "2026-01-12", allocations: [[food, kr(-600)], [clothes, kr(-400)]] });

    const figures = figuresOf(b, "2026-01-25");
    expect(jobIn(figures, food, "2026-01").spent).toBe(kr(1_300));
    expect(jobIn(figures, clothes, "2026-01").spent).toBe(kr(400));
  });
});

describe("history (decision 10)", () => {
  it("informs the estimates but never a bucket", () => {
    const b = factsBuilder();
    const electricity = b.spendJob({ plan: evenOut(kr(3_050), "2026-01"), opening: kr(2_000) });
    b.history({ date: "2025-12-19", amount: kr(-4_000), jobId: electricity });
    b.history({ date: "2025-12-19", amount: kr(-999) });
    b.spend({ date: "2026-01-19", amount: kr(-3_000), jobId: electricity });
    b.spend({ date: "2026-02-03", amount: kr(-500), jobId: electricity });

    const asked: EstimateInput[] = [];
    const figures = figuresOf(b, "2026-02-10", (input) => {
      asked.push(input);
      return averageEstimate(input);
    });

    expect(jobIn(figures, electricity, "2026-01").spent).toBe(kr(3_000));
    expect(jobIn(figures, electricity, "2026-01").money).toEqual({ kind: "bucket", start: kr(2_000), end: kr(2_050) });
    expect(asked.length).toBeGreaterThan(0);
    for (const input of asked) {
      expect([...input.history]).toEqual([
        ["2025-12", kr(4_000)],
        ["2026-01", kr(3_000)],
      ]);
    }
  });

  it("leaves out a month whose refunds outweigh its spending", () => {
    const b = factsBuilder();
    const water = b.spendJob({ plan: followBills() });
    b.spend({ date: "2026-01-19", amount: kr(500), jobId: water });
    b.spend({ date: "2026-02-19", amount: kr(-600), jobId: water });
    const asked: EstimateInput[] = [];
    figuresOf(b, "2026-03-10", (input) => {
      asked.push(input);
      return averageEstimate(input);
    });
    expect([...(asked[0]?.history ?? [])]).toEqual([["2026-02", kr(600)]]);
  });
});

describe("estimates are never actuals (rule 12)", () => {
  it("shows what was spent once a month has ended, and the estimate with its method before that", () => {
    const b = factsBuilder();
    const electricity = b.spendJob({ plan: followBills() });
    const holidays = b.saveUpJob({ target: monthlySaving(kr(3_000)) });
    b.spend({ date: "2026-01-19", amount: kr(-3_412), jobId: electricity });
    const figures = figuresOf(b, "2026-02-10", estimateByMonth(byMonth({ "2026-01": 4_420, "2026-02": 3_980 })));

    expect(jobIn(figures, electricity, "2026-01").cost).toEqual({ kind: "actual", amount: kr(3_412) });
    expect(jobIn(figures, electricity, "2026-02").cost).toEqual({
      kind: "estimate",
      estimate: { month: "2026-02", amount: kr(3_980), method: "nearestMonths", rough: true },
    });
    expect(jobIn(figures, electricity, "2026-02").spent).toBe(0);
    expect(jobIn(figures, holidays, "2026-02").cost).toEqual({ kind: "notEstimated" });
    expect(jobIn(figures, holidays, "2026-01").cost).toEqual({ kind: "actual", amount: 0 });
  });

  it("never lets an estimate change what was spent or an ended month's cost", () => {
    const huge = (input: EstimateInput) => ({ month: input.month, amount: kr(99_999), method: "fixed" as const, rough: false });
    fc.assert(
      fc.property(arbitraryHousehold(), ({ facts, asOf }) => {
        const ordinary = computeFigures(facts, asOf, { estimate: averageEstimate });
        const inflated = computeFigures(facts, asOf, { estimate: huge });
        for (const [m, monthFigures] of ordinary.months) {
          for (const [job, jobMonth] of monthFigures.jobs) {
            const other = inflated.months.get(m)?.jobs.get(job);
            expect(other?.spent).toBe(jobMonth.spent);
            if (monthFigures.timing === "ended") expect(other?.cost).toEqual(jobMonth.cost);
            else expect(jobMonth.cost.kind).not.toBe("actual");
          }
        }
      }),
    );
  });
});

describe("the Electricity mockup (design/README.md), through bucketPath", () => {
  const bills = [3300, 4200, 4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846].map(kr);
  const billMonths = monthRange(month("2026-11"), month("2027-10"));
  const monthly = kr(3_050);

  const electricityYear = (plan: ReturnType<typeof evenOut>, opening: Money) => {
    const b = factsBuilder({ planStart: "2026-11" });
    const electricity = b.spendJob({ plan, opening, seasonality: "seasonal" });
    billMonths.forEach((m, i) => b.spend({ date: `${m}-19`, amount: money(-(bills[i] ?? 0)), jobId: electricity }));
    const estimate = estimateByMonth(new Map(billMonths.map((m, i) => [m, bills[i] ?? money(0)])));
    const figures = computeFigures(b.facts(), localDate("2027-11-05"), { estimate });
    return billMonths.map((m) => jobIn(figures, electricity, m));
  };

  it("starting now with 4,100 kr stays above zero, lowest 150 kr in March, 4,400 kr by October", () => {
    const year = electricityYear(evenOut(monthly, "2026-11"), kr(4_100));
    const ends = year.map((j) => (j.money.kind === "bucket" ? j.money.end : null));
    expect(ends).toEqual([3850, 2700, 1330, 400, 150, 500, 1356, 2536, 3766, 4056, 4196, 4400].map(kr));
    expect(ends).toEqual(bucketPath({ bills, monthly, seed: kr(4_100) }).map((m) => m.bucketEnd));
  });

  it("starting in April follows the bills until then and fills to 4,250 kr by October", () => {
    const year = electricityYear(evenOut(monthly, "2027-04"), kr(0));
    const path = bucketPath({ bills, monthly, startIndex: 5 });
    year.forEach((jobMonth, i) => {
      const step = path[i];
      expect(jobMonth.assigned.amount).toBe(step?.planned);
      expect(jobMonth.money).toMatchObject({ kind: "bucket", end: step?.bucketEnd ?? 0 });
    });
    expect(year.slice(0, 5).every((j) => j.assigned.kind === "estimate")).toBe(true);
    expect(year.at(-1)?.money).toMatchObject({ end: kr(4_250) });
  });
});
