/**
 * A synthetic year of household data for the benchmark and for tests that want realistic volume:
 * 6 accounts, 40 jobs of every kind, the plan from January 2026 with every month up to the current one
 * opened and assigned, half a year of history before it, and about 4,000 transactions with every
 * treatment. A seeded generator makes the same facts every time. Nothing here is real household data.
 */

import { type LocalDate, type Month, addMonths, localDate, month, monthRange } from "../dates.ts";
import type { Facts, SaveUpTarget, SpendPlan } from "../facts.ts";
import type { AccountId, GroupId, JobId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { amountByMonth, evenOut, factsBuilder, followBills, kr, monthlySaving, setAmount } from "./facts-builder.ts";

/** A small, fast, seeded generator (mulberry32), so the year is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface SyntheticYear {
  readonly facts: Facts;
  readonly asOf: LocalDate;
}

interface SpendSpec {
  readonly name: string;
  readonly plan: SpendPlan;
  readonly typical: number;
  readonly perMonth: number;
  readonly keepsMoney?: boolean;
  readonly essential?: boolean;
  readonly status?: "active" | "paused" | "archived";
}

const fixedCosts: readonly SpendSpec[] = [
  { name: "Mortgage", plan: setAmount(kr(14_500)), typical: 14_500, perMonth: 1, essential: true },
  { name: "Electricity", plan: evenOut(kr(3_050), "2026-01"), typical: 3_000, perMonth: 1, essential: true },
  { name: "Kommunale avgifter", plan: evenOut(kr(1_450), "2026-01"), typical: 1_450, perMonth: 1, essential: true },
  { name: "Phones and internet", plan: setAmount(kr(1_390)), typical: 1_390, perMonth: 1, essential: true },
  { name: "House insurance", plan: setAmount(kr(950)), typical: 950, perMonth: 1, essential: true },
  { name: "Car insurance", plan: setAmount(kr(780)), typical: 780, perMonth: 1, essential: true },
  { name: "Water", plan: followBills(), typical: 600, perMonth: 1, essential: true },
  { name: "Kindergarten", plan: setAmount(kr(3_400)), typical: 3_400, perMonth: 1, essential: true },
  { name: "Subscriptions", plan: setAmount(kr(1_800)), typical: 150, perMonth: 8 },
  { name: "Car loan", plan: setAmount(kr(2_900)), typical: 2_900, perMonth: 1, essential: true },
  { name: "Activities and SFO", plan: followBills(), typical: 3_400, perMonth: 1 },
  { name: "Union fees", plan: setAmount(kr(450)), typical: 450, perMonth: 1, status: "paused" },
];

const living: readonly SpendSpec[] = [
  { name: "Food and household", plan: setAmount(kr(14_200)), typical: 300, perMonth: 60, essential: true },
  { name: "Eating out", plan: setAmount(kr(2_000)), typical: 350, perMonth: 6 },
  { name: "Clothes and kids", plan: setAmount(kr(2_800)), typical: 400, perMonth: 7 },
  { name: "Car running costs", plan: setAmount(kr(3_200)), typical: 550, perMonth: 5, keepsMoney: true, essential: true },
  { name: "Fuel", plan: setAmount(kr(2_400)), typical: 600, perMonth: 4, essential: true },
  { name: "Pharmacy", plan: setAmount(kr(500)), typical: 120, perMonth: 4 },
  { name: "Hobbies", plan: setAmount(kr(1_000)), typical: 250, perMonth: 4 },
  { name: "Home maintenance", plan: setAmount(kr(1_500)), typical: 700, perMonth: 2, keepsMoney: true },
  { name: "Garden", plan: setAmount(kr(600)), typical: 300, perMonth: 2 },
  { name: "Pets", plan: setAmount(kr(800)), typical: 200, perMonth: 4 },
  { name: "Personal care", plan: setAmount(kr(700)), typical: 180, perMonth: 4 },
  { name: "Public transport", plan: setAmount(kr(900)), typical: 45, perMonth: 30 },
  { name: "Pocket money", plan: setAmount(kr(800)), typical: 100, perMonth: 8 },
  { name: "Gifts", plan: followBills(), typical: 400, perMonth: 3 },
  { name: "Books and games", plan: setAmount(kr(400)), typical: 150, perMonth: 3, status: "archived" },
  { name: "Coffee", plan: setAmount(kr(400)), typical: 45, perMonth: 15 },
  { name: "Sports", plan: setAmount(kr(1_200)), typical: 300, perMonth: 3 },
];

export function syntheticYear(seed = 2026): SyntheticYear {
  const random = seeded(seed);
  const between = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1));
  const near = (typical: number): Money => kr(Math.max(1, Math.round(typical * (0.6 + random() * 0.8))));
  const dayIn = (m: Month, last = 28): LocalDate => localDate(`${m}-${String(between(1, last)).padStart(2, "0")}`);
  const pick = <T>(list: readonly T[]): T => {
    const item = list[between(0, list.length - 1)];
    if (item === undefined) throw new Error("Nothing to pick from");
    return item;
  };

  const b = factsBuilder({ planStart: "2026-01" });
  const asOf = localDate("2026-12-15");

  const everyday = b.account({ name: "Felles brukskonto", kind: "everyday", openingBalance: kr(18_000), openingDate: "2025-12-31" });
  const bills = b.account({ name: "Regninger", kind: "bills", openingBalance: kr(9_000), openingDate: "2025-12-31" });
  const bufferAccount = b.account({ name: "Buffer", kind: "savings", openingBalance: kr(60_000), openingDate: "2025-12-31" });
  const savings = b.account({ name: "Sparing", kind: "savings", openingBalance: kr(42_000), openingDate: "2025-12-31" });
  const childA = b.account({ name: "Eldste", kind: "savings", scope: "paidInto", openingBalance: kr(9_800), openingDate: "2025-12-31" });
  const childB = b.account({ name: "Yngste", kind: "savings", scope: "paidInto", openingBalance: kr(6_100), openingDate: "2025-12-31" });

  const fixedGroup = b.group({ name: "Fixed costs" });
  const livingGroup = b.group({ name: "Living" });
  const savingGroup = b.group({ name: "Saving", countsTowardsSavingsRate: true });

  const spendJobs: { readonly id: JobId; readonly spec: SpendSpec; readonly account: AccountId }[] = [];
  const addSpend = (spec: SpendSpec, groupId: GroupId, accountId: AccountId): void => {
    const id = b.spendJob({
      name: spec.name,
      groupId,
      accountId,
      plan: spec.plan,
      keepsMoney: spec.keepsMoney ?? spec.plan.mode === "evenOut",
      essential: spec.essential ?? false,
      status: spec.status ?? "active",
      seasonality: spec.name === "Electricity" ? "seasonal" : "auto",
      opening: spec.plan.mode === "evenOut" ? kr(2_000) : kr(0),
    });
    spendJobs.push({ id, spec, account: accountId });
  };
  for (const spec of fixedCosts) addSpend(spec, fixedGroup, bills);
  for (const spec of living) addSpend(spec, livingGroup, everyday);

  const buffer = b.buffer({ groupId: savingGroup, accountId: bufferAccount, monthly: kr(2_000), opening: kr(60_000) });
  const saveUp = (name: string, target: SaveUpTarget, monthly: number, extra: { readonly opening?: Money; readonly status?: "paused" } = {}) => ({
    id: b.saveUpJob({ name, groupId: savingGroup, accountId: savings, target, ...extra }),
    monthly,
    until: target.kind === "amountByMonth" ? target.readyBy : month("9999-12"),
  });
  const holidays = saveUp("Holidays", amountByMonth(kr(21_000), "2026-06"), 3_000);
  const saveUps = [
    holidays,
    saveUp("Konfirmasjon", amountByMonth(kr(38_000), "2027-05"), 2_000, { opening: kr(9_600) }),
    saveUp("New car", amountByMonth(kr(120_000), "2028-12"), 3_500),
    saveUp("Build savings", monthlySaving(kr(5_000)), 5_000, { opening: kr(30_000) }),
    saveUp("Christmas", monthlySaving(kr(1_200)), 1_200, { opening: kr(2_400) }),
    saveUp("Bike", monthlySaving(kr(500)), 0, { status: "paused" }),
    saveUp("Dentist", monthlySaving(kr(400)), 400),
    saveUp("Winter tyres", amountByMonth(kr(8_000), "2026-10"), 800),
  ];
  const payIntos = [
    { id: b.payIntoJob({ name: "Eldste savings", groupId: savingGroup, accountId: everyday, monthly: kr(500), payInto: childA }), monthly: 500 },
    { id: b.payIntoJob({ name: "Yngste savings", groupId: savingGroup, accountId: everyday, monthly: kr(500), payInto: childB }), monthly: 500 },
  ];

  const planStart = month("2026-01");
  const current = month("2026-12");
  const historyMonths = monthRange(addMonths(planStart, -6), addMonths(planStart, -1));
  for (const m of historyMonths) {
    for (const { id, spec, account } of spendJobs) {
      for (let i = 0; i < spec.perMonth; i++) b.history({ accountId: account, date: dayIn(m), amount: negative(near(spec.typical)), jobId: id });
    }
    b.history({ accountId: everyday, date: dayIn(m), amount: kr(between(-900, -100)) });
  }

  const livingInUse = spendJobs.filter((j) => j.account === everyday && (j.spec.status ?? "active") === "active");
  for (const m of monthRange(planStart, current)) {
    const isCurrent = m === current;
    b.budgetMonth(m, isCurrent ? "open" : "closed");
    const lastDay = isCurrent ? 15 : 28;

    for (const { id, spec } of spendJobs) {
      const planned = spec.plan.mode === "setAmount" ? spec.plan.amount : spec.plan.mode === "evenOut" ? spec.plan.monthly : kr(spec.typical);
      b.assign(m, id, spec.status === "active" || spec.status === undefined ? planned : kr(0));
    }
    b.assign(m, buffer, kr(2_000));
    for (const s of saveUps) b.assign(m, s.id, kr(m > s.until ? 0 : s.monthly));
    for (const p of payIntos) b.assign(m, p.id, kr(p.monthly));

    // Contributions and child benefit arrive around the 20th and fund the next month (decision 1).
    const contributionDay = isCurrent ? "12" : "20";
    b.income({ accountId: everyday, date: `${m}-${contributionDay}`, amount: kr(32_000), fundsMonth: addMonths(m, 1) });
    b.income({ accountId: everyday, date: `${m}-${contributionDay}`, amount: kr(36_000), fundsMonth: addMonths(m, 1) });
    b.income({ accountId: everyday, date: `${m}-${contributionDay}`, amount: kr(4_964), fundsMonth: addMonths(m, 1), source: "recurring" });
    b.transfer({ from: everyday, to: bills, date: `${m}-0${between(1, 5)}`, amount: kr(32_000) });
    b.transfer({ from: everyday, to: savings, date: `${m}-0${between(1, 5)}`, amount: kr(12_000) });
    b.transfer({ from: everyday, to: bufferAccount, date: `${m}-0${between(1, 5)}`, amount: kr(2_000) });

    for (const { id, spec, account } of spendJobs) {
      if (spec.status === "archived" || spec.status === "paused") continue;
      for (let i = 0; i < spec.perMonth; i++) b.spend({ accountId: account, date: dayIn(m, lastDay), amount: negative(near(spec.typical)), jobId: id });
    }
    for (let i = 0; i < 3; i++) b.spend({ accountId: everyday, date: dayIn(m, lastDay), amount: kr(between(50, 600)), jobId: pick(livingInUse).id });
    for (let i = 0; i < 10; i++) {
      b.split({ accountId: everyday, date: dayIn(m, lastDay), allocations: [[pick(livingInUse).id, negative(near(300))], [pick(livingInUse).id, negative(near(200))]] });
    }
    for (const p of payIntos) b.spend({ accountId: everyday, date: `${m}-0${between(1, 9)}`, amount: kr(-p.monthly), jobId: p.id });
    if (m === "2026-06") b.spend({ accountId: savings, date: `${m}-10`, amount: kr(-19_500), jobId: holidays.id });
    if (isCurrent) {
      for (let i = 0; i < 6; i++) b.needsYou({ accountId: everyday, date: dayIn(m, lastDay), amount: kr(between(-800, -50)) });
    }
  }

  b.move({ from: bufferAccount, to: bills, amount: kr(4_100), month: "2026-12", reason: "Seed the Electricity bucket from Buffer" });
  b.move({ from: everyday, to: savings, amount: kr(3_000), month: "2026-11", reason: "Start the Holidays bucket", status: "done" });
  b.enteredValue({ kind: "reference", subject: "buffer-months", value: 3, unit: "months", asOf: "2026-01-05" });
  b.enteredValue({ kind: "accountBalance", subject: childA, value: kr(9_800), asOf: "2025-12-31" });
  b.enteredValue({ kind: "accountBalance", subject: childB, value: kr(6_100), asOf: "2025-12-31" });
  b.enteredValue({ kind: "asset", subject: "House", value: kr(4_600_000), asOf: "2025-06-01" });
  b.enteredValue({ kind: "figure", subject: "gross-income", value: kr(1_150_000), asOf: "2026-03-31" });

  return { facts: b.facts(), asOf };
}

function negative(amount: Money): Money {
  return money(-amount);
}
