/**
 * A small, sound household for command tests, built with the facts builder. The plan starts in October 2026;
 * October is closed, November is open and December is planned. Today is 9 November 2026. Alex, an adult,
 * pays 9,000 kr into the everyday account on the 20th, and Mia is a child.
 */

import type { ChangeAuthor } from "../change-log.ts";
import type { ApplyResult, ChangeMeta, CommitResult } from "../commands/apply.ts";
import { type LocalDate, localDate } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { changeId } from "../ids.ts";
import { factsBuilder, kr, monthlySaving, setAmount, testId } from "./facts-builder.ts";

export const today: LocalDate = localDate("2026-11-09");

export function commandHousehold() {
  const b = factsBuilder({ planStart: "2026-10" });
  const everyday = b.account({ name: "Everyday" });
  const savings = b.account({ name: "Savings", kind: "savings" });
  const child = b.account({ name: "Child", scope: "paidInto", kind: "savings" });
  const living = b.group({ name: "Living" });
  const buffer = b.buffer({ monthly: kr(2_000), opening: kr(60_000) });
  const food = b.spendJob({ name: "Food and household", plan: setAmount(kr(5_000)), essential: true });
  const holiday = b.saveUpJob({ name: "Holiday", target: monthlySaving(kr(1_000)), opening: kr(4_000) });
  const unused = b.spendJob({ name: "Hobbies", plan: setAmount(kr(0)) });
  b.budgetMonth("2026-10", "closed");
  b.budgetMonth("2026-11", "open");
  b.assign("2026-10", food, kr(5_000));
  b.assign("2026-11", food, kr(5_000));
  b.assign("2026-10", buffer, kr(2_000));
  b.assign("2026-11", buffer, kr(2_000));
  b.assign("2026-10", holiday, kr(1_000));
  const salary = b.income({ date: "2026-10-20", amount: kr(9_000), fundsMonth: "2026-11" });
  const shopping = b.spend({ date: "2026-11-03", amount: kr(-450), jobId: food });
  const earlier = b.history({ date: "2026-09-12", amount: kr(-300), jobId: food });
  const done = b.move({ from: everyday, to: savings, amount: kr(1_000), month: "2026-10", status: "done" });
  const toDo = b.move({ from: everyday, to: savings, amount: kr(4_000), month: "2026-11" });
  const alex = b.person({ name: "Alex" });
  const mia = b.person({ name: "Mia", kind: "child", birthMonth: "2018-04" });
  const contribution = b.agreement({ person: alex, accountId: everyday, amount: kr(9_000), day: 20, from: "2026-10" });
  const facts: Facts = b.facts();
  return {
    facts,
    accounts: { everyday, savings, child },
    living,
    jobs: { buffer, food, holiday, unused },
    transactions: { salary, shopping, earlier },
    moves: { done, toDo },
    people: { alex, mia },
    agreements: { contribution },
  };
}

export function changeMeta(n: number, by: ChangeAuthor = { kind: "family" }): ChangeMeta {
  return { id: changeId(testId(900_000 + n)), at: `2026-11-09T10:${String(n % 60).padStart(2, "0")}:00Z`, by };
}

/** The facts after an accepted command. Throws with the refusal's message otherwise, so a test fails loudly. */
export function accepted(result: ApplyResult | CommitResult): Facts {
  if (!result.ok) throw new Error(`Refused (${result.refusal.code}): ${result.refusal.message}`);
  return result.facts;
}
