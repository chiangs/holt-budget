/**
 * A small invented household for the Plan tests: two shared accounts, one the household pays into, four groups
 * and a job of every kind. November 2026 is the current month. The tests read the real figures from it, so a
 * status here is the status core's figures give. Every name and amount is made up.
 */

import { type AccountId, type Facts, type Figures, type GroupId, type JobId, type LocalDate, computeFigures, localDate } from "@holt/core";
import { amountByMonth, evenOut, factsBuilder, kr, monthlySaving, setAmount } from "@holt/core/testing";

export const today: LocalDate = localDate("2026-11-10");

export interface PlanWorld {
  readonly facts: Facts;
  readonly figures: Figures;
  readonly accounts: { readonly everyday: AccountId; readonly savings: AccountId; readonly kids: AccountId };
  readonly groups: { readonly fixed: GroupId; readonly living: GroupId; readonly saving: GroupId; readonly children: GroupId };
  readonly jobs: {
    readonly mortgage: JobId;
    readonly electricity: JobId;
    readonly union: JobId;
    readonly food: JobId;
    readonly cars: JobId;
    readonly confirmation: JobId;
    readonly holidays: JobId;
    readonly christmas: JobId;
    readonly books: JobId;
    readonly buffer: JobId;
    readonly build: JobId;
    readonly eldest: JobId;
  };
}

/** What November's assignments add up to, in whole kroner. More income than this leaves money unassigned and less is over-assigned. */
export const assignedInNovember = 48_150;

export interface WorldOptions {
  /** Whole kroner that fund November. */
  readonly income?: number;
  /** The first month of the plan. November, the current month, by default, so nothing carries in. */
  readonly planStart?: string;
  /** November's state. A month that is "planned" has no budget row. */
  readonly november?: "open" | "closed" | "reopened" | "planned";
  /** Whether the months from the plan start to October have been opened and closed. */
  readonly openEarlier?: boolean;
  /** The date of the payment to Eldest's savings, or none for a month where it hasn't been paid. */
  readonly paidEldest?: string | null;
  /** The buffer's opening balance, in whole kroner. */
  readonly bufferOpening?: number;
}

export function buildWorld(options: WorldOptions = {}): PlanWorld {
  const { income = 60_000, planStart = "2026-11", november = "open", openEarlier = true, paidEldest = "2026-11-04", bufferOpening = 40_000 } = options;
  const b = factsBuilder({ planStart });
  const everyday = b.account({ name: "Everyday", openingBalance: kr(18_000), openingDate: "2026-07-31" });
  const savings = b.account({ name: "Deposit", kind: "savings", openingBalance: kr(66_500), openingDate: "2026-07-31" });
  const kids = b.account({ name: "Eldest's savings", kind: "savings", scope: "paidInto", openingBalance: kr(24_000), openingDate: "2026-07-31" });
  const fixed = b.group({ name: "Fixed costs" });
  const living = b.group({ name: "Living" });
  const saving = b.group({ name: "Saving", countsTowardsSavingsRate: true });
  const children = b.group({ name: "Children's savings", countsTowardsSavingsRate: true });

  const mortgage = b.spendJob({ name: "Mortgage", groupId: fixed, accountId: everyday, plan: setAmount(kr(14_500)), essential: true });
  const electricity = b.spendJob({ name: "Electricity", groupId: fixed, accountId: everyday, plan: evenOut(kr(3_050), "2026-08"), essential: true, opening: kr(2_000) });
  const union = b.spendJob({ name: "Union fees", groupId: fixed, accountId: everyday, plan: setAmount(kr(450)), status: "paused" });
  const food = b.spendJob({ name: "Food and household", groupId: living, accountId: everyday, plan: setAmount(kr(14_200)), essential: true });
  const cars = b.spendJob({ name: "Car running costs", groupId: living, accountId: everyday, plan: setAmount(kr(3_200)), keepsMoney: true });
  const confirmation = b.saveUpJob({ name: "Confirmation", groupId: living, accountId: savings, target: amountByMonth(kr(38_000), "2027-05"), opening: kr(8_100) });
  const holidays = b.saveUpJob({ name: "Holidays", groupId: living, accountId: savings, target: amountByMonth(kr(21_000), "2027-06") });
  const christmas = b.saveUpJob({ name: "Christmas", groupId: living, accountId: savings, target: monthlySaving(kr(1_200)), opening: kr(10_400) });
  const books = b.spendJob({ name: "Books and games", groupId: living, accountId: everyday, plan: setAmount(kr(400)), status: "archived" });
  const buffer = b.buffer({ groupId: saving, accountId: savings, monthly: kr(2_000), opening: kr(bufferOpening) });
  const build = b.saveUpJob({ name: "Build savings", groupId: saving, accountId: savings, target: monthlySaving(kr(5_000)), opening: kr(8_000) });
  const eldest = b.payIntoJob({ name: "Eldest", groupId: children, accountId: everyday, monthly: kr(500), payInto: kids });

  const assignments: readonly (readonly [JobId, number])[] = [
    [mortgage, 14_500],
    [electricity, 3_050],
    [union, 0],
    [food, 14_200],
    [cars, 3_200],
    [confirmation, 1_500],
    [holidays, 3_000],
    [christmas, 1_200],
    [books, 0],
    [buffer, 2_000],
    [build, 5_000],
    [eldest, 500],
  ];

  for (const m of ["2026-08", "2026-09", "2026-10"].filter((m) => m >= planStart && openEarlier)) {
    b.budgetMonth(m, "closed");
    for (const [job, amount] of assignments) b.assign(m, job, kr(amount));
  }
  if (november !== "planned") {
    b.budgetMonth("2026-11", november);
    for (const [job, amount] of assignments) b.assign("2026-11", job, kr(amount));
  }

  b.income({ date: "2026-10-20", amount: kr(income), accountId: everyday, fundsMonth: "2026-11", source: "other" });
  b.spend({ date: "2026-11-03", amount: kr(-2_140), accountId: everyday, jobId: food, description: "Groceries" });
  b.spend({ date: "2026-11-05", amount: kr(-640), accountId: everyday, jobId: cars, description: "Fuel" });
  if (paidEldest !== null) b.spend({ date: paidEldest, amount: kr(-500), accountId: everyday, jobId: eldest, description: "To Eldest" });

  const facts = b.facts();
  return {
    facts,
    figures: computeFigures(facts, today),
    accounts: { everyday, savings, kids },
    groups: { fixed, living, saving, children },
    jobs: { mortgage, electricity, union, food, cars, confirmation, holidays, christmas, books, buffer, build, eldest },
  };
}
