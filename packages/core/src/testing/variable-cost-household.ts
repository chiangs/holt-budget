/**
 * Random households around one variable cost, for the properties of the forecast, the history, the estimate and
 * the offers to even it out. The plan starts in January 2026 and today lies between January 2026 and May 2027.
 * Months before today are closed, this month is open, closed, reopened or not started, and sometimes next month
 * is open too. The job follows the bills, has a set amount or is evened out, with spending in some months, a few
 * months overridden, a bucket opening amount and moves between its bucket and the buffer's. Some households have no
 * buffer, as before Setup finishes: `checkFacts` flags only that, which a test pins.
 */

import fc from "fast-check";
import { type LocalDate, type Month, addMonths, localDate, month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { evenOut, factsBuilder, followBills, kr, setAmount } from "./facts-builder.ts";

export interface VariableCostCase {
  readonly facts: Facts;
  readonly asOf: LocalDate;
  readonly current: Month;
  readonly job: JobId;
}

const planStart = month("2026-01");
const monthAt = (index: number): Month => addMonths(planStart, index);

const recipe = fc.record({
  currentIndex: fc.oneof(fc.integer({ min: 0, max: 16 }), fc.integer({ min: 8, max: 16 })),
  day: fc.integer({ min: 1, max: 28 }),
  thisMonth: fc.constantFrom("open", "open", "open", "closed", "reopened", "planned", "planned", "neverOpened"),
  nextOpen: fc.boolean(),
  mode: fc.constantFrom("setAmount", "followBills", "evenOut", "evenOut"),
  amount: fc.integer({ min: 0, max: 6_000 }),
  startOffset: fc.integer({ min: -3, max: 6 }),
  keepsMoney: fc.boolean(),
  seasonality: fc.constantFrom("auto", "seasonal", "seasonal", "irregular"),
  essential: fc.boolean(),
  status: fc.constantFrom("active", "active", "active", "active", "paused"),
  sameAccount: fc.boolean(),
  jobOpening: fc.integer({ min: 0, max: 3_000 }),
  bufferAssigned: fc.constantFrom(0, 0, 500, 2_000),
  buffer: fc.oneof(fc.constant(null), fc.constant(null), fc.integer({ min: 0, max: 4_000 }), fc.integer({ min: 0, max: 8_000 }), fc.integer({ min: 0, max: 120_000 })),
  bills: fc.array(fc.option(fc.integer({ min: 100, max: 9_000 }), { nil: null, freq: 4 }), { minLength: 23, maxLength: 23 }),
  extras: fc.array(fc.record({ offset: fc.integer({ min: -6, max: 16 }), amount: fc.integer({ min: -400, max: 9_000 }), day: fc.integer({ min: 1, max: 28 }) }), { maxLength: 6 }),
  assignments: fc.array(fc.integer({ min: 0, max: 6_000 }), { minLength: 18, maxLength: 18 }),
  overrides: fc.array(fc.record({ ahead: fc.integer({ min: 0, max: 11 }), amount: fc.integer({ min: 0, max: 9_000 }) }), { maxLength: 4 }),
  transfers: fc.array(fc.record({ offset: fc.integer({ min: 0, max: 16 }), amount: fc.integer({ min: 1, max: 3_000 }), intoJob: fc.boolean() }), { maxLength: 3 }),
});

export function arbitraryVariableCost(): fc.Arbitrary<VariableCostCase> {
  return recipe.map((r) => {
    const b = factsBuilder({ planStart });
    const bills = b.account({ name: "Bills", openingBalance: kr(50_000) });
    const savings = b.account({ name: "Savings", kind: "savings", openingBalance: kr(150_000) });
    b.group({ name: "Fixed costs" });
    const current = monthAt(r.currentIndex);
    const asOf = localDate(`${current}-${String(r.day).padStart(2, "0")}`);

    const plan = r.mode === "setAmount" ? setAmount(kr(r.amount)) : r.mode === "followBills" ? followBills() : evenOut(kr(r.amount), monthAt(r.currentIndex + r.startOffset));
    const job = b.spendJob({
      name: "Electricity",
      accountId: r.sameAccount ? savings : bills,
      plan,
      keepsMoney: r.mode === "evenOut" || r.keepsMoney,
      seasonality: r.seasonality,
      essential: r.essential,
      status: r.status,
      opening: kr(r.jobOpening),
    });
    const food = b.spendJob({ name: "Food", plan: setAmount(kr(5_000)), essential: true, accountId: bills });
    const buffer = r.buffer === null ? null : b.buffer({ monthly: kr(2_000), opening: kr(r.buffer), accountId: savings });

    const opened = r.thisMonth !== "neverOpened";
    const openedThrough = opened ? (r.thisMonth === "planned" ? r.currentIndex - 1 : r.currentIndex + (r.nextOpen ? 1 : 0)) : -1;
    for (let i = 0; i <= openedThrough; i++) {
      const state = i < r.currentIndex ? "closed" : i === r.currentIndex ? (r.thisMonth as "open" | "closed" | "reopened") : "open";
      b.budgetMonth(monthAt(i), state);
      const amount = r.assignments[i] ?? 0;
      if (amount > 0) b.assign(monthAt(i), job, kr(amount));
      b.assign(monthAt(i), food, kr(5_000));
      if (buffer !== null && r.bufferAssigned > 0) b.assign(monthAt(i), buffer, kr(r.bufferAssigned));
    }

    const spending = [...r.bills.flatMap((amount, i) => (amount === null ? [] : [{ offset: i - 6, amount, day: 10 }])), ...r.extras];
    for (const s of spending) {
      if (s.amount === 0 || s.offset > r.currentIndex) continue;
      const m = monthAt(s.offset);
      const date = `${m}-${String(m === current ? Math.min(s.day, r.day) : s.day).padStart(2, "0")}`;
      if (m < planStart) b.history({ date, amount: kr(-s.amount), jobId: job, accountId: bills });
      else b.spend({ date, amount: kr(-s.amount), jobId: job, accountId: bills });
    }

    for (const o of r.overrides) b.enteredValue({ kind: "estimateOverride", subject: `${job}/${addMonths(current, o.ahead)}`, value: kr(o.amount), asOf: `${current}-01` });

    const keeps = r.mode === "evenOut" || r.keepsMoney;
    for (const t of r.transfers) {
      const index = Math.min(t.offset, openedThrough);
      if (!keeps || index < 0 || buffer === null) continue;
      b.bucketTransfer({ month: monthAt(index), from: t.intoJob ? buffer : job, to: t.intoJob ? job : buffer, amount: kr(t.amount), reason: "Test move" });
    }
    return { facts: b.facts(), asOf, current, job };
  });
}

/** Every table's rows as plain lists, so a test can show that a function read the facts and changed none. */
export function snapshotOf(facts: Facts): Record<string, readonly (readonly [unknown, unknown])[]> {
  return Object.fromEntries(Object.entries(facts).map(([table, rows]) => [table, [...(rows as ReadonlyMap<unknown, unknown>)]]));
}
