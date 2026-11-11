/**
 * A household for the tests of bucket transfers, with figures that can be checked by hand. The plan starts
 * in October 2026, October is closed, November is open and today is 9 November 2026.
 *
 * Buckets at the end of November: Buffer 14,000 kr (10,000 opening + 2,000 assigned in each month), Holiday
 * 2,000 kr (1,000 opening + 500 in each month) and Electricity 800 kr (3,000 assigned in each month, 1,200
 * spent in October and 4,000 in November). Buffer and Holiday sit in Savings, Electricity in Everyday.
 * Food keeps no money.
 */

import { localDate } from "../dates.ts";
import { factsBuilder, evenOut, kr, monthlySaving, setAmount } from "./facts-builder.ts";

export const transferToday = localDate("2026-11-09");

export function transferHousehold() {
  const b = factsBuilder({ planStart: "2026-10" });
  const everyday = b.account({ name: "Everyday", openingBalance: kr(20_000) });
  const savings = b.account({ name: "Savings", kind: "savings", openingBalance: kr(50_000) });
  b.group({ name: "Living" });
  const buffer = b.buffer({ monthly: kr(2_000), opening: kr(10_000), accountId: savings });
  const holiday = b.saveUpJob({ name: "Holiday", target: monthlySaving(kr(500)), opening: kr(1_000), accountId: savings });
  const electricity = b.spendJob({ name: "Electricity", plan: evenOut(kr(3_000), "2026-10"), accountId: everyday });
  const food = b.spendJob({ name: "Food", plan: setAmount(kr(5_000)), essential: true, accountId: everyday });
  b.budgetMonth("2026-10", "closed");
  b.budgetMonth("2026-11", "open");
  for (const m of ["2026-10", "2026-11"]) {
    b.assign(m, buffer, kr(2_000));
    b.assign(m, holiday, kr(500));
    b.assign(m, electricity, kr(3_000));
    b.assign(m, food, kr(5_000));
  }
  b.income({ date: "2026-09-25", amount: kr(20_000), fundsMonth: "2026-10", accountId: everyday });
  b.income({ date: "2026-10-25", amount: kr(20_000), fundsMonth: "2026-11", accountId: everyday });
  b.spend({ date: "2026-10-10", amount: kr(-1_200), jobId: electricity, accountId: everyday });
  b.spend({ date: "2026-11-05", amount: kr(-4_000), jobId: electricity, accountId: everyday });
  return { b, facts: b.facts(), accounts: { everyday, savings }, jobs: { buffer, holiday, electricity, food } };
}
