import { type ContributionState, type ContributionStatus, type Month, contributionStatuses, localDate, month } from "@holt/core";
import { kr } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { type StatusLine, adultsOf, captionWords, endsWords, expectedOn, laterWords, moneyInView, nextWords, sharedAccountsOf, statusLine, statusWords } from "./MoneyIn.model.ts";
import { moneyWorld, today } from "./MoneyIn.world.ts";

describe("the person rows", () => {
  const world = moneyWorld();
  const view = moneyInView(world.facts, world.figures);

  it("lists each person who pays this funds month, in the order they joined the household, with the agreed amount", () => {
    expect(view?.month).toBe("2026-11");
    expect(view?.rows.map((row) => [row.name, row.amount])).toEqual([
      ["Stephen", kr(32_000)],
      ["Partner", kr(28_000)],
    ]);
  });

  it("says what arrived, when, and how: one payment on the day, and a payment in two parts", () => {
    expect(view?.rows[0]?.status).toEqual({ kind: "arrived", on: "2026-10-20" });
    expect(view?.rows[1]?.status).toEqual({ kind: "parts" });
  });

  it("names the next payday as the day of this month, because next month's money is still expected", () => {
    expect(view?.rows.map((row) => row.next)).toEqual([
      { kind: "next", on: "2026-11-20" },
      { kind: "next", on: "2026-11-20" },
    ]);
  });

  it("keeps what arrived apart from what is still expected", () => {
    expect(view?.inThisMonth).toEqual({ actual: kr(60_000), expected: kr(0) });
    const missing = moneyWorld(() => undefined, { noNovemberPayments: true });
    expect(moneyInView(missing.facts, missing.figures)?.inThisMonth).toEqual({ actual: kr(0), expected: kr(60_000) });
    const half = moneyWorld(({ b, agreements }) => {
      b.income({ date: "2026-10-20", amount: kr(32_000), fundsMonth: "2026-11", agreement: agreements.stephen });
    }, { noNovemberPayments: true });
    expect(moneyInView(half.facts, half.figures)?.inThisMonth).toEqual({ actual: kr(32_000), expected: kr(28_000) });
  });

  it("has no rows for a household with no agreements, and no view before the plan has a month to show", () => {
    const bare = moneyWorld(() => undefined);
    const noAgreements = { ...bare.facts, contributionAgreements: new Map() };
    expect(moneyInView(noAgreements, bare.figures)?.rows).toEqual([]);
  });

  it("lists a person once however many agreements they have had", () => {
    const changed = moneyWorld(({ b, accounts, people }) => {
      b.agreement({ person: people.stephen, accountId: accounts.everyday, amount: kr(34_000), day: 20, from: "2026-12" });
    });
    const rows = moneyInView(changed.facts, changed.figures)?.rows ?? [];
    expect(rows.map((row) => row.name)).toEqual(["Stephen", "Partner"]);
    expect(rows[0]?.amount).toBe(kr(32_000));
    expect(rows[0]?.later).toEqual({ agreementId: expect.any(String), from: "2026-12", amount: kr(34_000) });
    expect(rows[0] && laterWords(rows[0].later as NonNullable<typeof rows[0]["later"]>)).toEqual({ id: "plan.money.laterChange", values: { month: { month: "2026-12" }, amount: { money: kr(34_000) } } });
  });

  it("shows the agreement that runs this month and the next payday from the one that funds next month", () => {
    const changed = moneyWorld(({ b, accounts, people }) => {
      b.agreement({ person: people.partner, accountId: accounts.everyday, amount: kr(30_000), day: 25, from: "2026-12" });
    });
    const partner = moneyInView(changed.facts, changed.figures)?.rows.find((row) => row.name === "Partner");
    expect(partner?.amount).toBe(kr(28_000));
    expect(partner?.next).toEqual({ kind: "next", on: "2026-11-25" });
  });

  it("says when a contribution ends, unless a new one follows straight on", () => {
    const ending = moneyWorld(({ b, accounts, people }) => {
      b.agreement({ person: people.eldest, accountId: accounts.everyday, amount: kr(100), day: 5, from: "2026-11", to: "2027-02" });
    });
    const eldest = moneyInView(ending.facts, ending.figures)?.rows.find((row) => row.name === "Eldest");
    expect(eldest?.endsAfter).toBe("2027-02");
    expect(eldest && endsWords(eldest.endsAfter as Month)).toEqual({ id: "plan.money.endsAfter", values: { month: { month: "2027-02" } } });
  });

  it("shows a contribution that starts later as starting then, with no status yet", () => {
    const future = moneyWorld(({ b, accounts, people }) => {
      b.agreement({ person: people.eldest, accountId: accounts.everyday, amount: kr(100), day: 5, from: "2027-01" });
    });
    const eldest = moneyInView(future.facts, future.figures)?.rows.find((row) => row.name === "Eldest");
    expect(eldest).toMatchObject({ status: null, startsIn: "2027-01", next: { kind: "next", on: "2026-12-05" } });
    expect(eldest && captionWords(eldest)).toEqual({ id: "plan.money.row.caption", values: { status: { id: "plan.money.status.starts", values: { month: { month: "2027-01" } } } } });
  });

  it("leaves out a person whose last agreement has ended", () => {
    const over = moneyWorld(({ b, accounts, people }) => {
      b.agreement({ person: people.eldest, accountId: accounts.everyday, amount: kr(100), day: 5, from: "2026-10", to: "2026-10" });
    });
    expect(moneyInView(over.facts, over.figures)?.rows.map((row) => row.name)).toEqual(["Stephen", "Partner"]);
  });
});

