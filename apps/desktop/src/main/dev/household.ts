/**
 * The invented household behind the development seed: six shared accounts that carry the synthetic banks' account
 * numbers and four the household pays into, two adults and four children, the contributions the adults agreed, about
 * forty-six jobs, the plan from three months ago and a few rules. It holds no transactions. The seed gets those by
 * importing the synthetic bank files, so they are what the real import makes of them, and then settles what only the
 * family could say: which transactions are the agreed contributions, and how much of the month is left unassigned.
 */

import {
  type AccountId,
  type Command,
  type Facts,
  type GroupId,
  type JobId,
  type LocalDate,
  type Month,
  type Rule,
  type SpendPlan,
  addDays,
  addMonths,
  apply,
  assignmentKey,
  computeFigures,
  localDate,
  money,
  monthOf,
  monthRange,
  ruleId,
} from "@holt/core";
import { amountByMonth, evenOut, factsBuilder, followBills, kr, monthlySaving, setAmount, testId } from "@holt/core/testing";
import { type SyntheticFile, syntheticAccounts, syntheticChildSaving, syntheticContributions, syntheticStatements } from "@holt/importers/synthetic";

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
  { name: "Electricity", monthly: 2_900, mode: "followBills", essential: true },
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

/** Who is a child, how old at the seed's date (invented ages), and how many months past the last birthday. */
const children = [
  { name: "Eldest", age: 15, months: 8, balance: 24_000 },
  { name: "Second", age: 11, months: 3, balance: 17_700 },
  { name: "Third", age: 8, months: 10, balance: 9_300 },
  { name: "Youngest", age: 4, months: 5, balance: 5_600 },
] as const;

/** The job that takes whatever the open month's money leaves over beyond `unassignedLeft`. */
export const balancingJob = "Build savings";

/** What the open month leaves without a job, as in the Plan mockup: 228 kr. */
export const unassignedLeft = kr(228);

/** How many months of bank files the seed makes, so the electricity bills from January to October are all there when the day is in November. */
const monthsOfBankFiles = 10;

/** Counterparties the synthetic banks name, and the job the family has told the app they always go to. */
const rules: readonly (readonly [counterparty: string, job: string])[] = [
  ["Kaffebaren Torget", "Coffee"],
  ["Nærbutikken Fjord", "Food and household"],
  ["Fjordmat", "Food and household"],
  ["Byggvare Nord", "Home maintenance"],
  ["Apoteket Sentrum", "Pharmacy"],
  ["Fjordstrøm Energi", "Electricity"],
  ["Nettbredd Bredbånd", "Phones and internet"],
  ["Eksempel Borettslag", "Mortgage"],
  ...children.map(({ name }): readonly [string, string] => [`Barnesparing ${name}`, name]),
];

