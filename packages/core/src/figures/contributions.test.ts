import { describe, expect, it } from "vitest";
import { localDate, month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { AgreementId } from "../ids.ts";
import { money } from "../money.ts";
import { contributionHousehold } from "../testing/contribution-household.ts";
import { factsBuilder, kr } from "../testing/facts-builder.ts";
import { type ContributionStatus, contributionStatuses, expectedIncome, moneyIn } from "./contributions.ts";

/** Robin's agreement funds December with money expected on 15 November; the grace runs to the 18th. */
function robinIn(facts: Facts, robin: AgreementId, asOf: string, fundsMonth = "2026-12"): ContributionStatus {
  const found = contributionStatuses(facts, localDate(asOf)).find((s) => s.agreementId === robin && s.fundsMonth === month(fundsMonth));
  if (found === undefined) throw new Error(`No status for ${fundsMonth} as of ${asOf}`);
  return found;
}

describe("the months a status covers", () => {
  it("lists each agreement for the months from two before the current month to one after it", () => {
    const { b } = contributionHousehold();
    const statuses = contributionStatuses(b.facts(), localDate("2026-11-10"));
    expect(statuses.map((s) => [s.fundsMonth, s.personName])).toEqual([
      ["2026-09", "Robin"],
      ["2026-09", "Sam"],
      ["2026-10", "Robin"],
      ["2026-10", "Sam"],
      ["2026-11", "Robin"],
      ["2026-11", "Sam"],
      ["2026-12", "Robin"],
      ["2026-12", "Sam"],
    ]);
  });

  it("runs on across a year end", () => {
    const { b } = contributionHousehold();
    const months = contributionStatuses(b.facts(), localDate("2027-01-05")).map((s) => s.fundsMonth);
    expect([...new Set(months)]).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("starts at the agreement's first month and stops after its last", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const robin = b.agreement({ amount: kr(5_000), from: "2026-10", to: "2026-11" });
    const months = contributionStatuses(b.facts(), localDate("2026-11-10")).filter((s) => s.agreementId === robin).map((s) => s.fundsMonth);
    expect(months).toEqual(["2026-10", "2026-11"]);
  });

  it("has nothing for a month before the plan starts", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    b.agreement({ amount: kr(5_000), from: "2026-01" });
    expect(contributionStatuses(b.facts(), localDate("2026-11-10")).map((s) => s.fundsMonth)).toEqual(["2026-11", "2026-12"]);
  });

  it("has nothing when nobody has an agreement", () => {
    const b = factsBuilder();
    b.account();
    expect(contributionStatuses(b.facts(), localDate("2026-11-10"))).toEqual([]);
  });

  it("follows a change of amount as a second agreement from a later month, one status for each month", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const person = b.person({ name: "Robin" });
    const before = b.agreement({ person, amount: kr(18_000), to: "2026-11" });
    const after = b.agreement({ person, amount: kr(20_000), from: "2026-12" });
    const statuses = contributionStatuses(b.facts(), localDate("2026-11-10"));
    expect(statuses.filter((s) => s.fundsMonth === "2026-11").map((s) => [s.agreementId, s.agreed])).toEqual([[before, kr(18_000)]]);
    expect(statuses.filter((s) => s.fundsMonth === "2026-12").map((s) => [s.agreementId, s.agreed])).toEqual([[after, kr(20_000)]]);
  });
});

