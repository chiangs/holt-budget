/**
 * The Electricity job from the Plan mockup (design/mockups/PlanElectricity-hearth-light.png), with the
 * mockup's numbers, for the forecast, history, estimate and offer tests. Invented sample data.
 *
 * The plan starts in January 2026 and today is 10 November 2026. January to October are closed and November
 * is open. The Lyse bills of January to October sum to 28,800 kr, and the estimates for November to October
 * sum to 36,300 kr (design/README.md). Electricity pays from the bills account. The buffer sits in a savings
 * account and holds 86,000 kr, so moving 4,100 kr leaves 81,900 kr.
 *
 * Essential jobs other than Electricity assign 49,800 kr a month, so with Electricity at 3,050 kr the
 * buffer's runway is 81,900 kr over 52,850 kr, 1.5 months.
 */

import { type LocalDate, localDate } from "../dates.ts";
import type { BudgetMonthState, SpendPlan } from "../facts.ts";
import type { Money } from "../money.ts";
import { factsBuilder, kr, setAmount } from "./facts-builder.ts";

export const electricityToday: LocalDate = localDate("2026-11-10");

/** What Lyse billed in January to October 2026, in kroner. */
export const electricityBillsKroner = [4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846] as const;

/** The estimates for November 2026 to October 2027, in kroner, as the mockup shows them. */
export const electricityEstimatesKroner = [3300, 4200, 4420, 3980, 3300, 2700, 2194, 1870, 1820, 2760, 2910, 2846] as const;

export interface ElectricityOptions {
  /**
   * What January to October assigned. "mockup" is 2,900 kr every month, as the mockup says, which is 200 kr more than the
   * bills. "matchingBills" assigns each month's bill, so nothing is left over and a bucket that starts now starts empty.
   */
  readonly assignedBefore?: "mockup" | "matchingBills";
  readonly plan?: SpendPlan;
  /** What November assigns. 2,900 kr by default. */
  readonly novemberAssigned?: Money;
  readonly bufferBalance?: Money;
  /** November's state. "planned" leaves it with no budget month. Open by default. */
  readonly november?: BudgetMonthState | "planned";
  /** What the job's bucket held at the plan start. 0 by default. It counts only once the job keeps its money. */
  readonly opening?: Money;
  /** Whether the job keeps what it doesn't spend, whatever its plan. */
  readonly keepsMoney?: boolean;
  /** The account the bills are paid from. The bills account by default; "savings" puts the job in the buffer's account. */
  readonly paidFrom?: "bills" | "savings";
}

const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] as const;

export function electricityHousehold(options: ElectricityOptions = {}) {
  const b = factsBuilder({ planStart: "2026-01" });
  const bills = b.account({ name: "Regninger", openingBalance: kr(60_000) });
  const everyday = b.account({ name: "Brukskonto", openingBalance: kr(20_000) });
  const savings = b.account({ name: "Sparing", kind: "savings", openingBalance: kr(120_000) });
  const fixed = b.group({ name: "Fixed costs" });

  const electricity = b.spendJob({
    name: "Electricity",
    groupId: fixed,
    accountId: options.paidFrom === "savings" ? savings : bills,
    plan: options.plan ?? setAmount(kr(2_900)),
    seasonality: "seasonal",
    essential: true,
    ...(options.opening === undefined ? {} : { opening: options.opening }),
    ...(options.keepsMoney === undefined ? {} : { keepsMoney: options.keepsMoney }),
  });
  const essentials = [
    b.spendJob({ name: "Mortgage", groupId: fixed, accountId: bills, plan: setAmount(kr(19_850)), essential: true }),
    b.spendJob({ name: "Insurance", groupId: fixed, accountId: bills, plan: setAmount(kr(4_630)), essential: true }),
    b.spendJob({ name: "Kommunale avgifter", groupId: fixed, accountId: bills, plan: setAmount(kr(1_450)), essential: true }),
    b.spendJob({ name: "Phones and internet", groupId: fixed, accountId: bills, plan: setAmount(kr(1_390)), essential: true }),
    b.spendJob({ name: "Food and household", groupId: fixed, accountId: everyday, plan: setAmount(kr(22_480)), essential: true }),
  ] as const;
  const buffer = b.buffer({ monthly: kr(0), opening: options.bufferBalance ?? kr(86_000), accountId: savings, groupId: fixed });

  for (const m of months) b.budgetMonth(m, "closed");
  if (options.november !== "planned") b.budgetMonth("2026-11", options.november ?? "open");
  months.forEach((m, i) => {
    const bill = electricityBillsKroner[i] ?? 0;
    b.assign(m, electricity, options.assignedBefore === "matchingBills" ? kr(bill) : kr(2_900));
    b.spend({ date: `${m}-19`, amount: kr(-bill), jobId: electricity, accountId: bills, description: "Lyse" });
  });
  const amounts = [19_850, 4_630, 1_450, 1_390, 22_480] as const;
  const assigned = options.november === "planned" ? months : ([...months, "2026-11"] as const);
  if (options.november !== "planned") b.assign("2026-11", electricity, options.novemberAssigned ?? kr(2_900));
  for (const m of assigned) essentials.forEach((job, i) => b.assign(m, job, kr(amounts[i] ?? 0)));

  return { b, facts: b.facts(), accounts: { bills, everyday, savings }, jobs: { electricity, buffer, essentials } };
}
