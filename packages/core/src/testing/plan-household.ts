/**
 * November 2026 as the Plan mockup shows it (`design/mockups/Plan-hearth-light.png`), with invented names and
 * the mockup's numbers. 68,048 kr came in for the month and 67,820 kr is assigned, so 228 kr has no job yet.
 * The plan starts in October (closed, empty), November is open and today is 9 November 2026.
 *
 * Money in lands in Felles brukskonto. Bills sit in Regning, Konfirmasjon, Christmas and Buffer in Buffer, and
 * Build savings in Byggesparing; the children's savings are paid from Felles into accounts of their own.
 * The buckets at the end of November are Buffer 86,000 kr, Build savings 212,000, Konfirmasjon 9,600 and
 * Christmas 10,400. The essential spending is 52,820 kr a month (fixed costs and food), so the buffer's target
 * is 158,460 kr. Saving, the one group that counts towards the savings rate, is 9,500 kr: 14.0% of the money in.
 *
 * Konfirmasjon, Christmas and the children's savings are marked essential so that the jobs money can come from
 * are Build savings, Buffer and Clothes and kids. (Only essential spend jobs set the buffer's target, so the
 * flag changes no figure.) The family would not touch the others.
 */

import { localDate } from "../dates.ts";
import { amountByMonth, factsBuilder, kr, monthlySaving, setAmount } from "./facts-builder.ts";

export const planToday = localDate("2026-11-09");
export const planMonth = "2026-11";

export function planHousehold() {
  const b = factsBuilder({ planStart: "2026-10" });
  const felles = b.account({ name: "Felles brukskonto", openingBalance: kr(18_420), openingDate: "2026-09-30" });
  const regning = b.account({ name: "Regning", kind: "bills", openingBalance: kr(24_960), openingDate: "2026-09-30" });
  const buffer = b.account({ name: "Buffer", kind: "savings", openingBalance: kr(106_000), openingDate: "2026-09-30" });
  const byggesparing = b.account({ name: "Byggesparing", kind: "savings", openingBalance: kr(212_000), openingDate: "2026-09-30" });
  const children = ["Eldest", "Second", "Third", "Youngest"].map((name) =>
    b.account({ name: `${name}'s savings`, kind: "savings", scope: "paidInto", openingBalance: kr(10_000), openingDate: "2026-09-30" }),
  );

  const fixed = b.group({ name: "Fixed costs" });
  const living = b.group({ name: "Living" });
  const saving = b.group({ name: "Saving", countsTowardsSavingsRate: true });

  const bill = (name: string, kroner: number) => b.spendJob({ name, plan: setAmount(kr(kroner)), groupId: fixed, accountId: regning, essential: true });
  const fixedCosts = {
    mortgage: bill("Mortgage", 19_850),
    insurance: bill("Insurance", 4_630),
    electricity: bill("Electricity", 2_900),
    municipal: bill("Kommunale avgifter", 1_450),
    car: bill("Car running costs", 3_200),
    phones: bill("Phones and internet", 1_390),
    subscriptions: bill("Subscriptions", 1_800),
    activities: bill("Activities and SFO", 3_400),
  };
  const food = b.spendJob({ name: "Food and household", plan: setAmount(kr(14_200)), groupId: living, accountId: felles, essential: true });
  const clothes = b.spendJob({ name: "Clothes and kids", plan: setAmount(kr(2_800)), groupId: living, accountId: felles });
  const konfirmasjon = b.saveUpJob({ name: "Konfirmasjon", target: amountByMonth(kr(38_000), "2027-05"), groupId: living, accountId: buffer, essential: true, opening: kr(8_100) });
  const christmas = b.saveUpJob({ name: "Christmas and gifts", target: monthlySaving(kr(1_200)), groupId: living, accountId: buffer, essential: true, opening: kr(9_200) });
  const bufferJob = b.buffer({ monthly: kr(3_000), groupId: saving, accountId: buffer, opening: kr(83_000) });
  const build = b.saveUpJob({ name: "Build savings", target: monthlySaving(kr(4_500)), groupId: saving, accountId: byggesparing, opening: kr(207_500) });
  const childSavings = children.map((payInto, i) =>
    b.payIntoJob({ name: ["Eldest", "Second", "Third", "Youngest"][i] as string, monthly: kr(500), payInto, groupId: saving, accountId: felles, essential: true }),
  );

  b.budgetMonth("2026-10", "closed");
  b.budgetMonth(planMonth, "open");
  const amounts: [typeof bufferJob, number][] = [
    [fixedCosts.mortgage, 19_850],
    [fixedCosts.insurance, 4_630],
    [fixedCosts.electricity, 2_900],
    [fixedCosts.municipal, 1_450],
    [fixedCosts.car, 3_200],
    [fixedCosts.phones, 1_390],
    [fixedCosts.subscriptions, 1_800],
    [fixedCosts.activities, 3_400],
    [food, 14_200],
    [clothes, 2_800],
    [konfirmasjon, 1_500],
    [christmas, 1_200],
    [bufferJob, 3_000],
    [build, 4_500],
    ...childSavings.map((job): [typeof bufferJob, number] => [job, 500]),
  ];
  for (const [job, kroner] of amounts) b.assign(planMonth, job, kr(kroner));

  b.income({ date: "2026-10-20", amount: kr(32_000), fundsMonth: planMonth, accountId: felles });
  b.income({ date: "2026-10-20", amount: kr(28_000), fundsMonth: planMonth, accountId: felles });
  b.income({ date: "2026-10-25", amount: kr(8_048), fundsMonth: planMonth, accountId: felles, source: "recurring" });

  return {
    b,
    facts: b.facts(),
    accounts: { felles, regning, buffer, byggesparing },
    groups: { fixed, living, saving },
    jobs: { ...fixedCosts, food, clothes, konfirmasjon, christmas, buffer: bufferJob, build, childSavings },
  };
}