describe("what a status says about the agreement", () => {
  it("names the person, the account, the amount, the day it is expected and the last day it counts as on time", () => {
    const { b, people, accounts, agreements } = contributionHousehold();
    expect(robinIn(b.facts(), agreements.robin, "2026-11-10")).toEqual({
      agreementId: agreements.robin,
      personId: people.robin,
      personName: "Robin",
      accountId: accounts.everyday,
      fundsMonth: "2026-12",
      state: "expected",
      agreed: kr(20_000),
      arrived: money(0),
      stillExpected: kr(20_000),
      transactionIds: [],
      arrivedOn: null,
      expectedOn: "2026-11-15",
      graceUntil: "2026-11-18",
    });
  });

  it("is expected in the month before the one it funds, whatever the year", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const robin = b.agreement({ amount: kr(5_000), day: 28 });
    const january = contributionStatuses(b.facts(), localDate("2026-12-10")).find((s) => s.agreementId === robin && s.fundsMonth === "2027-01");
    expect(january).toMatchObject({ expectedOn: "2026-12-28", graceUntil: "2026-12-31" });
  });

  it("lets the grace run over a month end", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const robin = b.agreement({ amount: kr(5_000), day: 28 });
    expect(contributionStatuses(b.facts(), localDate("2026-11-10")).find((s) => s.agreementId === robin && s.fundsMonth === "2026-12")).toMatchObject({
      expectedOn: "2026-11-28",
      graceUntil: "2026-12-01",
    });
  });

  it("lists the transactions that count, oldest booking first, and the date of the latest", () => {
    const { b, agreements } = contributionHousehold();
    const second = b.income({ date: "2026-11-17", amount: kr(5_000), fundsMonth: "2026-12", agreement: agreements.robin });
    const first = b.income({ date: "2026-11-12", amount: kr(7_000), fundsMonth: "2026-12", agreement: agreements.robin });
    const sameDay = b.income({ date: "2026-11-17", amount: kr(1_000), fundsMonth: "2026-12", agreement: agreements.robin });
    const status = robinIn(b.facts(), agreements.robin, "2026-11-20");
    expect(status.transactionIds).toEqual([first, second, sameDay]);
    expect(status.arrivedOn).toBe("2026-11-17");
    expect(status.arrived).toBe(kr(13_000));
  });

  it("is plain data", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    const statuses = contributionStatuses(b.facts(), localDate("2026-11-16"));
    expect(statuses.some((s) => s.state === "arrived")).toBe(true);
    expect(JSON.parse(JSON.stringify(statuses))).toEqual(statuses);
  });
});

describe("the order of the statuses", () => {
  it("goes by funds month, then the person's name, then the agreement, however the rows are held", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const zed = b.person({ name: "Zed" });
    const amy = b.person({ name: "Amy" });
    const first = b.agreement({ person: zed, amount: kr(1_000) });
    const second = b.agreement({ person: amy, amount: kr(2_000) });
    const third = b.agreement({ person: amy, amount: kr(3_000) });
    const facts = b.facts();
    const reversed: Facts = { ...facts, contributionAgreements: new Map([...facts.contributionAgreements].reverse()), people: new Map([...facts.people].reverse()) };
    for (const held of [facts, reversed]) {
      const december = contributionStatuses(held, localDate("2026-11-10")).filter((s) => s.fundsMonth === "2026-12");
      expect(december.map((s) => s.agreementId)).toEqual([second, third, first]);
    }
  });
});

describe("when the money is expected", () => {
  const expectedOn = (asOf: string) => {
    const { b, agreements } = contributionHousehold();
    return robinIn(b.facts(), agreements.robin, asOf).state;
  };

  it("is expected before the day, on the day and through the third day after it", () => {
    expect(expectedOn("2026-11-01")).toBe("expected");
    expect(expectedOn("2026-11-15")).toBe("expected");
    expect(expectedOn("2026-11-17")).toBe("expected");
    expect(expectedOn("2026-11-18")).toBe("expected");
  });

  it("is overdue from the fourth day after, still with the whole amount to wait for", () => {
    const { b, agreements } = contributionHousehold();
    expect(robinIn(b.facts(), agreements.robin, "2026-11-19")).toMatchObject({ state: "overdue", stillExpected: kr(20_000), arrived: 0 });
    expect(expectedOn("2026-11-30")).toBe("overdue");
  });

  it("is overdue for an earlier month nobody paid", () => {
    const { b, agreements } = contributionHousehold();
    expect(robinIn(b.facts(), agreements.robin, "2026-11-10", "2026-10").state).toBe("overdue");
  });
});