export function seedHousehold(today: LocalDate): Facts {
  const planStart = addMonths(monthOf(today), -3);
  const b = factsBuilder({ planStart });
  const opening = { openingDate: addDays(localDate(`${planStart}-01`), -1) };
  const { bulder, sparebank1 } = syntheticAccounts;

  const current = monthOf(today);
  const everyday = b.account({ name: "Everyday", kind: "everyday", openingBalance: kr(18_000), ...opening });
  const bills = b.account({ name: "Bills", kind: "bills", openingBalance: kr(9_000), ...opening });
  const food = b.account({ name: "Food", kind: "everyday", openingBalance: kr(4_000), ...opening });
  const holiday = b.account({ name: "Holiday", kind: "savings", openingBalance: kr(6_000), ...opening });
  const loanPayments = b.account({ name: "Loan payments", kind: "bills", openingBalance: kr(9_412), ...opening });
  const deposit = b.account({ name: "Deposit", kind: "savings", openingBalance: kr(75_000), ...opening });
  const bankDetails = new Map([
    [everyday, { number: bulder.everyday.number, importRhythm: "weekly" }],
    [bills, { number: bulder.bills.number, importRhythm: "weekly" }],
    [food, { number: bulder.food.number, importRhythm: "weekly" }],
    [holiday, { number: bulder.holiday.number, importRhythm: "monthly" }],
    [loanPayments, { number: sparebank1.loanPayments.number, importRhythm: "monthly" }],
    [deposit, { number: sparebank1.deposit.number, importRhythm: "monthly" }],
  ] as const);

  const stephen = b.person({ name: "Stephen" });
  const partner = b.person({ name: "Partner" });
  const [stephenPays, partnerPays] = syntheticContributions.map(({ parts }) => kr(parts.reduce((sum, p) => sum + p.kroner, 0)));
  b.agreement({ person: stephen, accountId: everyday, amount: stephenPays!, day: 20 });
  b.agreement({ person: partner, accountId: everyday, amount: partnerPays!, day: 20 });

  const typedOn = localDate(`${addMonths(current, -1)}-05`);
  const kids = children.map(({ name, age, months, balance }) => {
    b.person({ name, kind: "child", birthMonth: addMonths(current, -(age * 12 + months)) });
    const account = b.account({ name: `${name}'s savings`, kind: "savings", scope: "paidInto", ...opening });
    b.enteredValue({ kind: "accountBalance", subject: account, value: kr(balance), asOf: typedOn, source: "entered by you" });
    return { name, account };
  });

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

  // Two buckets next to the Buffer. Konfirmasjon is short for its date, and Christmas and gifts is evened out.
  const konfirmasjon = b.saveUpJob({ name: "Konfirmasjon", groupId: livingGroup, accountId: deposit, target: amountByMonth(kr(38_000), addMonths(planStart, 9)), opening: kr(3_100) });
  jobs.set("Konfirmasjon", konfirmasjon);
  planned.push({ id: konfirmasjon, monthly: 1_500 });
  const christmas = b.spendJob({ name: "Christmas and gifts", groupId: livingGroup, accountId: deposit, plan: evenOut(kr(1_200), planStart), opening: kr(6_100) });
  jobs.set("Christmas and gifts", christmas);
  planned.push({ id: christmas, monthly: 1_200 });

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
  for (const { name, account } of kids) {
    const id = b.payIntoJob({ name, groupId: savingGroup, accountId: everyday, monthly: kr(syntheticChildSaving), payInto: account });
    jobs.set(name, id);
    planned.push({ id, monthly: syntheticChildSaving });
  }

  b.bucketTransfer({ month: current, from: christmas, to: konfirmasjon, amount: kr(500), reason: "Konfirmasjon needs the money before Christmas does." });
  for (const m of monthRange(planStart, current)) {
    b.budgetMonth(m, m === current ? "open" : "closed");
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

/**
 * The household's four bank exports for the last ten months, ending yesterday: two from Bulder (the second overlaps the
 * first by two weeks) and two from SpareBank 1. The first seven months are before the plan starts, so they are history.
 * The older Bulder file runs to the 22nd of last month, so what the adults paid in on the 20th and the 22nd is in it
 * whatever the day, and the newer file still brings days the older one lacks.
 */
export function syntheticBankFiles(today: LocalDate): readonly SyntheticFile[] {
  const to = addDays(today, -1);
  const lastMonthsPaydays = localDate(`${addMonths(monthOf(today), -1)}-22`);
  const olderEnd = lastMonthsPaydays > addDays(to, -28) ? lastMonthsPaydays : addDays(to, -28);
  return syntheticStatements({ from: localDate(`${addMonths(monthOf(today), -monthsOfBankFiles)}-01`), to, seed: 20_261_109, olderEnd }).files;
}

/**
 * The one change the seed makes once the files are in, as the family would: it says which transactions are the
 * agreed contributions (income that funds the month after it was booked, tied to who paid it), and it gives the
 * balancing job what the open month has left over beyond `unassignedLeft`. Only the contributions that fund the
 * current month or later are settled. Earlier ones stay in needs you, as the family hasn't confirmed them, and
 * settling them would carry months of unspent money into this one.
 */
export function seedSettlement(facts: Facts, today: LocalDate): Command {
  const current = monthOf(today);
  const firstBooked: Month = addMonths(current, -1);
  const agreementOf = new Map([...facts.contributionAgreements.values()].map((a) => [facts.people.get(a.personId)?.name, a] as const));
  const contributions: Command[] = [];
  for (const t of facts.transactions.values()) {
    const agreement = agreementOf.get(t.counterparty);
    if (agreement === undefined || t.accountId !== agreement.accountId || t.amount <= 0 || t.treatment.kind !== "needsYou" || monthOf(t.bookingDate) < firstBooked) continue;
    contributions.push({ kind: "setTreatment", transactionId: t.id, treatment: { kind: "income", fundsMonth: addMonths(monthOf(t.bookingDate), 1), source: "contribution", agreement: agreement.id } });
  }

  const job = [...facts.jobs.values()].find((j) => j.name === balancingJob);
  if (job === undefined) throw new Error(`The seed has no job called ${balancingJob}`);
  const settled = apply(facts, { kind: "batch", commands: contributions }, { asOf: today });
  if (!settled.ok) throw new Error(`The seed could not settle the contributions: ${settled.refusal.code}`);
  const open = computeFigures(settled.facts, today).months.get(current);
  if (open === undefined) throw new Error("The seed has no figures for the current month");
  const spare = open.unassigned.kind === "unassigned" ? open.unassigned.amount : -open.unassigned.amount;
  const amount = (facts.assignments.get(assignmentKey(current, job.id))?.amount ?? 0) + spare - unassignedLeft;
  if (amount < 0) throw new Error(`The month has too little money to leave ${unassignedLeft} unassigned`);
  return { kind: "batch", commands: [...contributions, { kind: "assign", month: current, jobId: job.id, amount: money(amount) }] };
}
