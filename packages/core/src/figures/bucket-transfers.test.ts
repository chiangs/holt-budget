import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { localDate } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { money } from "../money.ts";
import { arbitraryHousehold } from "../testing/arbitrary-facts.ts";
import { averageEstimate } from "../testing/estimates.ts";
import { amountByMonth, factsBuilder, kr, monthlySaving } from "../testing/facts-builder.ts";
import { accountIn, jobIn, monthIn } from "../testing/read-figures.ts";
import { transferHousehold, transferToday } from "../testing/transfer-household.ts";
import { type Figures, computeFigures, keepsMoney } from "./index.ts";

const figuresOf = (facts: Facts, asOf = transferToday): Figures => computeFigures(facts, asOf, { estimate: averageEstimate });

describe("a bucket ends the month with what it started with, plus assigned and transfers in, less transfers out and spending (0048)", () => {
  /** Electricity gives its whole 800 kr to Holiday in November. */
  const electricityToHoliday = () => {
    const h = transferHousehold();
    h.b.bucketTransfer({ month: "2026-11", from: h.jobs.electricity, to: h.jobs.holiday, amount: kr(800) });
    return { jobs: h.jobs, figures: figuresOf(h.b.facts()) };
  };

  it("counts a transfer in the month it is made, for the job that gives and the job that gets", () => {
    const { jobs, figures } = electricityToHoliday();
    expect(jobIn(figures, jobs.electricity, "2026-11")).toMatchObject({ transfersIn: 0, transfersOut: kr(800), money: { kind: "bucket", start: kr(1_800), end: 0 } });
    expect(jobIn(figures, jobs.holiday, "2026-11")).toMatchObject({ transfersIn: kr(800), transfersOut: 0, money: { kind: "bucket", start: kr(1_500), end: kr(2_800) } });
  });

  it("leaves the months before it alone, and carries the new bucket into the months after it, planned ones included", () => {
    const { jobs, figures } = electricityToHoliday();
    expect(jobIn(figures, jobs.holiday, "2026-10").money).toEqual({ kind: "bucket", start: kr(1_000), end: kr(1_500) });
    expect(jobIn(figures, jobs.electricity, "2026-10").money).toEqual({ kind: "bucket", start: 0, end: kr(1_800) });
    expect(jobIn(figures, jobs.holiday, "2026-12").money).toMatchObject({ kind: "bucket", start: kr(2_800), end: kr(3_300) });
    expect(jobIn(figures, jobs.electricity, "2026-12").money).toMatchObject({ start: 0 });
  });

  it("takes a transfer in October on into November, as the November bucket's start", () => {
    const again = transferHousehold();
    again.b.bucketTransfer({ month: "2026-10", from: again.jobs.holiday, to: again.jobs.buffer, amount: kr(1_500) });
    const figures = figuresOf(again.b.facts());
    expect(jobIn(figures, again.jobs.holiday, "2026-10").money).toMatchObject({ end: 0 });
    expect(jobIn(figures, again.jobs.holiday, "2026-11").money).toMatchObject({ start: 0, end: kr(500) });
    expect(jobIn(figures, again.jobs.buffer, "2026-11").money).toMatchObject({ start: kr(13_500), end: kr(15_500) });
  });

  it("adds several transfers in a month, in and out", () => {
    const many = transferHousehold();
    many.b.bucketTransfer({ month: "2026-11", from: many.jobs.holiday, to: many.jobs.electricity, amount: kr(300) });
    many.b.bucketTransfer({ month: "2026-11", from: many.jobs.holiday, to: many.jobs.electricity, amount: kr(200) });
    many.b.bucketTransfer({ month: "2026-11", from: many.jobs.electricity, to: many.jobs.holiday, amount: kr(100) });
    const figures = figuresOf(many.b.facts());
    expect(jobIn(figures, many.jobs.holiday, "2026-11")).toMatchObject({ transfersIn: kr(100), transfersOut: kr(500), money: { end: kr(1_600) } });
    expect(jobIn(figures, many.jobs.electricity, "2026-11")).toMatchObject({ transfersIn: kr(500), transfersOut: kr(100), money: { end: kr(1_200) } });
  });

  it("shows a bucket that is below zero as short, whatever way it got there", () => {
    const short = transferHousehold();
    short.b.bucketTransfer({ month: "2026-11", from: short.jobs.electricity, to: short.jobs.holiday, amount: kr(1_000) });
    expect(jobIn(figuresOf(short.b.facts()), short.jobs.electricity, "2026-11").money).toEqual({ kind: "short", start: kr(1_800), end: kr(-200) });
  });
});