describe("when the money arrives", () => {
  const paid = (date: string, amount = kr(20_000), asOf = "2026-11-25") => {
    const { b, agreements } = contributionHousehold();
    const id = b.income({ date, amount, fundsMonth: "2026-12", agreement: agreements.robin });
    return { status: robinIn(b.facts(), agreements.robin, asOf), id };
  };

  it("has arrived when the whole amount is booked on the day", () => {
    const { status, id } = paid("2026-11-15");
    expect(status).toMatchObject({ state: "arrived", arrived: kr(20_000), stillExpected: 0, transactionIds: [id], arrivedOn: "2026-11-15" });
  });

  it("has arrived when it is booked before the day", () => {
    expect(paid("2026-11-02").status.state).toBe("arrived");
  });

  it("has arrived on the third day after, and is late on the fourth", () => {
    expect(paid("2026-11-18").status.state).toBe("arrived");
    expect(paid("2026-11-19").status).toMatchObject({ state: "late", arrivedOn: "2026-11-19", stillExpected: 0 });
  });

  it("is judged by the day it was booked and not by today", () => {
    expect(paid("2026-11-15", kr(20_000), "2026-12-20").status.state).toBe("arrived");
  });

  it("has arrived with exactly the amount, and with a cent over", () => {
    expect(paid("2026-11-15", kr(20_000)).status).toMatchObject({ state: "arrived", stillExpected: 0 });
    expect(paid("2026-11-15", money(kr(20_000) + 1)).status).toMatchObject({ state: "arrived", stillExpected: 0, arrived: kr(20_000) + 1 });
  });

  it("is short by a cent with a cent under, and still waits for that cent", () => {
    expect(paid("2026-11-15", money(kr(20_000) - 1)).status).toMatchObject({ state: "short", stillExpected: 1 });
  });

  it("is short with a part of the amount, and waits for the rest", () => {
    expect(paid("2026-11-15", kr(8_000)).status).toMatchObject({ state: "short", arrived: kr(8_000), stillExpected: kr(12_000) });
  });

  it("is short even when the part came long ago, and it never turns into overdue", () => {
    expect(paid("2026-11-02", kr(8_000), "2026-12-20").status.state).toBe("short");
  });

  it("arrives in parts when two payments reach the amount", () => {
    const { b, agreements } = contributionHousehold();
    const one = b.income({ date: "2026-11-15", amount: kr(12_000), fundsMonth: "2026-12", agreement: agreements.robin });
    const two = b.income({ date: "2026-11-16", amount: kr(8_000), fundsMonth: "2026-12", agreement: agreements.robin });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-20")).toMatchObject({ state: "parts", stillExpected: 0, transactionIds: [one, two] });
  });

  it("arrives in parts when two payments pass the amount, and when the second came late", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(12_000), fundsMonth: "2026-12", agreement: agreements.robin });
    b.income({ date: "2026-11-28", amount: kr(9_000), fundsMonth: "2026-12", agreement: agreements.robin });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-30").state).toBe("parts");
  });

  it("is short while two payments fall a cent short", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(12_000), fundsMonth: "2026-12", agreement: agreements.robin });
    b.income({ date: "2026-11-16", amount: money(kr(8_000) - 1), fundsMonth: "2026-12", agreement: agreements.robin });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-20")).toMatchObject({ state: "short", stillExpected: 1 });
  });

  it("is in parts rather than arrived when a second payment follows a whole one", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    b.income({ date: "2026-11-16", amount: kr(500), fundsMonth: "2026-12", agreement: agreements.robin });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-20").state).toBe("parts");
  });

  it("takes a linked refund off what has arrived", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    b.income({ date: "2026-11-16", amount: kr(-5_000), fundsMonth: "2026-12", agreement: agreements.robin });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-20")).toMatchObject({ state: "short", arrived: kr(15_000), stillExpected: kr(5_000) });
  });

  it("does not count a payment booked after today", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-20", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-16")).toMatchObject({ state: "expected", arrived: 0, transactionIds: [], arrivedOn: null });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-20").state).toBe("late");
  });

  it("counts the payment whichever account it landed in", () => {
    const { b, agreements, accounts } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin, accountId: accounts.regninger });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-20").state).toBe("arrived");
  });
});

