import { describe, expect, it } from "vitest";
import { localDate } from "../dates.ts";
import { electricityBillsKroner, electricityHousehold, electricityToday } from "../testing/electricity-household.ts";
import { factsBuilder, kr, setAmount } from "../testing/facts-builder.ts";
import { jobHistory } from "./job-history.ts";

describe("the Electricity job's year, with the mockup's numbers", () => {
  const h = electricityHousehold();
  const history = jobHistory(h.facts, h.jobs.electricity, electricityToday);

  it("totals the months that have ended: January to October, 28,800 kr paid, 2,880 kr a month on average", () => {
    expect(history?.ended).toEqual({ months: 10, from: "2026-01", to: "2026-10", planned: kr(29_000), paid: kr(28_800), averagePaid: kr(2_880) });
  });

  it("lists January to November, with each month's plan and what was paid", () => {
    expect(history?.months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(history?.months.slice(0, 10).map((m) => m.paid)).toEqual(electricityBillsKroner.map(kr));
    expect(history?.months.map((m) => m.planned)).toEqual(Array(11).fill(kr(2_900)));
  });

  it("says November is open and still waiting for its bill, and the earlier months are closed and done", () => {
    const [january, ...rest] = history?.months ?? [];
    const november = rest.at(-1);
    expect([january?.state, january?.stillComing]).toEqual(["closed", false]);
    expect([november?.state, november?.stillComing, november?.paid]).toEqual(["open", true, 0]);
    expect(rest.slice(0, -1).every((m) => m.state === "closed" && !m.stillComing)).toBe(true);
  });

  it("gives the last three months as the mockup says: planned 2,900 each, paid 2,760, 2,910 and 2,846, 184 kr under", () => {
    expect(history?.recent.months.map((m) => [m.month, m.planned, m.paid])).toEqual([
      ["2026-08", kr(2_900), kr(2_760)],
      ["2026-09", kr(2_900), kr(2_910)],
      ["2026-10", kr(2_900), kr(2_846)],
    ]);
    expect(history?.recent).toMatchObject({ planned: kr(8_700), paid: kr(8_516), underBy: kr(184) });
  });

  it("gives an underBy of 0 when each bill matched the plan, and a negative one when the family paid more than planned", () => {
    const matching = electricityHousehold({ assignedBefore: "matchingBills" });
    expect(jobHistory(matching.facts, matching.jobs.electricity, electricityToday)?.recent.underBy).toBe(0);
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(1_000)) });
    for (const m of ["2026-01", "2026-02", "2026-03"]) {
      b.budgetMonth(m, "closed");
      b.assign(m, job, kr(1_000));
      b.spend({ date: `${m}-10`, amount: kr(-1_200), jobId: job });
    }
    expect(jobHistory(b.facts(), job, localDate("2026-04-05"))?.recent).toMatchObject({ planned: kr(3_000), paid: kr(3_600), underBy: kr(-600) });
  });
});

