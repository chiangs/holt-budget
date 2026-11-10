/**
 * The invented household behind the development seed: six accounts that carry the synthetic banks' account
 * numbers, forty jobs, the plan from three months ago and a few rules. It holds no transactions. The seed gets
 * those by importing the synthetic bank files, so they are what the real import makes of them.
 */

import { type AccountId, type Facts, type GroupId, type JobId, type LocalDate, type Rule, type SpendPlan, addDays, addMonths, localDate, monthOf, monthRange, ruleId } from "@holt/core";
import { amountByMonth, evenOut, factsBuilder, followBills, kr, monthlySaving, setAmount, testId } from "@holt/core/testing";
import { type SyntheticFile, syntheticAccounts, syntheticStatements } from "@holt/importers/synthetic";

type Mode = "set" | "evenOut" | "followBills";

interface SpendSpec {
  readonly name: string;
  /** What the plan sets aside each month, in whole kroner. */
  readonly monthly: number;
  readonly mode?: Mode;
  readonly essential?: boolean;
  readonly status?: "paused" | "archived";
}

const fixedCosts: readonly SpendSpec[] = [
  { name: "Mortgage", monthly: 14_500, essential: true },
  { name: "Electricity", monthly: 3_050, mode: "evenOut", essential: true },
  { name: "Municipal fees", monthly: 1_450, mode: "evenOut", essential: true },
  { name: "Phones and internet", monthly: 1_390, essential: true },
  { name: "House insurance", monthly: 950, essential: true },
  { name: "Car insurance", monthly: 780, essential: true },
  { name: "Water", monthly: 600, mode: "followBills", essential: true },
  { name: "Kindergarten", monthly: 3_400, essential: true },
  { name: "Subscriptions", monthly: 400 },
  { name: "Car loan", monthly: 2_900, essential: true },
  { name: "Activities and SFO", monthly: 600, mode: "followBills" },
  { name: "Union fees", monthly: 450, status: "paused" },
];

const living: readonly SpendSpec[] = [
  { name: "Food and household", monthly: 14_200, essential: true },
  { name: "Eating out", monthly: 2_000 },
  { name: "Clothes and kids", monthly: 2_800 },
  { name: "Car running costs", monthly: 3_200, mode: "evenOut", essential: true },
  { name: "Fuel", monthly: 2_400, essential: true },
  { name: "Pharmacy", monthly: 500 },
  { name: "Hobbies", monthly: 1_000 },
  { name: "Home maintenance", monthly: 1_500, mode: "evenOut" },
  { name: "Garden", monthly: 600 },
  { name: "Pets", monthly: 800 },
  { name: "Personal care", monthly: 700 },
  { name: "Public transport", monthly: 900 },
  { name: "Pocket money", monthly: 800 },
  { name: "Gifts", monthly: 400, mode: "followBills" },
  { name: "Books and games", monthly: 400, status: "archived" },
  { name: "Coffee", monthly: 400 },
  { name: "Sports", monthly: 1_200 },
];

/** Counterparties the synthetic banks name, and the job the family has told the app they always go to. */
const rules: readonly (readonly [counterparty: string, job: string])[] = [
  ["Kaffebaren Torget", "Coffee"],
  ["Nærbutikken Fjord", "Food and household"],
  ["Fjordmat", "Food and household"],
  ["Byggvare Nord", "Home maintenance"],
  ["Apoteket Sentrum", "Pharmacy"],
  ["Fjordstrøm Energi", "Electricity"],
  ["Nettbredd Bredbånd", "Phones and internet"],
];

