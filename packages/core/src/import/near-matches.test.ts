import { describe, expect, it } from "vitest";
import { apply } from "../commands/apply.ts";
import { kr } from "../testing/facts-builder.ts";
import { type RowSpec, commitPlan, importHousehold, importInput, numbers, statement, today } from "../testing/synthetic-statement.ts";
import { nearMatches } from "./near-matches.ts";
import { planImport } from "./plan.ts";

const shop = (date: string, description = "Kiwi Sentrum"): RowSpec => ({ account: numbers.everyday, date, amount: kr(-120), description });

describe("nearMatches", () => {
  it("names the transaction a needs-you one may duplicate: same account, amount and description, a day apart", () => {
    const h = importHousehold();
    const earlier = h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "KIWI sentrum" });
    const later = h.builder.needsYou({ date: "2026-11-03", amount: kr(-120), description: "Kiwi  Sentrum" });
    h.builder.needsYou({ date: "2026-11-05", amount: kr(-120), description: "Kiwi Sentrum" });
    h.builder.needsYou({ date: "2026-11-04", amount: kr(-121), description: "Kiwi Sentrum" });
    h.builder.needsYou({ accountId: h.accounts.savings, date: "2026-11-04", amount: kr(-120), description: "Kiwi Sentrum" });
    expect(nearMatches(h.facts())).toEqual(new Map([[earlier, later], [later, earlier]]));
  });

  it("names the smallest ID when there are several", () => {
    const h = importHousehold();
    const before = h.builder.needsYou({ date: "2026-11-02", amount: kr(-120), description: "Kiwi" });
    const middle = h.builder.needsYou({ date: "2026-11-03", amount: kr(-120), description: "Kiwi" });
    h.builder.needsYou({ date: "2026-11-04", amount: kr(-120), description: "Kiwi" });
    expect(nearMatches(h.facts()).get(middle)).toBe(before);
  });

  it("drops the suggestion once the family gives the transaction a treatment", () => {
    const h = importHousehold();
    const kept = h.builder.spend({ date: "2026-11-02", amount: kr(-120), description: "Kiwi", jobId: h.jobs.food });
    const waiting = h.builder.needsYou({ date: "2026-11-03", amount: kr(-120), description: "Kiwi" });
    expect(nearMatches(h.facts())).toEqual(new Map([[waiting, kept]]));
    const treated = apply(h.facts(), { kind: "setTreatment", transactionId: waiting, treatment: { kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-120) }] } }, { asOf: today });
    expect(treated.ok && nearMatches(treated.facts).size).toBe(0);
  });

  it("never pairs two transactions that one file lists both, because the bank says they are two", () => {
    const h = importHousehold();
    const both = commitPlan(h.facts(), planImport(h.facts(), statement([shop("2026-11-02"), shop("2026-11-03")]), importInput("one", 10_000)));
    expect(nearMatches(both).size).toBe(0);
  });

  it("pairs transactions from two overlapping files that booked the same purchase on different days", () => {
    const h = importHousehold();
    const first = commitPlan(h.facts(), planImport(h.facts(), statement([shop("2026-11-02")]), importInput("one", 10_000)));
    const plan = planImport(first, statement([shop("2026-11-03")]), importInput("two", 20_000));
    const second = commitPlan(first, plan);
    const [original] = first.transactions.keys();
    const [added] = plan.ok ? plan.preview.sample.map((s) => s.transactionId) : [];
    expect(nearMatches(second)).toEqual(new Map([[original, added], [added, original]]));
  });
});