describe("what core's states become", () => {
  const status = (state: ContributionState, extra: Partial<ContributionStatus> = {}): ContributionStatus => {
    const world = moneyWorld();
    const [base] = contributionStatuses(world.facts, today);
    if (base === undefined) throw new Error("no status");
    return { ...base, state, ...extra };
  };

  const lines: Record<ContributionState, ContributionStatus> = {
    arrived: status("arrived", { arrivedOn: localDate("2026-10-20") }),
    late: status("late", { arrivedOn: localDate("2026-10-27") }),
    parts: status("parts"),
    short: status("short", { stillExpected: kr(22_000) }),
    overdue: status("overdue", { expectedOn: localDate("2026-10-20") }),
    expected: status("expected", { expectedOn: localDate("2026-11-20") }),
  };

  it("gives each state its own line, so short never reads as arrived", () => {
    const kinds = Object.fromEntries(Object.entries(lines).map(([state, s]) => [state, statusLine(s).kind]));
    expect(kinds).toEqual({ arrived: "arrived", late: "late", parts: "parts", short: "short", overdue: "overdue", expected: "expected" });
  });

  it("carries what the words need: the date it arrived, how much is missing, or the day it was expected", () => {
    expect(statusLine(lines.arrived)).toEqual({ kind: "arrived", on: "2026-10-20" });
    expect(statusLine(lines.late)).toEqual({ kind: "late", on: "2026-10-27" });
    expect(statusLine(lines.short)).toEqual({ kind: "short", missing: kr(22_000) });
    expect(statusLine(lines.overdue)).toEqual({ kind: "overdue", since: "2026-10-20" });
    expect(statusLine(lines.expected)).toEqual({ kind: "expected", on: "2026-11-20" });
  });

  it("uses neutral words in the right message for each line", () => {
    const words = (line: StatusLine) => statusWords(line);
    expect(words({ kind: "arrived", on: localDate("2026-10-20") })).toEqual({ id: "plan.money.status.arrived", values: { date: { day: "2026-10-20" } } });
    expect(words({ kind: "arrived", on: null })).toEqual({ id: "plan.money.status.arrivedNoDate" });
    expect(words({ kind: "late", on: localDate("2026-10-27") })).toEqual({ id: "plan.money.status.late", values: { date: { day: "2026-10-27" } } });
    expect(words({ kind: "late", on: null })).toEqual({ id: "plan.money.status.lateNoDate" });
    expect(words({ kind: "parts" })).toEqual({ id: "plan.money.status.parts" });
    expect(words({ kind: "short", missing: kr(22_000) })).toEqual({ id: "plan.money.status.short", values: { amount: { money: kr(22_000) } } });
    expect(words({ kind: "overdue", since: localDate("2026-10-20") })).toEqual({ id: "plan.money.status.overdue", values: { date: { day: "2026-10-20" } } });
    expect(words({ kind: "expected", on: localDate("2026-11-20") })).toEqual({ id: "plan.money.status.expected", values: { date: { day: "2026-11-20" } } });
  });

  it("reads the statuses core gives on a real household: short, late and not arrived yet", () => {
    const short = moneyWorld(({ b, agreements }) => {
      b.income({ date: "2026-10-20", amount: kr(10_000), fundsMonth: "2026-11", agreement: agreements.stephen });
    }, { noNovemberPayments: true });
    expect(moneyInView(short.facts, short.figures)?.rows[0]?.status).toEqual({ kind: "short", missing: kr(22_000) });

    const late = moneyWorld(({ b, agreements }) => {
      b.income({ date: "2026-10-27", amount: kr(32_000), fundsMonth: "2026-11", agreement: agreements.stephen });
    }, { noNovemberPayments: true });
    expect(moneyInView(late.facts, late.figures)?.rows[0]?.status).toEqual({ kind: "late", on: "2026-10-27" });

    const missing = moneyWorld(() => undefined, { noNovemberPayments: true });
    expect(moneyInView(missing.facts, missing.figures)?.rows[0]?.status).toEqual({ kind: "overdue", since: "2026-10-20" });
  });

  it("says the next payday, or what next month's money has done already", () => {
    expect(nextWords({ kind: "next", on: localDate("2026-11-20") })).toEqual({ id: "plan.money.next", values: { date: { day: "2026-11-20" } } });
    expect(nextWords({ kind: "later", month: month("2026-12"), line: { kind: "parts" } })).toEqual({
      id: "plan.money.nextMonth",
      values: { month: { month: "2026-12" }, status: { id: "plan.money.status.parts" } },
    });
    const early = moneyWorld(({ b, agreements }) => {
      b.income({ date: "2026-11-05", amount: kr(32_000), fundsMonth: "2026-12", agreement: agreements.stephen });
    });
    expect(moneyInView(early.facts, early.figures)?.rows[0]?.next).toEqual({ kind: "later", month: "2026-12", line: { kind: "arrived", on: "2026-11-05" } });
  });

  it("works out the day core calls expected from the day and the month the money funds", () => {
    expect(expectedOn(20, month("2026-11"))).toBe("2026-10-20");
    expect(expectedOn(5, month("2027-01"))).toBe("2026-12-05");
    const world = moneyWorld();
    for (const s of contributionStatuses(world.facts, today)) {
      const day = world.facts.contributionAgreements.get(s.agreementId)?.day ?? 0;
      expect(expectedOn(day, s.fundsMonth)).toBe(s.expectedOn);
    }
  });
});

describe("the choices the dialogs offer", () => {
  const world = moneyWorld();

  it("names the adults in the order they joined, leaving out the children", () => {
    expect(adultsOf(world.facts).map((adult) => adult.name)).toEqual(["Stephen", "Partner"]);
  });

  it("names the shared accounts only, in the order they were made", () => {
    expect(sharedAccountsOf(world.facts).map((account) => account.name)).toEqual(["Everyday", "Bills", "Deposit"]);
    const kids = moneyWorld(({ b }) => {
      b.account({ name: "Eldest's savings", scope: "paidInto" });
    });
    expect(sharedAccountsOf(kids.facts).map((account) => account.name)).toEqual(["Everyday", "Bills", "Deposit"]);
  });
});
