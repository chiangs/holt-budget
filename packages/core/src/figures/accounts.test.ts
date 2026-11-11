import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { localDate, month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { AccountId } from "../ids.ts";
import { money } from "../money.ts";
import { arbitraryHousehold } from "../testing/arbitrary-facts.ts";
import { averageEstimate } from "../testing/estimates.ts";
import { evenOut, factsBuilder, kr, monthlySaving, setAmount } from "../testing/facts-builder.ts";
import { accountIn, jobIn } from "../testing/read-figures.ts";
import { type Figures, computeFigures } from "./index.ts";

const figuresOf = (b: ReturnType<typeof factsBuilder>, asOf: string) => computeFigures(b.facts(), localDate(asOf), { estimate: averageEstimate });

describe("account balances as of today", () => {
  it("adds every transaction booked after a shared account's opening date and up to today, whatever its treatment", () => {
    const b = factsBuilder();
    const everyday = b.account({ openingBalance: kr(10_000), openingDate: "2025-12-31" });
    const other = b.account();
    const food = b.spendJob({ plan: setAmount(kr(5_000)) });
    b.needsYou({ date: "2025-12-31", amount: kr(-500) });
    b.income({ date: "2026-01-05", amount: kr(2_000), fundsMonth: "2026-02" });
    b.spend({ date: "2026-01-20", amount: kr(-300), jobId: food });
    b.transfer({ from: everyday, to: other, date: "2026-01-21", amount: kr(1_000) });
    b.history({ date: "2026-01-02", amount: kr(-50) });
    b.needsYou({ date: "2026-02-01", amount: kr(-100) });

    const figures = figuresOf(b, "2026-01-31");
    expect(accountIn(figures, everyday).balance).toEqual({ kind: "calculated", amount: kr(10_000 + 2_000 - 300 - 1_000 - 50) });
    expect(accountIn(figures, other).balance).toEqual({ kind: "calculated", amount: kr(1_000) });
  });

  it("works out a paid-into account from the latest balance you entered plus the deposits since its date", () => {
    const b = factsBuilder();
    b.account();
    const child = b.account({ scope: "paidInto", openingBalance: kr(9_800), openingDate: "2025-12-31" });
    const savings = b.payIntoJob({ monthly: kr(500), payInto: child });
    b.enteredValue({ kind: "accountBalance", subject: child, value: kr(10_000), asOf: "2026-01-15" });
    b.enteredValue({ kind: "accountBalance", subject: child, value: kr(10_500), asOf: "2026-02-01" });
    for (const date of ["2026-01-10", "2026-02-01", "2026-02-10", "2026-03-10"]) b.spend({ date, amount: kr(-500), jobId: savings });

    expect(accountIn(figuresOf(b, "2026-03-01"), child).balance).toEqual({
      kind: "depositsSince",
      amount: kr(11_000),
      base: kr(10_500),
      baseDate: "2026-02-01",
      deposits: kr(500),
    });
  });

  it("starts a paid-into account from its opening balance when you haven't entered one, and counts each deposit as the pay-into job's spending", () => {
    const b = factsBuilder();
    b.account();
    const child = b.account({ scope: "paidInto", openingBalance: kr(6_100), openingDate: "2025-12-31" });
    const savings = b.payIntoJob({ monthly: kr(500), payInto: child });
    b.budgetMonth("2026-01");
    b.assign("2026-01", savings, kr(500));
    b.spend({ date: "2026-01-10", amount: kr(-500), jobId: savings });

    const figures = figuresOf(b, "2026-01-20");
    expect(accountIn(figures, child).balance).toMatchObject({ amount: kr(6_600), base: kr(6_100), baseDate: "2025-12-31" });
    expect(jobIn(figures, savings, "2026-01")).toMatchObject({ spent: kr(500), money: { kind: "bucket", end: 0 } });
  });
});

describe("deposits into a paid-into account", () => {
  it("come only from splits to its pay-into jobs, not from history", () => {
    const b = factsBuilder();
    b.account();
    const child = b.account({ scope: "paidInto", openingBalance: kr(6_100), openingDate: "2025-11-30" });
    const savings = b.payIntoJob({ monthly: kr(500), payInto: child });
    b.history({ date: "2025-12-10", amount: kr(-500), jobId: savings });
    expect(accountIn(figuresOf(b, "2026-01-20"), child).balance.amount).toBe(kr(6_100));
  });
});

describe("buckets fit inside their account (rule 6)", () => {
  const bills = () => {
    const b = factsBuilder();
    const everyday = b.account({ name: "Everyday" });
    const regninger = b.account({ name: "Regninger", kind: "bills", openingBalance: kr(3_000) });
    const buffer = b.account({ name: "Buffer", kind: "savings" });
    const electricity = b.spendJob({ accountId: regninger, plan: evenOut(kr(3_050), "2026-01"), opening: kr(4_100) });
    const avgifter = b.spendJob({ accountId: regninger, plan: setAmount(kr(1_450)), keepsMoney: true, opening: kr(2_900) });
    const mortgage = b.spendJob({ accountId: regninger, plan: setAmount(kr(14_500)) });
    b.budgetMonth("2026-01");
    for (const [job, amount] of [[electricity, 0], [avgifter, 0], [mortgage, 14_500]] as const) b.assign("2026-01", job, kr(amount));
    return { b, everyday, regninger, buffer, electricity, avgifter };
  };

  it("lists the buckets of the jobs that keep their money there, and the unbucketed remainder", () => {
    const { b, everyday, regninger, electricity, avgifter } = bills();
    b.transfer({ from: everyday, to: regninger, date: "2026-01-02", amount: kr(17_000) });
    const account = accountIn(figuresOf(b, "2026-01-10"), regninger);
    expect(account.balance.amount).toBe(kr(20_000));
    expect(account.buckets).toEqual([
      { jobId: electricity, amount: kr(4_100) },
      { jobId: avgifter, amount: kr(2_900) },
    ]);
    expect(account.bucketed).toBe(kr(7_000));
    expect(account.remainder).toEqual({ kind: "unbucketed", amount: kr(13_000) });
  });

  it("flags buckets that exceed the balance and names the moves into the account still to do", () => {
    const { b, everyday, regninger, buffer } = bills();
    const seed = b.move({ from: buffer, to: regninger, amount: kr(4_100), month: "2026-01", reason: "Seed the Electricity bucket" });
    b.move({ from: buffer, to: regninger, amount: kr(100), month: "2026-01", status: "done" });
    b.move({ from: buffer, to: regninger, amount: kr(200), month: "2026-01", status: "skipped" });
    b.move({ from: regninger, to: everyday, amount: kr(300), month: "2026-01" });

    const account = accountIn(figuresOf(b, "2026-01-10"), regninger);
    expect(account.remainder).toMatchObject({
      kind: "bucketsExceedBalance",
      amount: kr(4_000),
      movesToDo: [expect.objectContaining({ id: seed })],
      monthlyMove: { kind: "moveIn", amount: kr(14_500) },
    });
  });

  it("holds for any household: buckets plus remainder equal the balance, and a shortfall is flagged with its moves", () => {
    fc.assert(
      fc.property(arbitraryHousehold(), ({ facts, asOf }) => {
        const figures = computeFigures(facts, asOf, { estimate: averageEstimate });
        for (const account of figures.accounts.values()) {
          const keepersHere = [...figures.jobs.values()].filter((j) => j.job.accountId === account.account.id && j.bucket.kind === "kept");
          expect(account.buckets.map((b) => b.jobId)).toEqual(keepersHere.map((j) => j.job.id));
          expect(account.bucketed).toBe(account.buckets.reduce((sum, b) => sum + b.amount, 0));
          const remainder = account.remainder.kind === "unbucketed" ? account.remainder.amount : -account.remainder.amount;
          expect(account.bucketed + remainder).toBe(account.balance.amount);
          if (account.remainder.kind === "bucketsExceedBalance") {
            expect(account.remainder.amount).toBeGreaterThan(0);
            const expectedMoves = [...facts.moves.values()].filter((m) => m.to === account.account.id && m.status === "todo").map((m) => m.id);
            expect(account.remainder.movesToDo.map((m) => m.id).sort()).toEqual(expectedMoves.sort());
          } else {
            expect(account.remainder.amount).toBeGreaterThanOrEqual(0);
          }
        }
      }),
    );
  });
});

describe("the monthly move at the bank (decision 11)", () => {
  it("is each account's assignments less the income that lands there", () => {
    const b = factsBuilder();
    const everyday = b.account({ name: "Everyday" });
    const regninger = b.account({ name: "Regninger", kind: "bills" });
    const savings = b.account({ name: "Savings", kind: "savings" });
    b.spendJob({ accountId: everyday, plan: setAmount(kr(14_200)) });
    b.spendJob({ accountId: regninger, plan: evenOut(kr(3_050), "2026-01") });
    b.spendJob({ accountId: regninger, plan: setAmount(kr(14_500)) });
    b.income({ accountId: everyday, date: "2026-01-20", amount: kr(60_000), fundsMonth: "2026-02" });

    const figures = figuresOf(b, "2026-01-25");
    const february = (account: typeof everyday) => accountIn(figures, account).monthlyMoves.get(month("2026-02"));
    expect(february(regninger)).toEqual({ kind: "moveIn", amount: kr(17_550) });
    expect(february(everyday)).toEqual({ kind: "surplus", amount: kr(45_800) });
    expect(february(savings)).toEqual({ kind: "none" });
  });
});

describe("transfers are neither income nor spending (rule 7)", () => {
  const planOf = (figures: Figures) => ({
    months: figures.months,
    jobs: figures.jobs,
    buffer: figures.buffer,
    nextMonthsMoney: figures.nextMonthsMoney,
    moves: [...figures.accounts.values()].map((a) => a.monthlyMoves),
  });

  it("changes nothing in the plan, and moves the balance from one shared account to the other", () => {
    fc.assert(
      fc.property(
        arbitraryHousehold(),
        fc.nat(),
        fc.nat(),
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: -5_000_000, max: 5_000_000 }),
        (household, fromIndex, toIndex, amount, day, unmatched) => {
          const { sharedAccounts, asOf } = household;
          const from = sharedAccounts[fromIndex % sharedAccounts.length];
          const to = sharedAccounts[toIndex % sharedAccounts.length];
          if (from === undefined || to === undefined) throw new Error("no shared account");
          const date = `${asOf.slice(0, 7)}-${String(Math.min(day, Number(asOf.slice(8)))).padStart(2, "0")}`;

          const before = computeFigures(household.facts, asOf, { estimate: averageEstimate });
          const after = computeFigures(household.withMore((b) => b.transfer({ from, to, date, amount: money(amount) })), asOf, { estimate: averageEstimate });
          const oneSided = computeFigures(household.withMore((b) => b.unmatchedTransfer({ accountId: from, date, amount: money(unmatched) })), asOf, {
            estimate: averageEstimate,
          });

          expect(planOf(after)).toEqual(planOf(before));
          expect(planOf(oneSided)).toEqual(planOf(before));
          const balance = (f: Figures, account: typeof from) => accountIn(f, account).balance.amount;
          if (from !== to) {
            expect(balance(after, from)).toBe(balance(before, from) - amount);
            expect(balance(after, to)).toBe(balance(before, to) + amount);
          } else {
            expect(balance(after, from)).toBe(balance(before, from));
          }
        },
      ),
    );
  });
});