describe("a transfer is neither income nor spending", () => {
  const plain = transferHousehold();
  const moved = transferHousehold();
  moved.b.bucketTransfer({ month: "2026-11", from: moved.jobs.buffer, to: moved.jobs.electricity, amount: kr(4_100), reason: "Start evening out" });
  moved.b.bucketTransfer({ month: "2026-10", from: moved.jobs.holiday, to: moved.jobs.buffer, amount: kr(700) });

  it("leaves the money available, the assigned total, what is unassigned and what carries on in every month as it was", () => {
    const before = figuresOf(plain.facts);
    const after = figuresOf(moved.b.facts());
    for (const m of ["2026-10", "2026-11", "2026-12", "2027-03"]) {
      const { available, assigned, unassigned, carriedIn, returned, income } = monthIn(before, m);
      expect(monthIn(after, m)).toMatchObject({ available, assigned, unassigned, carriedIn, returned, income });
    }
    expect(after.nextMonthsMoney).toEqual(before.nextMonthsMoney);
  });

  it("leaves what each job was assigned and spent as it was", () => {
    const before = figuresOf(plain.facts);
    const after = figuresOf(moved.b.facts());
    for (const job of Object.values(plain.jobs)) {
      for (const m of ["2026-10", "2026-11", "2026-12"]) expect(jobIn(after, job, m)).toMatchObject({ assigned: jobIn(before, job, m).assigned, spent: jobIn(before, job, m).spent });
    }
  });

  it("leaves every account's balance as it was", () => {
    const before = figuresOf(plain.facts);
    const after = figuresOf(moved.b.facts());
    for (const account of Object.values(plain.accounts)) expect(accountIn(after, account).balance).toEqual(accountIn(before, account).balance);
  });
});

describe("a month that is only planned", () => {
  it("projects less for a save-up job with a target date once a transfer has put money in its bucket, because it needs less (12,000 kr over 11 months, then 6,000 kr, each rounded up)", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    b.account({ openingBalance: kr(50_000) });
    b.group();
    b.buffer({ monthly: kr(0) });
    const car = b.saveUpJob({ name: "Car", target: amountByMonth(kr(12_000), "2026-12") });
    const holiday = b.saveUpJob({ name: "Holiday", target: monthlySaving(kr(0)), opening: kr(6_000) });
    b.budgetMonth("2026-01");
    const asOf = localDate("2026-01-20");
    expect(monthIn(computeFigures(b.facts(), asOf), "2026-02").jobs.get(car)?.assigned).toEqual({ kind: "projection", amount: 109_091 });
    b.bucketTransfer({ month: "2026-01", from: holiday, to: car, amount: kr(6_000), reason: "" });
    expect(monthIn(computeFigures(b.facts(), asOf), "2026-02").jobs.get(car)?.assigned).toEqual({ kind: "projection", amount: 54_546 });
  });
});