describe("which payments count", () => {
  const stays = (build: (b: ReturnType<typeof contributionHousehold>) => void) => {
    const household = contributionHousehold();
    build(household);
    return robinIn(household.b.facts(), household.agreements.robin, "2026-11-25");
  };

  it("counts a payment for the next month toward the next month only", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2027-01", agreement: agreements.robin });
    const facts = b.facts();
    expect(robinIn(facts, agreements.robin, "2026-11-25").state).toBe("overdue");
    expect(robinIn(facts, agreements.robin, "2026-12-25", "2027-01").state).toBe("arrived");
  });

  it("counts a payment for an earlier month toward that month only", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-10-15", amount: kr(20_000), fundsMonth: "2026-11", agreement: agreements.robin });
    const facts = b.facts();
    expect(robinIn(facts, agreements.robin, "2026-11-25", "2026-11").state).toBe("arrived");
    expect(robinIn(facts, agreements.robin, "2026-11-25", "2026-12").state).toBe("overdue");
  });

  it("does not match a contribution that names no agreement", () => {
    expect(stays(({ b }) => b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12" }))).toMatchObject({ state: "overdue", arrived: 0, transactionIds: [] });
  });

  it("does not match a payment that names another person's agreement", () => {
    expect(stays(({ b, agreements }) => b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.sam }))).toMatchObject({ state: "overdue", arrived: 0 });
  });

  it("counts only income that is a contribution", () => {
    expect(stays(({ b, agreements }) => b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin, source: "recurring" }))).toMatchObject({ state: "overdue", arrived: 0 });
    expect(stays(({ b, agreements }) => b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin, source: "other" }))).toMatchObject({ state: "overdue", arrived: 0 });
  });

  it("ignores transactions that are not income, whatever they are linked to", () => {
    const { b, agreements, accounts } = contributionHousehold();
    b.needsYou({ date: "2026-11-15", amount: kr(20_000), accountId: accounts.everyday });
    b.transfer({ from: accounts.regninger, to: accounts.everyday, date: "2026-11-15", amount: kr(20_000) });
    expect(robinIn(b.facts(), agreements.robin, "2026-11-25")).toMatchObject({ state: "overdue", arrived: 0 });
  });

  it("does not move a payment that arrived for another agreement of the same person", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    const person = b.person({ name: "Robin" });
    const old = b.agreement({ person, amount: kr(18_000), to: "2026-11" });
    const current = b.agreement({ person, amount: kr(20_000), from: "2026-12" });
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: old });
    const facts = b.facts();
    expect(robinIn(facts, current, "2026-11-25")).toMatchObject({ state: "overdue", arrived: 0 });
  });
});

describe("expected income", () => {
  it("has a month from the current month to the horizon, twelve months on by default", () => {
    const { b } = contributionHousehold();
    const months = expectedIncome(b.facts(), localDate("2026-11-10")).map((m) => m.month);
    expect(months[0]).toBe("2026-11");
    expect(months).toHaveLength(13);
    expect(months.at(-1)).toBe("2027-11");
    expect(expectedIncome(b.facts(), localDate("2026-11-10"), 3).map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(expectedIncome(b.facts(), localDate("2026-11-10"), 0).map((m) => m.month)).toEqual(["2026-11"]);
  });

  it("is each agreement's whole amount while nothing has arrived, for this month and every month ahead", () => {
    const { b, agreements } = contributionHousehold();
    const months = expectedIncome(b.facts(), localDate("2026-11-10"));
    expect(months.map((m) => m.amount)).toEqual(months.map(() => kr(30_000)));
    expect(months[0]?.contributions.map((c) => [c.agreementId, c.stillExpected])).toEqual([
      [agreements.robin, kr(20_000)],
      [agreements.sam, kr(10_000)],
    ]);
  });

  const states: readonly (readonly [string, readonly (readonly [string, number])[], string, number])[] = [
    ["expected", [], "2026-11-10", kr(20_000)],
    ["overdue", [], "2026-11-25", kr(20_000)],
    ["short", [["2026-11-15", kr(8_000)]], "2026-11-25", kr(12_000)],
    ["short by a cent", [["2026-11-15", kr(20_000) - 1]], "2026-11-25", 1],
    ["arrived", [["2026-11-15", kr(20_000)]], "2026-11-25", 0],
    ["a cent over", [["2026-11-15", kr(20_000) + 1]], "2026-11-25", 0],
    ["late", [["2026-11-19", kr(20_000)]], "2026-11-25", 0],
    ["in parts", [["2026-11-15", kr(12_000)], ["2026-11-16", kr(8_000)]], "2026-11-25", 0],
    ["booked after today", [["2026-11-20", kr(20_000)]], "2026-11-16", kr(20_000)],
  ];
  it.each(states)("waits for the rest of Robin's December money when it is %s", (_name, payments, asOf, rest) => {
    const { b, agreements } = contributionHousehold();
    for (const [date, amount] of payments) b.income({ date, amount: money(amount), fundsMonth: "2026-12", agreement: agreements.robin });
    const december = expectedIncome(b.facts(), localDate(asOf)).find((m) => m.month === "2026-12");
    const robin = december?.contributions.find((c) => c.agreementId === agreements.robin);
    expect(robin?.stillExpected ?? 0).toBe(rest);
    expect(december?.amount).toBe(rest + kr(10_000));
  });

  it("waits for nothing from an agreement that has ended, in the months after its last", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    b.agreement({ amount: kr(20_000), to: "2026-12" });
    const months = expectedIncome(b.facts(), localDate("2026-11-10"));
    expect(months.slice(0, 2).map((m) => m.amount)).toEqual([kr(20_000), kr(20_000)]);
    expect(months.slice(2).map((m) => m.amount)).toEqual(months.slice(2).map(() => 0));
    expect(months.slice(2).every((m) => m.contributions.length === 0)).toBe(true);
  });

  it("waits for nothing from an agreement before its first month", () => {
    const b = factsBuilder({ planStart: "2026-01" });
    b.agreement({ amount: kr(20_000), from: "2027-02" });
    const months = expectedIncome(b.facts(), localDate("2026-11-10"));
    expect(months.filter((m) => m.amount > 0).map((m) => m.month)).toEqual(["2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11"]);
  });

  it("lets a payment for the next month leave this month still expected", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    const months = expectedIncome(b.facts(), localDate("2026-11-20"));
    expect(months.find((m) => m.month === "2026-11")?.amount).toBe(kr(30_000));
    expect(months.find((m) => m.month === "2026-12")?.amount).toBe(kr(10_000));
    expect(months.find((m) => m.month === "2027-01")?.amount).toBe(kr(30_000));
  });

  it("does not shrink when a contribution names no agreement", () => {
    const { b } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12" });
    expect(expectedIncome(b.facts(), localDate("2026-11-20")).find((m) => m.month === "2026-12")?.amount).toBe(kr(30_000));
  });
});

