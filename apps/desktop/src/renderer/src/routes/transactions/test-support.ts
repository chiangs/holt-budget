/**
 * A small invented household for the Needs you tests: two shared accounts, three groups, a handful of jobs and
 * the kinds of transaction that wait. The tests read the real figures from it, so a suggestion here is the
 * suggestion core makes. Every name and amount is made up.
 */

import {
  type AccountId,
  type Facts,
  type Figures,
  type JobId,
  type LocalDate,
  type Rule,
  type RuleId,
  type Transaction,
  type TransactionId,
  computeFigures,
  localDate,
  ruleId,
} from "@holt/core";
import { factsBuilder, kr, testId } from "@holt/core/testing";

export const today = localDate("2026-11-10");

export interface World {
  readonly facts: Facts;
  readonly figures: Figures;
  readonly accounts: { readonly everyday: AccountId; readonly savings: AccountId };
  readonly jobs: {
    readonly electricity: JobId;
    readonly phones: JobId;
    readonly food: JobId;
    readonly coffee: JobId;
    readonly buffer: JobId;
    readonly union: JobId;
    readonly books: JobId;
    readonly holidays: JobId;
  };
  readonly tx: {
    readonly lyseEarlier: TransactionId;
    readonly lyse: TransactionId;
    readonly viaplay: TransactionId;
    readonly nameless: TransactionId;
    readonly moveOut: TransactionId;
    readonly moveIn: TransactionId;
    readonly coffeeRefund: TransactionId;
    readonly salary: TransactionId;
    readonly shopOne: TransactionId;
    readonly shopTwo: TransactionId;
    readonly shopRefund: TransactionId;
  };
}

export function withTransaction(facts: Facts, id: TransactionId, change: Partial<Transaction>): Facts {
  const existing = facts.transactions.get(id);
  if (existing === undefined) throw new Error(`No transaction ${id}`);
  return { ...facts, transactions: new Map(facts.transactions).set(id, { ...existing, ...change }) };
}

export function withRule(facts: Facts, rule: Rule): Facts {
  return { ...facts, rules: new Map(facts.rules).set(rule.id, rule) };
}

export const aRuleId = (n: number): RuleId => ruleId(testId(9_000 + n));

export function figuresOf(facts: Facts, asOf: LocalDate = today): Figures {
  return computeFigures(facts, asOf);
}

export function buildWorld(): World {
  const b = factsBuilder({ planStart: "2026-08" });
  const everyday = b.account({ name: "Everyday" });
  const savings = b.account({ name: "Savings", kind: "savings" });
  const fixed = b.group({ name: "Fixed costs" });
  const living = b.group({ name: "Living" });
  const saving = b.group({ name: "Saving", countsTowardsSavingsRate: true });
  const plan = { mode: "setAmount", amount: kr(1_000) } as const;
  const spend = (name: string, groupId: typeof fixed, status?: "paused" | "archived") =>
    b.spendJob({ name, groupId, plan, ...(status === undefined ? {} : { status }) });
  const jobs = {
    phones: spend("Phones and internet", fixed),
    electricity: spend("Electricity", fixed),
    union: spend("Union fees", fixed, "paused"),
    food: spend("Food and household", living),
    coffee: spend("Coffee", living),
    books: spend("Books and games", living, "archived"),
    buffer: b.buffer({ groupId: saving, monthly: kr(1_000) }),
    holidays: b.saveUpJob({ name: "Holidays", groupId: saving, target: { kind: "monthly", amount: kr(500) }, status: "finished" }),
  };

  const lyseEarlier = b.spend({ date: "2026-10-05", amount: kr(-2_846), description: "LYSE ENERGI AS", jobId: jobs.electricity });
  const lyse = b.needsYou({ date: "2026-11-03", amount: kr(-3_100), description: "LYSE ENERGI AS" });
  const viaplay = b.needsYou({ date: "2026-11-01", amount: kr(-449), description: "VIAPLAY GROUP" });
  const nameless = b.needsYou({ date: "2026-10-28", amount: kr(-120), description: "KORTKJOP 4455" });
  const moveOut = b.needsYou({ date: "2026-11-02", amount: kr(-5_000), accountId: everyday, description: "Overføring til sparekonto" });
  const moveIn = b.needsYou({ date: "2026-11-02", amount: kr(5_000), accountId: savings, description: "Overføring fra brukskonto" });
  const coffeeEarlier = b.spend({ date: "2026-10-06", amount: kr(-60), description: "KAFFEBAREN TORGET", jobId: jobs.coffee });
  const coffeeRefund = b.needsYou({ date: "2026-11-04", amount: kr(250), description: "KAFFEBAREN TORGET" });
  const salary = b.needsYou({ date: "2026-11-05", amount: kr(28_000), description: "LONN" });
  const shopOne = b.needsYou({ date: "2026-11-06", amount: kr(-230), description: "NAERBUTIKKEN FJORD" });
  const shopTwo = b.needsYou({ date: "2026-11-07", amount: kr(-310), description: "NAERBUTIKKEN FJORD" });
  const shopRefund = b.needsYou({ date: "2026-11-08", amount: kr(80), description: "NAERBUTIKKEN FJORD" });

  let facts = b.facts();
  const names: readonly (readonly [TransactionId, string])[] = [
    [lyseEarlier, "Lyse Energi AS"],
    [lyse, "Lyse Energi AS"],
    [viaplay, "Viaplay Group"],
    [coffeeEarlier, "Kaffebaren Torget"],
    [coffeeRefund, "Kaffebaren Torget"],
    [salary, "Arbeidsgiver AS"],
    [shopOne, "Nærbutikken Fjord"],
    [shopTwo, "Nærbutikken Fjord"],
    [shopRefund, "Nærbutikken Fjord"],
  ];
  for (const [id, counterparty] of names) facts = withTransaction(facts, id, { counterparty });

  return {
    facts,
    figures: figuresOf(facts),
    accounts: { everyday, savings },
    jobs,
    tx: { lyseEarlier, lyse, viaplay, nameless, moveOut, moveIn, coffeeRefund, salary, shopOne, shopTwo, shopRefund },
  };
}