describe("where the money sits after a transfer (rule 6)", () => {
  it("between two jobs in one account changes the buckets and nothing else about the account", () => {
    const same = transferHousehold();
    same.b.bucketTransfer({ month: "2026-11", from: same.jobs.buffer, to: same.jobs.holiday, amount: kr(500), reason: "Top up Holiday" });
    const before = accountIn(figuresOf(same.facts), same.accounts.savings);
    const after = accountIn(figuresOf(same.b.facts()), same.accounts.savings);
    expect(after.balance).toEqual(before.balance);
    expect(after.bucketed).toBe(before.bucketed);
    expect(after.remainder).toEqual(before.remainder);
    expect(after.buckets).toEqual([
      { jobId: same.jobs.buffer, amount: kr(13_500) },
      { jobId: same.jobs.holiday, amount: kr(2_500) },
    ].sort((a, b) => (a.jobId < b.jobId ? -1 : 1)));
  });

  const tight = () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const spending = b.account({ name: "Spending", openingBalance: kr(5_000) });
    const saving = b.account({ name: "Saving", kind: "savings", openingBalance: kr(5_000) });
    b.group();
    b.buffer({ monthly: kr(0), accountId: saving });
    const holiday = b.saveUpJob({ name: "Holiday", target: monthlySaving(kr(0)), opening: kr(5_000), accountId: saving });
    const car = b.saveUpJob({ name: "Car", target: monthlySaving(kr(0)), opening: kr(5_000), accountId: spending });
    b.budgetMonth("2026-01");
    return { b, spending, saving, holiday, car };
  };
  const january = localDate("2026-01-20");

  it("between jobs in different accounts leaves the receiving account's buckets above its balance until the family moves the money at the bank", () => {
    const t = tight();
    const before = figuresOf(t.b.facts(), january);
    expect(accountIn(before, t.spending).remainder).toEqual({ kind: "unbucketed", amount: 0 });
    t.b.bucketTransfer({ month: "2026-01", from: t.holiday, to: t.car, amount: kr(2_000), reason: "" });
    const move = t.b.move({ from: t.saving, to: t.spending, amount: kr(2_000), month: "2026-01" });
    const after = figuresOf(t.b.facts(), january);
    expect(accountIn(after, t.spending).balance).toEqual(accountIn(before, t.spending).balance);
    expect(accountIn(after, t.saving).balance).toEqual(accountIn(before, t.saving).balance);
    expect(accountIn(after, t.spending).bucketed).toBe(kr(7_000));
    expect(accountIn(after, t.spending).remainder).toMatchObject({ kind: "bucketsExceedBalance", amount: kr(2_000), movesToDo: [{ id: move }] });
    expect(accountIn(after, t.saving).remainder).toEqual({ kind: "unbucketed", amount: kr(2_000) });
  });

  it("is settled when the buckets are moved back, because the money never left either account", () => {
    const t = tight();
    t.b.bucketTransfer({ month: "2026-01", from: t.holiday, to: t.car, amount: kr(2_000), reason: "" });
    t.b.bucketTransfer({ month: "2026-01", from: t.car, to: t.holiday, amount: kr(2_000), reason: "" });
    const figures = figuresOf(t.b.facts(), january);
    expect(accountIn(figures, t.spending).remainder).toEqual({ kind: "unbucketed", amount: 0 });
    expect(accountIn(figures, t.saving).remainder).toEqual({ kind: "unbucketed", amount: 0 });
  });
});

describe("the buffer after a transfer", () => {
  it("holds and lasts less when money leaves it, and more when money comes in, and its target is unchanged", () => {
    const h = transferHousehold();
    const before = figuresOf(h.facts).buffer;
    if (before.kind !== "buffer") throw new Error("no buffer");
    expect(before).toMatchObject({ balance: kr(14_000), essentialMonthly: kr(5_000), runway: { kind: "tenthsOfAMonth", tenths: 28 } });
    h.b.bucketTransfer({ month: "2026-11", from: h.jobs.buffer, to: h.jobs.electricity, amount: kr(4_100), reason: "Start evening out" });
    const out = figuresOf(h.b.facts()).buffer;
    expect(out).toMatchObject({ balance: kr(9_900), runway: { kind: "tenthsOfAMonth", tenths: 19 }, target: before.target });
    h.b.bucketTransfer({ month: "2026-11", from: h.jobs.holiday, to: h.jobs.buffer, amount: kr(1_000) });
    expect(figuresOf(h.b.facts()).buffer).toMatchObject({ balance: kr(10_900), runway: { kind: "tenthsOfAMonth", tenths: 21 } });
  });
});