describe("the buckets in an account", () => {
  it("are listed in job ID order, however the job rows were added or restored", () => {
    const b = factsBuilder();
    const everyday = b.account();
    const ids = [1, 2, 3, 4].map((n) => b.saveUpJob({ name: `Pot ${n}`, target: monthlySaving(kr(100 * n)) }));
    const facts = b.facts();
    const restoredLast = { ...facts, jobs: new Map([...facts.jobs].reverse()) };

    for (const f of [facts, restoredLast]) {
      const listed = accountIn(computeFigures(f, localDate("2026-01-15"), { estimate: averageEstimate }), everyday).buckets.map((x) => x.jobId);
      expect(listed).toEqual([...ids].sort());
    }
  });
});

describe("the monthly move counts the contributions still expected (0048)", () => {
  /** Food (25,000 kr) is paid from Everyday and the bills (5,000 kr) from Regninger. Robin and Sam agree to pay 30,000 kr into Everyday for December. */
  const household = (samEnds = false) => {
    const b = factsBuilder({ planStart: "2026-01" });
    const everyday = b.account({ name: "Everyday" });
    const regninger = b.account({ name: "Regninger", kind: "bills" });
    b.spendJob({ name: "Food", accountId: everyday, plan: setAmount(kr(25_000)) });
    b.spendJob({ name: "Bills", accountId: regninger, plan: setAmount(kr(5_000)) });
    const robin = b.person({ name: "Robin" });
    const sam = b.person({ name: "Sam" });
    const robinPays = b.agreement({ person: robin, accountId: everyday, amount: kr(20_000), day: 15 });
    const samPays = b.agreement({ person: sam, accountId: everyday, amount: kr(10_000), day: 25, ...(samEnds ? { to: "2026-11" } : {}) });
    return { b, everyday, regninger, robinPays, samPays };
  };
  const withoutAgreements = (b: ReturnType<typeof factsBuilder>): Facts => ({ ...b.facts(), contributionAgreements: new Map() });
  const moveIn = (facts: Facts, account: AccountId, m: string, asOf = "2026-11-10") =>
    accountIn(computeFigures(facts, localDate(asOf), { estimate: averageEstimate }), account).monthlyMoves.get(month(m));

  it("is the whole month's assignments without an agreement, as it was", () => {
    const { b, everyday, regninger } = household();
    const plain = withoutAgreements(b);
    expect(moveIn(plain, everyday, "2026-12")).toEqual({ kind: "moveIn", amount: kr(25_000) });
    expect(moveIn(plain, regninger, "2026-12")).toEqual({ kind: "moveIn", amount: kr(5_000) });
  });

  it("is smaller before payday by what the agreements expect, and a surplus when they expect more than the account needs", () => {
    const { b, everyday, regninger } = household();
    expect(moveIn(b.facts(), everyday, "2026-12")).toEqual({ kind: "surplus", amount: kr(5_000) });
    expect(moveIn(b.facts(), regninger, "2026-12")).toEqual({ kind: "moveIn", amount: kr(5_000) });
  });

  it("stays the same as the money arrives, because the income that arrived replaces the income that was expected", () => {
    const { b, everyday, robinPays, samPays } = household();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: robinPays });
    expect(moveIn(b.facts(), everyday, "2026-12", "2026-11-16")).toEqual({ kind: "surplus", amount: kr(5_000) });
    b.income({ date: "2026-11-25", amount: kr(10_000), fundsMonth: "2026-12", agreement: samPays });
    expect(moveIn(b.facts(), everyday, "2026-12", "2026-11-26")).toEqual({ kind: "surplus", amount: kr(5_000) });
  });

  it("counts only what is left of a part payment, and still counts a payment that is overdue", () => {
    const { b, everyday, robinPays } = household();
    expect(moveIn(b.facts(), everyday, "2026-12", "2026-11-30")).toEqual({ kind: "surplus", amount: kr(5_000) });
    b.income({ date: "2026-11-15", amount: kr(15_000), fundsMonth: "2026-12", agreement: robinPays });
    expect(moveIn(b.facts(), everyday, "2026-12", "2026-11-30")).toEqual({ kind: "surplus", amount: kr(5_000) });
  });

  it("counts a contribution nobody has linked as income and still waits for the agreement, until it is linked", () => {
    const { b, everyday, robinPays } = household();
    const unlinked = b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12" });
    expect(moveIn(b.facts(), everyday, "2026-12", "2026-11-16")).toEqual({ kind: "surplus", amount: kr(25_000) });
    const facts = b.facts();
    const row = facts.transactions.get(unlinked);
    if (row === undefined) throw new Error("missing transaction");
    const linked: Facts = { ...facts, transactions: new Map(facts.transactions).set(unlinked, { ...row, treatment: { kind: "income", fundsMonth: month("2026-12"), source: "contribution", agreement: robinPays } }) };
    expect(moveIn(linked, everyday, "2026-12", "2026-11-16")).toEqual({ kind: "surplus", amount: kr(5_000) });
  });

  it("stops counting an agreement after its last month", () => {
    const { b, everyday } = household(true);
    expect(moveIn(b.facts(), everyday, "2026-12")).toEqual({ kind: "moveIn", amount: kr(5_000) });
    expect(moveIn(b.facts(), everyday, "2026-11")).toEqual({ kind: "surplus", amount: kr(5_000) });
  });

  it("counts the account the agreement pays into and no other", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const everyday = b.account({ name: "Everyday" });
    const regninger = b.account({ name: "Regninger", kind: "bills" });
    b.spendJob({ accountId: regninger, plan: setAmount(kr(5_000)) });
    b.agreement({ accountId: everyday, amount: kr(4_000) });
    expect(moveIn(b.facts(), regninger, "2026-12")).toEqual({ kind: "moveIn", amount: kr(5_000) });
    expect(moveIn(b.facts(), everyday, "2026-12")).toEqual({ kind: "surplus", amount: kr(4_000) });
  });

  it("starts with the current month, leaves the months that have ended as they were, and goes to the horizon", () => {
    const { b, everyday } = household();
    expect(moveIn(b.facts(), everyday, "2026-10")).toEqual({ kind: "moveIn", amount: kr(25_000) });
    expect(moveIn(b.facts(), everyday, "2026-11")).toEqual({ kind: "surplus", amount: kr(5_000) });
    expect(moveIn(b.facts(), everyday, "2027-11")).toEqual({ kind: "surplus", amount: kr(5_000) });
  });

  it("is the move the shortfall flag names for the current month", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const savings = b.account({ name: "Savings", kind: "savings" });
    b.saveUpJob({ accountId: savings, target: monthlySaving(kr(1_000)), opening: kr(3_000) });
    b.spendJob({ accountId: savings, plan: setAmount(kr(7_000)) });
    b.agreement({ accountId: savings, amount: kr(2_000) });
    expect(accountIn(figuresOf(b, "2026-11-10"), savings).remainder).toMatchObject({ kind: "bucketsExceedBalance", monthlyMove: { kind: "moveIn", amount: kr(6_000) } });
  });

  it("never changes money available, which counts only what has arrived (rule 4)", () => {
    const { b, robinPays } = household();
    const availableOf = (facts: Facts, asOf: string) =>
      [...computeFigures(facts, localDate(asOf), { estimate: averageEstimate }).months.values()].map((m) => [m.month, m.available, m.unassigned]);
    expect(availableOf(b.facts(), "2026-11-10")).toEqual(availableOf(withoutAgreements(b), "2026-11-10"));
    expect(computeFigures(b.facts(), localDate("2026-11-10"), { estimate: averageEstimate }).months.get(month("2026-12"))?.available).toBe(0);

    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: robinPays });
    expect(computeFigures(b.facts(), localDate("2026-11-16"), { estimate: averageEstimate }).months.get(month("2026-12"))?.available).toBe(kr(20_000));
  });
});