describe("a job with less than a year of record", () => {
  it("starts at its first month with a plan or a bill, so empty earlier months don't pull the average down", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(500)) });
    for (const m of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) b.budgetMonth(m, "closed");
    b.budgetMonth("2026-06", "open");
    for (const m of ["2026-04", "2026-05", "2026-06"]) b.assign(m, job, kr(500));
    b.spend({ date: "2026-04-10", amount: kr(-400), jobId: job });
    b.spend({ date: "2026-05-10", amount: kr(-600), jobId: job });
    const history = jobHistory(b.facts(), job, localDate("2026-06-12"));
    expect(history?.months.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(history?.ended).toMatchObject({ months: 2, from: "2026-04", to: "2026-05", paid: kr(1_000), averagePaid: kr(500) });
  });

  it("keeps a month with a bill but no plan, because money was paid in it", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(500)) });
    b.budgetMonth("2026-01", "closed");
    b.budgetMonth("2026-02", "open");
    b.spend({ date: "2026-01-20", amount: kr(-300), jobId: job });
    const history = jobHistory(b.facts(), job, localDate("2026-02-12"));
    expect(history?.months.map((m) => [m.month, m.planned, m.paid])).toEqual([
      ["2026-01", 0, kr(300)],
      ["2026-02", 0, 0],
    ]);
  });

  it("reads history from before the plan starts as paid with no plan, and counts it in the totals", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(500)) });
    b.history({ date: "2025-11-14", amount: kr(-700), jobId: job });
    b.history({ date: "2025-12-14", amount: kr(-900), jobId: job });
    b.budgetMonth("2026-01", "open");
    b.assign("2026-01", job, kr(500));
    const history = jobHistory(b.facts(), job, localDate("2026-01-10"));
    expect(history?.months.map((m) => [m.month, m.state, m.planned, m.paid])).toEqual([
      ["2025-11", "history", null, kr(700)],
      ["2025-12", "history", null, kr(900)],
      ["2026-01", "open", kr(500), 0],
    ]);
    expect(history?.ended).toMatchObject({ months: 2, from: "2025-11", to: "2025-12", planned: 0, paid: kr(1_600), averagePaid: kr(800) });
  });

  it("is only the current month for a job with no record at all, and has no average", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(0)) });
    b.budgetMonth("2026-01", "open");
    const history = jobHistory(b.facts(), job, localDate("2026-01-10"));
    expect(history?.months.map((m) => [m.month, m.stillComing])).toEqual([["2026-01", true]]);
    expect(history?.ended).toEqual({ months: 0, from: null, to: null, planned: 0, paid: 0, averagePaid: null });
    expect(history?.recent).toEqual({ months: [], planned: 0, paid: 0, underBy: 0 });
  });
});

describe("a long record", () => {
  it("reaches back twelve months, the current one included, and no further", () => {
    const b = factsBuilder({ planStart: "2025-01" });
    const job = b.spendJob({ plan: setAmount(kr(1_000)) });
    for (let i = 1; i <= 12; i++) {
      const m = `2025-${String(i).padStart(2, "0")}`;
      b.budgetMonth(m, "closed");
      b.assign(m, job, kr(1_000));
      b.spend({ date: `${m}-10`, amount: kr(-i * 100), jobId: job });
    }
    b.budgetMonth("2026-01", "open");
    b.assign("2026-01", job, kr(1_000));
    const history = jobHistory(b.facts(), job, localDate("2026-01-20"));
    expect(history?.months).toHaveLength(12);
    expect(history?.months[0]?.month).toBe("2025-02");
    expect(history?.months.at(-1)?.month).toBe("2026-01");
    expect(history?.ended).toMatchObject({ months: 11, from: "2025-02", to: "2025-12", paid: kr(7_700) });
  });
});

describe("what a refund and a reopened month do", () => {
  it("lets a refund reduce what was paid", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(500)) });
    b.budgetMonth("2026-01", "closed");
    b.budgetMonth("2026-02", "open");
    b.assign("2026-01", job, kr(500));
    b.spend({ date: "2026-01-10", amount: kr(-800), jobId: job });
    b.spend({ date: "2026-01-20", amount: kr(300), jobId: job });
    expect(jobHistory(b.facts(), job, localDate("2026-02-05"))?.months[0]?.paid).toBe(kr(500));
  });

  it("shows a reopened month as reopened", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(500)) });
    b.budgetMonth("2026-01", "reopened");
    b.budgetMonth("2026-02", "open");
    b.assign("2026-01", job, kr(500));
    expect(jobHistory(b.facts(), job, localDate("2026-02-05"))?.months[0]?.state).toBe("reopened");
  });

  it("reads a month the family hasn't opened as the plan's projection, and ignores spending booked after today", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const job = b.spendJob({ plan: setAmount(kr(500)) });
    b.spend({ date: "2026-02-20", amount: kr(-999), jobId: job });
    const history = jobHistory(b.facts(), job, localDate("2026-02-05"));
    expect(history?.months.at(-1)).toMatchObject({ month: "2026-02", state: "planned", planned: kr(500), paid: 0, stillComing: true });
  });

  it("is nothing for a job that isn't there", () => {
    const h = electricityHousehold();
    expect(jobHistory(h.facts, "00000000-0000-7000-8000-00000000ffff" as typeof h.jobs.electricity, electricityToday)).toBeNull();
  });
});