describe("for any household and any transfers between jobs that keep their money and whose plan doesn't follow their bucket", () => {
  const transfers = fc.array(fc.record({ month: fc.nat(), from: fc.nat(), to: fc.nat(), amount: fc.integer({ min: 1, max: 3_000_000 }) }), { minLength: 1, maxLength: 5 });

  const withTransfers = (facts: Facts, asOf: typeof transferToday, plan: readonly { month: number; from: number; to: number; amount: number }[]) => {
    const keeping = [...facts.jobs.values()].filter((j) => keepsMoney(j) && !(j.kind === "saveUp" && j.target.kind === "amountByMonth")).map((j) => j.id).sort();
    const months = [...facts.budgetMonths.keys()].sort();
    const added = plan.flatMap((t) => {
      const from = keeping[t.from % Math.max(1, keeping.length)];
      const to = keeping[t.to % Math.max(1, keeping.length)];
      const m = months[t.month % Math.max(1, months.length)];
      return from === undefined || to === undefined || from === to || m === undefined ? [] : [{ month: m, from, to, amount: t.amount }];
    });
    return { added, asOf };
  };

  it("never changes what is available, assigned or unassigned in any month, nor any account's balance", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), transfers, ({ facts, asOf, withMore }, plan) => {
        const { added } = withTransfers(facts, asOf, plan);
        const moved = withMore((b) => {
          for (const t of added) b.bucketTransfer({ month: t.month, from: t.from, to: t.to, amount: money(t.amount) });
        });
        const before = computeFigures(facts, asOf, { estimate: averageEstimate });
        const after = computeFigures(moved, asOf, { estimate: averageEstimate });
        for (const [m, figures] of before.months) {
          const { available, assigned, unassigned, carriedIn, returned, income } = figures;
          expect(after.months.get(m)).toMatchObject({ available, assigned, unassigned, carriedIn, returned, income });
        }
        for (const [id, account] of before.accounts) expect(after.accounts.get(id)?.balance).toEqual(account.balance);
      }),
    );
  });

  it("moves each bucket by exactly what it got less what it gave up to that month, and creates no money", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), transfers, ({ facts, asOf, withMore }, plan) => {
        const { added } = withTransfers(facts, asOf, plan);
        const moved = withMore((b) => {
          for (const t of added) b.bucketTransfer({ month: t.month, from: t.from, to: t.to, amount: money(t.amount) });
        });
        const before = computeFigures(facts, asOf, { estimate: averageEstimate });
        const after = computeFigures(moved, asOf, { estimate: averageEstimate });
        const net = (job: JobId, upTo: string) => added.reduce((sum, t) => sum + (t.month <= upTo ? (t.to === job ? t.amount : 0) - (t.from === job ? t.amount : 0) : 0), 0);
        for (const [m, figures] of before.months) {
          let bucketsBefore = 0;
          let bucketsAfter = 0;
          for (const [job, jobMonth] of figures.jobs) {
            const was = jobMonth.money;
            const now = after.months.get(m)?.jobs.get(job)?.money;
            if (was.kind !== "bucket" && was.kind !== "short") continue;
            if (now?.kind !== "bucket" && now?.kind !== "short") throw new Error("a bucket stopped being one");
            expect(now.end).toBe(was.end + net(job, m));
            bucketsBefore += was.end;
            bucketsAfter += now.end;
          }
          expect(bucketsAfter).toBe(bucketsBefore);
        }
      }),
    );
  });

  it("keeps the buckets and the remainder of every account equal to its balance (rule 6), whichever account the transfers cross", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), transfers, ({ facts, asOf, withMore }, plan) => {
        const { added } = withTransfers(facts, asOf, plan);
        const moved = withMore((b) => {
          for (const t of added) b.bucketTransfer({ month: t.month, from: t.from, to: t.to, amount: money(t.amount) });
        });
        for (const account of computeFigures(moved, asOf, { estimate: averageEstimate }).accounts.values()) {
          const remainder = account.remainder.kind === "unbucketed" ? account.remainder.amount : -account.remainder.amount;
          expect(account.bucketed + remainder).toBe(account.balance.amount);
          expect(account.remainder.amount).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});
