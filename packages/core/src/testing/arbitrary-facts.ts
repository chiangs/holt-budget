/**
 * Random households for property tests: a few shared accounts and one paid-into account, jobs of every
 * kind and status, the first six months of 2026 in random states with random assignments, transactions
 * with every treatment from December 2025 on, moves, and a buffer-months setting. `withMore` builds the
 * same household again with extra rows, so a property can compare the figures before and after.
 */

import fc from "fast-check";
import { type LocalDate, type Month, addMonths, localDate, month } from "../dates.ts";
import type { BudgetMonthState, Facts } from "../facts.ts";
import type { AccountId, JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { type FactsBuilder, amountByMonth, evenOut, factsBuilder, followBills, kr, monthlySaving, setAmount } from "./facts-builder.ts";

export interface ArbitraryHousehold {
  readonly facts: Facts;
  readonly asOf: LocalDate;
  readonly sharedAccounts: readonly AccountId[];
  readonly jobs: readonly JobId[];
  /** The same facts with the rows that `add` makes on top. */
  withMore(add: (builder: FactsBuilder) => void): Facts;
}

const planStart = month("2026-01");
const monthAt = (index: number): Month => addMonths(planStart, index);

const signedAmount = (maxKroner: number): fc.Arbitrary<Money> => fc.integer({ min: -maxKroner * 100, max: maxKroner * 100 }).map(money);
const amountUpTo = (maxKroner: number): fc.Arbitrary<Money> => fc.integer({ min: 0, max: maxKroner * 100 }).map(money);
/** A day from December 2025 (index -1) to the month at `lastIndex`. */
const dayIn = (firstIndex: number, lastIndex: number): fc.Arbitrary<LocalDate> =>
  fc
    .record({ index: fc.integer({ min: firstIndex, max: lastIndex }), day: fc.integer({ min: 1, max: 28 }) })
    .map(({ index, day }) => localDate(`${monthAt(index)}-${String(day).padStart(2, "0")}`));

const jobRecipe = fc.record({
  kind: fc.constantFrom("setAmount", "followBills", "evenOut", "carryOver", "amountByMonth", "monthly", "payInto"),
  amount: amountUpTo(20_000),
  monthIndex: fc.integer({ min: -1, max: 7 }),
  account: fc.nat(),
  status: fc.constantFrom("active", "active", "active", "paused", "finished", "archived"),
  essential: fc.boolean(),
  opening: amountUpTo(10_000),
});

const treatmentRecipe = fc.oneof(
  fc.record({ kind: fc.constant("income"), fundsIndex: fc.integer({ min: -1, max: 6 }) }),
  fc.record({ kind: fc.constant("split"), allocations: fc.array(fc.record({ job: fc.nat(), amount: signedAmount(10_000) }), { minLength: 1, maxLength: 3 }) }),
  fc.record({ kind: fc.constant("transfer"), to: fc.nat(), matched: fc.boolean() }),
  fc.record({ kind: fc.constant("history"), job: fc.option(fc.nat(), { nil: null }) }),
  fc.record({ kind: fc.constant("needsYou") }),
);

const recipe = fc.record({
  openingBalances: fc.array(signedAmount(50_000), { minLength: 1, maxLength: 3 }),
  buffer: fc.option(fc.record({ monthly: amountUpTo(5_000), opening: amountUpTo(60_000), account: fc.nat() }), { nil: null }),
  jobs: fc.array(jobRecipe, { maxLength: 6 }),
  monthStates: fc.array(fc.constantFrom<BudgetMonthState | "planned">("planned", "open", "closed", "reopened"), { minLength: 6, maxLength: 6 }),
  assignments: fc.array(fc.record({ monthIndex: fc.integer({ min: 0, max: 5 }), job: fc.nat(), amount: amountUpTo(20_000) }), { maxLength: 20 }),
  transactions: fc.array(fc.record({ account: fc.nat(), date: dayIn(-1, 5), amount: signedAmount(30_000), treatment: treatmentRecipe }), { maxLength: 40 }),
  moves: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), amount: amountUpTo(5_000), monthIndex: fc.integer({ min: 0, max: 5 }), status: fc.constantFrom("todo", "done", "skipped") }), { maxLength: 3 }),
  bufferMonths: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null }),
  asOf: dayIn(0, 5),
});

function at<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length];
}

type Recipe = typeof recipe extends fc.Arbitrary<infer R> ? R : never;