export function seedHousehold(today: LocalDate): Facts {
  const planStart = addMonths(monthOf(today), -3);
  const b = factsBuilder({ planStart });
  const opening = { openingDate: addDays(localDate(`${planStart}-01`), -1) };
  const { bulder, sparebank1 } = syntheticAccounts;

  const everyday = b.account({ name: "Everyday", kind: "everyday", openingBalance: kr(18_000), ...opening });
  const bills = b.account({ name: "Bills", kind: "bills", openingBalance: kr(9_000), ...opening });
  const food = b.account({ name: "Food", kind: "everyday", openingBalance: kr(4_000), ...opening });
  const holiday = b.account({ name: "Holiday", kind: "savings", openingBalance: kr(6_000), ...opening });
  const loanPayments = b.account({ name: "Loan payments", kind: "bills", openingBalance: kr(9_412), ...opening });
  const deposit = b.account({ name: "Deposit", kind: "savings", openingBalance: kr(42_000), ...opening });
  const bankDetails = new Map([
    [everyday, { number: bulder.everyday.number, importRhythm: "weekly" }],
    [bills, { number: bulder.bills.number, importRhythm: "weekly" }],
    [food, { number: bulder.food.number, importRhythm: "weekly" }],
    [holiday, { number: bulder.holiday.number, importRhythm: "monthly" }],
    [loanPayments, { number: sparebank1.loanPayments.number, importRhythm: "monthly" }],
    [deposit, { number: sparebank1.deposit.number, importRhythm: "monthly" }],
  ] as const);

  const fixedGroup = b.group({ name: "Fixed costs" });
  const livingGroup = b.group({ name: "Living" });
  const savingGroup = b.group({ name: "Saving", countsTowardsSavingsRate: true });

  const planned: { readonly id: JobId; readonly monthly: number }[] = [];
  const jobs = new Map<string, JobId>();
  const addSpend = (spec: SpendSpec, groupId: GroupId, accountId: AccountId): void => {
    const plan: SpendPlan =
      spec.mode === "followBills" ? followBills() : spec.mode === "evenOut" ? evenOut(kr(spec.monthly), planStart) : setAmount(kr(spec.monthly));
    const id = b.spendJob({
      name: spec.name,
      groupId,
      accountId,
      plan,
      essential: spec.essential ?? false,
      ...(spec.status === undefined ? {} : { status: spec.status }),
      ...(spec.mode === "evenOut" ? { opening: kr(2_000) } : {}),
      ...(spec.name === "Electricity" ? { seasonality: "seasonal" as const } : {}),
    });
    jobs.set(spec.name, id);
    planned.push({ id, monthly: spec.status === undefined ? spec.monthly : 0 });
  };
  for (const spec of fixedCosts) addSpend(spec, fixedGroup, bills);
  for (const spec of living) addSpend(spec, livingGroup, spec.name === "Food and household" ? food : everyday);

  const buffer = b.buffer({ groupId: savingGroup, accountId: deposit, monthly: kr(2_000), opening: kr(40_000) });
  planned.push({ id: buffer, monthly: 2_000 });
  const saveUp = (name: string, target: ReturnType<typeof monthlySaving>, monthly: number, status?: "paused"): void => {
    const id = b.saveUpJob({ name, groupId: savingGroup, accountId: holiday, target, ...(status === undefined ? {} : { status }) });
    jobs.set(name, id);
    planned.push({ id, monthly: status === undefined ? monthly : 0 });
  };
  saveUp("Holidays", amountByMonth(kr(21_000), addMonths(planStart, 8)), 3_000);
  saveUp("Confirmation", amountByMonth(kr(38_000), addMonths(planStart, 14)), 2_000);
  saveUp("New car", amountByMonth(kr(120_000), addMonths(planStart, 36)), 3_500);
  saveUp("Build savings", monthlySaving(kr(5_000)), 5_000);
  saveUp("Christmas", monthlySaving(kr(1_200)), 1_200);
  saveUp("Bike", monthlySaving(kr(500)), 500, "paused");
  saveUp("Dentist", monthlySaving(kr(400)), 400);
  saveUp("Winter tyres", amountByMonth(kr(8_000), addMonths(planStart, 2)), 800);
  saveUp("Home improvements", monthlySaving(kr(2_500)), 2_500);
  saveUp("Gift fund", monthlySaving(kr(300)), 300);

  const current = monthOf(today);
  for (const m of monthRange(planStart, current)) {
    b.budgetMonth(m, m >= addMonths(current, -1) ? "open" : "closed");
    for (const { id, monthly } of planned) b.assign(m, id, kr(monthly));
  }

  const rows: Rule[] = rules.map(([counterparty, job], i) => {
    const jobId = jobs.get(job);
    if (jobId === undefined) throw new Error(`The seed has no job called ${job}`);
    return { id: ruleId(testId(1_000 + i)), match: { counterparty }, result: { kind: "job", jobId }, origin: "set", priority: 0 };
  });
  const facts = b.facts();
  return {
    ...facts,
    accounts: new Map([...facts.accounts].map(([id, account]) => [id, { ...account, ...bankDetails.get(id) }])),
    rules: new Map(rows.map((rule) => [rule.id, rule])),
  };
}

/** The household's four bank exports for the months its plan covers, ending yesterday: two from Bulder (the second overlaps the first by two weeks) and two from SpareBank 1. */
export function syntheticBankFiles(today: LocalDate): readonly SyntheticFile[] {
  const planStart = addMonths(monthOf(today), -3);
  return syntheticStatements({ from: localDate(`${addMonths(planStart, -2)}-01`), to: addDays(today, -1), seed: 20_261_109 }).files;
}
