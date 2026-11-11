import { describe, expect, it } from "vitest";
import { localDate, month } from "../dates.ts";
import { type Money, money } from "../money.ts";
import { electricityEstimatesKroner, electricityHousehold, electricityToday } from "../testing/electricity-household.ts";
import { evenOut, factsBuilder, followBills, kr, monthlySaving } from "../testing/facts-builder.ts";
import { snapshotOf } from "../testing/variable-cost-household.ts";
import { forecastFromFigures, forecastMonths, jobForecast } from "./forecast.ts";
import { computeFigures } from "./index.ts";

const kroner = (amounts: readonly number[]): Money[] => amounts.map(kr);
const bucketEnds = (forecast: ReturnType<typeof jobForecast>): number[] => (forecast?.months ?? []).map((m) => m.bucketEnd);

/** The Electricity job evened out from November at 3,050 kr a month, with the bucket empty to begin with. */
function evened(seed: Money | null = null) {
  const h = electricityHousehold({ assignedBefore: "matchingBills", plan: evenOut(kr(3_050), "2026-11"), novemberAssigned: kr(3_050) });
  if (seed !== null) h.b.bucketTransfer({ month: "2026-11", from: h.jobs.buffer, to: h.jobs.electricity, amount: seed, reason: "Start evening out" });
  return { ...h, facts: h.b.facts() };
}

describe("the Electricity forecast, with the mockup's numbers", () => {
  it("with 4,100 kr moved from the buffer, gives the mockup's bucket row month by month", () => {
    const h = evened(kr(4_100));
    const forecast = jobForecast(h.facts, h.jobs.electricity, electricityToday);
    expect(forecast?.months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"]);
    expect(bucketEnds(forecast)).toEqual(kroner([3850, 2700, 1330, 400, 150, 500, 1356, 2536, 3766, 4056, 4196, 4400]));
    expect(forecast?.months.map((m) => m.planned)).toEqual(Array(12).fill(kr(3_050)));
    expect(forecast?.months.map((m) => m.bill)).toEqual(kroner(electricityEstimatesKroner));
    expect(forecast?.lowest).toEqual({ month: "2027-03", amount: kr(150) });
    expect(forecast?.runsDryIn).toBeNull();
    expect(forecast?.startsWith).toBe(0);
  });

  it("with nothing moved in, runs dry in November and is lowest in March by 3,950 kr, the seed the mockup's winter needs", () => {
    const h = evened();
    const forecast = jobForecast(h.facts, h.jobs.electricity, electricityToday);
    expect(bucketEnds(forecast)).toEqual(kroner([-250, -1400, -2770, -3700, -3950, -3600, -2744, -1564, -334, -44, 96, 300]));
    expect(forecast?.runsDryIn).toBe("2026-11");
    expect(forecast?.lowest).toEqual({ month: "2027-03", amount: kr(-3_950) });
  });

  it("names each estimate with its method, so the screen can mark November and December as rough", () => {
    const h = evened();
    const forecast = jobForecast(h.facts, h.jobs.electricity, electricityToday);
    const [nov, dec, jan] = forecast?.months ?? [];
    expect([nov?.estimate?.method, nov?.estimate?.rough]).toEqual(["nearestMonths", true]);
    expect([dec?.estimate?.method, dec?.estimate?.rough]).toEqual(["nearestMonths", true]);
    expect([jan?.estimate?.method, jan?.estimate?.rough]).toEqual(["sameMonthLastYear", false]);
    expect(forecastMonths).toBe(12);
  });
});

describe("the boundary between a bucket that holds and one that runs dry", () => {
  it("a bucket that touches zero exactly does not run dry, and one krone short of it does, in March", () => {
    const exact = evened(kr(3_950));
    const forecast = jobForecast(exact.facts, exact.jobs.electricity, electricityToday);
    expect(forecast?.lowest).toEqual({ month: "2027-03", amount: 0 });
    expect(forecast?.runsDryIn).toBeNull();

    const short = evened(money(kr(3_950) - 1));
    const dry = jobForecast(short.facts, short.jobs.electricity, electricityToday);
    expect(dry?.lowest).toEqual({ month: "2027-03", amount: -1 });
    expect(dry?.runsDryIn).toBe("2027-03");
  });

  it("names the earliest month at the lowest point when two share it", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: evenOut(kr(1_000), "2026-01"), seasonality: "irregular" });
    b.budgetMonth("2026-01");
    b.assign("2026-01", job, kr(1_000));
    for (const [m, bill] of [["2025-11", 1_000], ["2025-12", 1_000]] as const) b.history({ date: `${m}-10`, amount: kr(-bill), jobId: job });
    const forecast = jobForecast(b.facts(), job, localDate("2026-01-15"));
    expect(forecast?.lowest.month).toBe("2026-01");
    expect(forecast?.months.every((m) => m.bucketEnd === 0)).toBe(true);
    expect(forecast?.runsDryIn).toBeNull();
  });
});