describe("money in", () => {
  it("keeps what arrived apart from what is expected, and adds them", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    const december = moneyIn(b.facts(), localDate("2026-11-20")).find((m) => m.month === "2026-12");
    expect(december).toEqual({ month: "2026-12", actual: kr(20_000), expected: kr(10_000), total: kr(30_000) });
  });

  it("counts income of every source in what arrived", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    b.income({ date: "2026-11-16", amount: kr(1_500), fundsMonth: "2026-12", source: "recurring" });
    b.income({ date: "2026-11-17", amount: kr(300), fundsMonth: "2026-12", source: "other" });
    expect(moneyIn(b.facts(), localDate("2026-11-20")).find((m) => m.month === "2026-12")).toMatchObject({ actual: kr(21_800), expected: kr(10_000), total: kr(31_800) });
  });

  it("counts a contribution nobody linked as arrived and still waits for the agreement's money", () => {
    const { b } = contributionHousehold();
    b.income({ date: "2026-11-15", amount: kr(20_000), fundsMonth: "2026-12" });
    expect(moneyIn(b.facts(), localDate("2026-11-20")).find((m) => m.month === "2026-12")).toMatchObject({ actual: kr(20_000), expected: kr(30_000) });
  });

  it("leaves out income booked after today and income for other months", () => {
    const { b, agreements } = contributionHousehold();
    b.income({ date: "2026-11-25", amount: kr(20_000), fundsMonth: "2026-12", agreement: agreements.robin });
    b.income({ date: "2026-10-15", amount: kr(20_000), fundsMonth: "2026-11", agreement: agreements.robin });
    const months = moneyIn(b.facts(), localDate("2026-11-20"));
    expect(months.find((m) => m.month === "2026-12")).toMatchObject({ actual: 0, expected: kr(30_000) });
    expect(months.find((m) => m.month === "2026-11")).toMatchObject({ actual: kr(20_000), expected: kr(10_000) });
  });

  it("covers the same months as expected income", () => {
    const { b } = contributionHousehold();
    const facts = b.facts();
    const asOf = localDate("2026-11-20");
    expect(moneyIn(facts, asOf, 5).map((m) => m.month)).toEqual(expectedIncome(facts, asOf, 5).map((m) => m.month));
  });
});
