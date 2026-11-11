import { type Facts, computeFigures, localDate, month } from "@holt/core";
import { factsBuilder, kr, monthlySaving } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { whereTheMoneySits } from "./PlanAccounts.model.ts";
import { buildWorld, today } from "./PlanTestWorld.ts";

const sits = (facts: Facts) => whereTheMoneySits(facts, computeFigures(facts, today));

describe("where the money sits", () => {
  const world = buildWorld();
  const result = sits(world.facts);

  it("lists each shared account with its balance and the buckets in it, and the accounts the household pays into apart", () => {
    expect(result.shared.map((a) => a.name)).toEqual(["Everyday", "Deposit"]);
    expect(result.paidInto.map((a) => a.name)).toEqual(["Eldest's savings"]);
    const everyday = result.shared[0];
    expect(everyday?.balance).toBe(kr(18_000 + 60_000 - 2_140 - 640 - 500));
    expect(everyday?.buckets).toEqual([
      { jobId: world.jobs.electricity, name: "Electricity", amount: kr(5_050) },
      { jobId: world.jobs.cars, name: "Car running costs", amount: kr(2_560) },
      { jobId: world.jobs.eldest, name: "Eldest", amount: kr(0) },
    ]);
    const deposit = result.shared[1];
    expect(deposit?.buckets.map((b) => [b.name, b.amount])).toEqual([
      ["Confirmation", kr(9_600)],
      ["Holidays", kr(3_000)],
      ["Christmas", kr(11_600)],
      ["Buffer", kr(42_000)],
      ["Build savings", kr(13_000)],
    ]);
  });

  it("says the money not set aside in a bucket, only for an account that has buckets", () => {
    expect(result.shared[0]?.remainder).toEqual({ kind: "unbucketed", amount: kr(18_000 + 60_000 - 2_140 - 640 - 500 - 5_050 - 2_560) });
    const plain = factsBuilder({ planStart: "2026-11" });
    plain.account({ name: "Spending", openingBalance: kr(1_000), openingDate: "2026-10-31" });
    expect(sits(plain.facts()).shared[0]?.remainder).toEqual({ kind: "none" });
  });

  it("flags buckets that hold more than the account, and names the monthly move still to make as the likely cause", () => {
    const deposit = result.shared[1];
    expect(deposit?.remainder).toEqual({ kind: "bucketsExceedBalance", amount: kr(12_700), cause: { kind: "monthlyMove", amount: kr(12_700) } });
  });

  it("names moves still to do at the bank first, when there are some", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    const from = b.account({ name: "Everyday", openingBalance: kr(50_000), openingDate: "2026-10-31" });
    const to = b.account({ name: "Deposit", kind: "savings", openingBalance: kr(0), openingDate: "2026-10-31" });
    const group = b.group({ name: "Saving" });
    b.saveUpJob({ name: "Buffer", groupId: group, accountId: to, target: monthlySaving(kr(0)), opening: kr(5_000) });
    b.move({ from, to, amount: kr(5_000), month: "2026-11", reason: "Fill the buffer" });
    const flagged = sits(b.facts()).shared.find((a) => a.name === "Deposit");
    expect(flagged?.remainder).toEqual({ kind: "bucketsExceedBalance", amount: kr(5_000), cause: { kind: "movesToDo", moves: [{ amount: kr(5_000), month: month("2026-11") }] } });
  });

  it("says the app can't see why when nothing explains the shortfall", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    const account = b.account({ name: "Deposit", kind: "savings", openingBalance: kr(3_000), openingDate: "2026-10-31" });
    const group = b.group({ name: "Saving" });
    b.saveUpJob({ name: "Buffer", groupId: group, accountId: account, target: monthlySaving(kr(0)), opening: kr(5_000) });
    expect(sits(b.facts()).shared[0]?.remainder).toEqual({ kind: "bucketsExceedBalance", amount: kr(2_000), cause: { kind: "unknown" } });
  });

  it("shows an account the household pays into with the balance the family entered and what was paid in since", () => {
    const kids = result.paidInto[0];
    expect(kids?.balance).toBe(kr(24_500));
    expect(kids?.basis).toEqual({ kind: "entered", baseDate: localDate("2026-07-31"), paidIn: kr(500) });
    expect(kids?.buckets).toEqual([]);
  });

  it("starts from the latest balance the family entered, and counts only payments after it", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    const shared = b.account({ name: "Everyday", openingBalance: kr(10_000), openingDate: "2026-10-31" });
    const kids = b.account({ name: "Kids", kind: "savings", scope: "paidInto", openingBalance: kr(1_000), openingDate: "2026-10-31" });
    const group = b.group({ name: "Children's savings" });
    const job = b.payIntoJob({ name: "Kid", groupId: group, accountId: shared, monthly: kr(500), payInto: kids });
    b.spend({ date: "2026-11-02", amount: kr(-500), accountId: shared, jobId: job });
    b.spend({ date: "2026-11-09", amount: kr(-500), accountId: shared, jobId: job });
    b.enteredValue({ kind: "accountBalance", subject: kids, value: kr(2_000), asOf: "2026-11-05" });
    const row = sits(b.facts()).paidInto[0];
    expect(row?.balance).toBe(kr(2_500));
    expect(row?.basis).toEqual({ kind: "entered", baseDate: localDate("2026-11-05"), paidIn: kr(500) });
  });
});