describe("the current month", () => {
  it("takes out the estimate, 3,300 kr, while less than that is paid, and the bill itself once it passes the estimate", () => {
    const small = evened();
    small.b.spend({ date: "2026-11-05", amount: kr(-1_000), jobId: small.jobs.electricity, accountId: small.accounts.bills });
    const partly = jobForecast(small.b.facts(), small.jobs.electricity, electricityToday)?.months[0];
    expect([partly?.spent, partly?.bill, partly?.bucketEnd]).toEqual([kr(1_000), kr(3_300), kr(-250)]);

    const large = evened();
    large.b.spend({ date: "2026-11-05", amount: kr(-4_000), jobId: large.jobs.electricity, accountId: large.accounts.bills });
    const over = jobForecast(large.b.facts(), large.jobs.electricity, electricityToday)?.months[0];
    expect([over?.spent, over?.bill, over?.bucketEnd]).toEqual([kr(4_000), kr(4_000), kr(-950)]);
  });

  it("agrees with the figures for the month once its spending is at or above the estimate", () => {
    const h = evened(kr(4_100));
    h.b.spend({ date: "2026-11-05", amount: kr(-3_400), jobId: h.jobs.electricity, accountId: h.accounts.bills });
    const facts = h.b.facts();
    const figures = computeFigures(facts, electricityToday).jobs.get(h.jobs.electricity);
    const november = figures?.months.get(month("2026-11"))?.money;
    expect(jobForecast(facts, h.jobs.electricity, electricityToday)?.months[0]?.bucketEnd).toBe(november?.kind === "bucket" ? november.end : Number.NaN);
  });
});

describe("what changes a month's bill or bucket", () => {
  it("takes a figure you typed for a month instead of the estimate, and says so", () => {
    const h = evened(kr(4_100));
    h.b.enteredValue({ kind: "estimateOverride", subject: `${h.jobs.electricity}/2027-01`, value: kr(5_000), asOf: "2026-11-02" });
    const forecast = jobForecast(h.b.facts(), h.jobs.electricity, electricityToday);
    const jan = forecast?.months[2];
    expect([jan?.estimate?.method, jan?.bill]).toEqual(["enteredByYou", kr(5_000)]);
    expect(forecast?.months[1]?.bucketEnd).toBe(kr(2_700));
    expect(jan?.bucketEnd).toBe(kr(750));
  });

  it("counts a move between buckets in the month it was made, in and out", () => {
    const h = evened(kr(4_100));
    h.b.bucketTransfer({ month: "2026-11", from: h.jobs.electricity, to: h.jobs.buffer, amount: kr(500), reason: "Back to the buffer" });
    const forecast = jobForecast(h.b.facts(), h.jobs.electricity, electricityToday);
    const nov = forecast?.months[0];
    expect([nov?.transfersIn, nov?.transfersOut, nov?.bucketEnd]).toEqual([kr(4_100), kr(500), kr(3_350)]);
  });

  it("follows what the family assigned in a month they opened, and the plan's amount in one they haven't", () => {
    const h = electricityHousehold({ assignedBefore: "matchingBills", plan: evenOut(kr(3_050), "2026-11"), novemberAssigned: kr(2_000) });
    h.b.budgetMonth("2026-12");
    h.b.assign("2026-12", h.jobs.electricity, kr(3_500));
    const forecast = jobForecast(h.b.facts(), h.jobs.electricity, electricityToday);
    expect(forecast?.months.slice(0, 3).map((m) => [m.state, m.planned])).toEqual([
      ["open", kr(2_000)],
      ["open", kr(3_500)],
      ["planned", kr(3_050)],
    ]);
  });
});