function build(r: Recipe): { readonly builder: FactsBuilder; readonly shared: readonly AccountId[]; readonly jobs: readonly JobId[] } {
  const b = factsBuilder({ planStart });
  const shared = r.openingBalances.map((openingBalance, i) => b.account({ name: `Shared ${i + 1}`, openingBalance }));
  const paidInto = b.account({ name: "Child", scope: "paidInto", kind: "savings", openingBalance: kr(1_000) });
  const accountAt = (n: number): AccountId => at(shared, n) ?? b.defaultAccount();

  const jobs: JobId[] = [];
  if (r.buffer !== null) jobs.push(b.buffer({ monthly: r.buffer.monthly, opening: r.buffer.opening, accountId: accountAt(r.buffer.account), essential: false }));
  for (const j of r.jobs) {
    const common = { accountId: accountAt(j.account), status: j.status, essential: j.essential, opening: j.opening };
    const someMonth = monthAt(j.monthIndex);
    switch (j.kind) {
      case "setAmount":
        jobs.push(b.spendJob({ ...common, plan: setAmount(j.amount) }));
        break;
      case "followBills":
        jobs.push(b.spendJob({ ...common, plan: followBills() }));
        break;
      case "evenOut":
        jobs.push(b.spendJob({ ...common, plan: evenOut(j.amount, someMonth) }));
        break;
      case "carryOver":
        jobs.push(b.spendJob({ ...common, plan: setAmount(j.amount), keepsMoney: true }));
        break;
      case "amountByMonth":
        jobs.push(b.saveUpJob({ ...common, target: amountByMonth(j.amount, someMonth) }));
        break;
      case "monthly":
        jobs.push(b.saveUpJob({ ...common, target: monthlySaving(j.amount) }));
        break;
      case "payInto":
        jobs.push(b.payIntoJob({ ...common, monthly: j.amount, payInto: paidInto }));
        break;
    }
  }

  r.monthStates.forEach((state, i) => {
    if (state !== "planned") b.budgetMonth(monthAt(i), state);
  });
  for (const a of r.assignments) {
    const job = at(jobs, a.job);
    if (job !== undefined) b.assign(monthAt(a.monthIndex), job, a.amount);
  }
  for (const t of r.transactions) {
    const accountId = accountAt(t.account);
    const date = t.date;
    const treatment = t.treatment;
    switch (treatment.kind) {
      case "income":
        b.income({ accountId, date, amount: t.amount, fundsMonth: monthAt(treatment.fundsIndex) });
        break;
      case "split": {
        const allocations = treatment.allocations.flatMap((a) => {
          const job = at(jobs, a.job);
          return job === undefined ? [] : [[job, a.amount] as const];
        });
        if (allocations.length > 0) b.split({ accountId, date, allocations });
        else b.needsYou({ accountId, date, amount: t.amount });
        break;
      }
      case "transfer":
        if (treatment.matched) b.transfer({ from: accountId, to: accountAt(treatment.to), date, amount: money(Math.abs(t.amount)) });
        else b.unmatchedTransfer({ accountId, date, amount: t.amount });
        break;
      case "history": {
        const job = treatment.job === null ? undefined : at(jobs, treatment.job);
        b.history({ accountId, date, amount: t.amount, ...(job === undefined ? {} : { jobId: job }) });
        break;
      }
      case "needsYou":
        b.needsYou({ accountId, date, amount: t.amount });
        break;
    }
  }
  const everyAccount = [...shared, paidInto];
  for (const m of r.moves) {
    b.move({ from: at(everyAccount, m.from) ?? paidInto, to: at(everyAccount, m.to) ?? paidInto, amount: m.amount, month: monthAt(m.monthIndex), status: m.status });
  }
  if (r.bufferMonths !== null) b.enteredValue({ kind: "reference", subject: "buffer-months", value: r.bufferMonths, unit: "months", asOf: "2026-01-01" });

  return { builder: b, shared, jobs };
}

export function arbitraryHousehold(): fc.Arbitrary<ArbitraryHousehold> {
  return recipe.map((r) => {
    const { builder, shared, jobs } = build(r);
    return {
      facts: builder.facts(),
      asOf: r.asOf,
      sharedAccounts: shared,
      jobs,
      withMore: (add) => {
        const again = build(r).builder;
        add(again);
        return again.facts();
      },
    };
  });
}