describe("which jobs have a forecast", () => {
  it("is nothing for a job that keeps no money, and for a job that isn't there", () => {
    const h = electricityHousehold();
    expect(jobForecast(h.facts, h.jobs.electricity, electricityToday)).toBeNull();
    const b = factsBuilder();
    const water = b.spendJob({ plan: followBills() });
    expect(jobForecast(b.facts(), water, localDate("2026-02-10"))).toBeNull();
    expect(jobForecast(h.facts, h.jobs.buffer, electricityToday)).not.toBeNull();
    expect(jobForecast(h.facts, "00000000-0000-7000-8000-00000000ffff" as typeof h.jobs.electricity, electricityToday)).toBeNull();
  });

  it("is nothing before the plan starts, because there is no month to forecast", () => {
    const b = factsBuilder({ planStart: "2027-03" });
    const job = b.spendJob({ plan: evenOut(kr(1_000), "2027-03") });
    expect(jobForecast(b.facts(), job, localDate("2026-11-10"))).toBeNull();
  });

  it("gives a save-up job its bucket growing by the plan, with no bill to take out", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const holiday = b.saveUpJob({ target: monthlySaving(kr(500)), opening: kr(1_000) });
    b.budgetMonth("2026-01");
    b.assign("2026-01", holiday, kr(500));
    const forecast = jobForecast(b.facts(), holiday, localDate("2026-01-12"));
    expect(forecast?.months.every((m) => m.estimate === null && m.bill === 0)).toBe(true);
    expect(bucketEnds(forecast)).toEqual(kroner([1_500, 2_000, 2_500, 3_000, 3_500, 4_000, 4_500, 5_000, 5_500, 6_000, 6_500, 7_000]));
  });

  it("takes this month's spending out of a save-up job's bucket", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const holiday = b.saveUpJob({ target: monthlySaving(kr(500)), opening: kr(1_000) });
    b.budgetMonth("2026-01");
    b.assign("2026-01", holiday, kr(500));
    b.spend({ date: "2026-01-05", amount: kr(-300), jobId: holiday });
    expect(jobForecast(b.facts(), holiday, localDate("2026-01-12"))?.months[0]?.bucketEnd).toBe(kr(1_200));
  });
});

describe("a forecast from figures a screen already holds", () => {
  it("is the forecast the facts give, taking the twelve months from figures that reach a thirteenth", () => {
    const h = evened(kr(4_100));
    const figures = computeFigures(h.facts, electricityToday);
    expect(figures.months.size).toBeGreaterThan(forecastMonths);
    expect(forecastFromFigures(figures, h.jobs.electricity)).toEqual(jobForecast(h.facts, h.jobs.electricity, electricityToday));
  });
});

describe("a forecast reads the facts and changes none", () => {
  it("leaves every table as it was", () => {
    const h = evened(kr(4_100));
    const before = snapshotOf(h.facts);
    jobForecast(h.facts, h.jobs.electricity, electricityToday);
    expect(snapshotOf(h.facts)).toEqual(before);
  });
});
