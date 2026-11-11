import { describe, expect, it } from "vitest";
import { apply } from "../commands/apply.ts";
import { fundingCommands, fundingOptions } from "../funding.ts";
import { localDate, month } from "../dates.ts";
import type { Facts, Job } from "../facts.ts";
import { jobId } from "../ids.ts";
import { money } from "../money.ts";
import { accepted } from "../testing/command-household.ts";
import { factsBuilder, kr, setAmount, testId } from "../testing/facts-builder.ts";
import { planHousehold, planMonth, planToday } from "../testing/plan-household.ts";
import { movesPlan } from "./moves-plan.ts";

const november = month("2026-11");
const today = localDate("2026-11-09");

describe("the moves at the bank, in the mockup's November", () => {
  const { facts, accounts, jobs, groups } = planHousehold();

  it("pairs the account the money lands in with each account that needs it, largest first, and leaves the 228 kr with no job where it is", () => {
    const plan = movesPlan(facts, november, planToday);
    expect(plan.monthly).toEqual([
      { kind: "monthly", from: accounts.felles, to: accounts.regning, amount: kr(38_620), status: { kind: "toDo" } },
      { kind: "monthly", from: accounts.felles, to: accounts.buffer, amount: kr(5_700), status: { kind: "toDo" } },
      { kind: "monthly", from: accounts.felles, to: accounts.byggesparing, amount: kr(4_500), status: { kind: "toDo" } },
    ]);
    expect(plan.unmoved).toEqual([{ accountId: accounts.felles, kind: "surplus", amount: kr(228) }]);
    expect(plan.oneOff).toEqual([]);
  });

  it("leaves nothing unmoved once every krone has a job: the new job's money lands where its bucket sits", () => {
    const holidays = jobId(testId(900_001));
    const job: Job = {
      id: holidays,
      name: "Holidays",
      groupId: groups.living,
      status: "active",
      accountId: accounts.buffer,
      essential: false,
      opening: money(0),
      kind: "saveUp",
      role: "ordinary",
      target: { kind: "amountByMonth", amount: kr(21_000), readyBy: month("2027-06") },
    };
    const [split] = fundingOptions(facts, { month: november, amount: kr(3_000), exclude: [jobs.clothes] }, planToday).options;
    if (split === undefined) throw new Error("expected a split");
    const after = accepted(apply(facts, { kind: "batch", commands: [{ kind: "addJob", job }, ...fundingCommands(split, holidays, november)] }, { asOf: planToday }));
    const plan = movesPlan(after, november, planToday);
    expect(plan.monthly.map((m) => [m.to, m.amount])).toEqual([
      [accounts.regning, kr(38_620)],
      [accounts.buffer, kr(7_314)],
      [accounts.byggesparing, kr(3_114)],
    ]);
    expect(plan.unmoved).toEqual([]);
  });

  it("is empty for a month with nothing to move, and for a month outside the plan", () => {
    expect(movesPlan(facts, month("2026-10"), planToday)).toEqual({ month: "2026-10", monthly: [], oneOff: [], unmoved: [] });
    expect(movesPlan(facts, month("2019-03"), planToday)).toEqual({ month: "2019-03", monthly: [], oneOff: [], unmoved: [] });
  });
});

/** Account A receives 1,000 kr and B receives 400, and C, D and E need 600, 600 and 200 assigned. */
function fiveAccounts() {
  const b = factsBuilder({ planStart: "2026-10" });
  const ids = { a: b.account({ name: "A" }), b: b.account({ name: "B" }), c: b.account({ name: "C" }), d: b.account({ name: "D" }), e: b.account({ name: "E" }) };
  b.group();
  b.buffer({ monthly: kr(0) });
  b.budgetMonth("2026-10", "closed");
  b.budgetMonth("2026-11", "open");
  const needs = { c: kr(600), d: kr(600), e: kr(200) };
  const jobs = { c: b.spendJob({ plan: setAmount(needs.c), accountId: ids.c }), d: b.spendJob({ plan: setAmount(needs.d), accountId: ids.d }), e: b.spendJob({ plan: setAmount(needs.e), accountId: ids.e }) };
  for (const key of ["c", "d", "e"] as const) b.assign("2026-11", jobs[key], needs[key]);
  b.income({ date: "2026-10-20", amount: kr(1_000), fundsMonth: "2026-11", accountId: ids.a });
  b.income({ date: "2026-10-20", amount: kr(400), fundsMonth: "2026-11", accountId: ids.b });
  return { b, ids, jobs };
}

describe("pairing, largest first", () => {
  it("meets the biggest surplus with the biggest need, then the next, a tie going to the account made first", () => {
    const { b, ids } = fiveAccounts();
    const plan = movesPlan(b.facts(), november, today);
    expect(plan.monthly.map((m) => [m.from, m.to, m.amount])).toEqual([
      [ids.a, ids.c, kr(600)],
      [ids.a, ids.d, kr(400)],
      [ids.b, ids.d, kr(200)],
      [ids.b, ids.e, kr(200)],
    ]);
    expect(plan.unmoved).toEqual([]);
  });

  it("gives the same moves however the rows are held", () => {
    const { b } = fiveAccounts();
    const facts = b.facts();
    const reversed: Facts = { ...facts, accounts: new Map([...facts.accounts].reverse()), jobs: new Map([...facts.jobs].reverse()), transactions: new Map([...facts.transactions].reverse()) };
    expect(movesPlan(reversed, november, today)).toEqual(movesPlan(facts, november, today));
  });

  it("leaves what no account can take: a surplus with no need, or a need with no surplus", () => {
    const { b, ids } = fiveAccounts();
    b.income({ date: "2026-10-21", amount: kr(300), fundsMonth: "2026-11", accountId: ids.a });
    expect(movesPlan(b.facts(), november, today).unmoved).toEqual([{ accountId: ids.b, kind: "surplus", amount: kr(300) }]);
    const short = fiveAccounts();
    short.b.assign("2026-11", short.jobs.c, kr(800));
    expect(movesPlan(short.b.facts(), november, today).unmoved).toEqual([{ accountId: short.ids.e, kind: "moveIn", amount: kr(200) }]);
  });
});

describe("whether a monthly move is done", () => {
  /** Felles to Regning is the first monthly move, 38,620 kr. */
  const run = (add: (b: ReturnType<typeof planHousehold>["b"], accounts: ReturnType<typeof planHousehold>["accounts"]) => void, asOf = planToday) => {
    const household = planHousehold();
    add(household.b, household.accounts);
    const plan = movesPlan(household.b.facts(), november, asOf);
    return { plan, accounts: household.accounts, first: plan.monthly[0]?.status };
  };

  it("is to do while no imported transfer covers any of it", () => {
    expect(run(() => {}).first).toEqual({ kind: "toDo" });
  });

  it("is done when transfers between the two accounts in the window cover it, even from more than one", () => {
    expect(run((b, a) => b.transfer({ from: a.felles, to: a.regning, date: "2026-10-21", amount: kr(38_620) })).first).toEqual({ kind: "done" });
    expect(
      run((b, a) => {
        b.transfer({ from: a.felles, to: a.regning, date: "2026-10-21", amount: kr(20_000) });
        b.transfer({ from: a.felles, to: a.regning, date: "2026-11-02", amount: kr(18_620) });
      }).first,
    ).toEqual({ kind: "done" });
    expect(run((b, a) => b.transfer({ from: a.felles, to: a.regning, date: "2026-10-21", amount: kr(40_000) })).first).toEqual({ kind: "done" });
  });

  it("is partly done, with the amount done, when they cover some of it", () => {
    expect(run((b, a) => b.transfer({ from: a.felles, to: a.regning, date: "2026-10-21", amount: kr(20_000) })).first).toEqual({ kind: "partlyDone", done: kr(20_000) });
    expect(run((b, a) => b.transfer({ from: a.felles, to: a.regning, date: "2026-10-21", amount: kr(38_619) })).first).toEqual({ kind: "partlyDone", done: kr(38_619) });
  });

  it("looks from the 15th of the month before, and not before it", () => {
    const at = (date: string, asOf = localDate("2026-11-30")) => run((b, a) => b.transfer({ from: a.felles, to: a.regning, date, amount: kr(38_620) }), asOf).first;
    expect(at("2026-10-15")).toEqual({ kind: "done" });
    expect(at("2026-10-14")).toEqual({ kind: "toDo" });
  });

  it("looks to the end of the month, and not past it", () => {
    const at = (date: string) => run((b, a) => b.transfer({ from: a.felles, to: a.regning, date, amount: kr(38_620) }), localDate("2026-12-15")).first;
    expect(at("2026-11-30")).toEqual({ kind: "done" });
    expect(at("2026-12-01")).toEqual({ kind: "toDo" });
  });

  it("does not count a transfer booked after today", () => {
    expect(run((b, a) => b.transfer({ from: a.felles, to: a.regning, date: "2026-11-12", amount: kr(38_620) })).first).toEqual({ kind: "toDo" });
  });

  it("counts only transfers between these two accounts, in this direction, that are a pair", () => {
    expect(run((b, a) => b.transfer({ from: a.regning, to: a.felles, date: "2026-10-21", amount: kr(38_620) })).first).toEqual({ kind: "toDo" });
    expect(run((b, a) => b.transfer({ from: a.felles, to: a.buffer, date: "2026-10-21", amount: kr(38_620) })).first).toEqual({ kind: "toDo" });
    expect(run((b, a) => void b.unmatchedTransfer({ date: "2026-10-21", amount: kr(-38_620), accountId: a.felles })).first).toEqual({ kind: "toDo" });
  });

  it("keeps each move to its own accounts: a transfer into Buffer does not make the move to Regning done", () => {
    const { plan } = run((b, a) => b.transfer({ from: a.felles, to: a.buffer, date: "2026-10-21", amount: kr(5_700) }));
    expect(plan.monthly.map((m) => m.status.kind)).toEqual(["toDo", "done", "toDo"]);
  });

  it("does not count a transfer that completed a one-off move, which is that move's", () => {
    const household = planHousehold();
    const { b, accounts } = household;
    const [out] = b.transfer({ from: accounts.felles, to: accounts.regning, date: "2026-10-21", amount: kr(4_000) });
    const oneOff = b.move({ from: accounts.felles, to: accounts.regning, amount: kr(4_000), month: "2026-11" });
    const base = b.facts();
    const move = base.moves.get(oneOff);
    if (move === undefined) throw new Error("expected the move");
    const facts: Facts = { ...base, moves: new Map([[oneOff, { ...move, status: "done", completedBy: out }]]) };
    const plan = movesPlan(facts, november, planToday);
    expect(plan.monthly[0]?.status).toEqual({ kind: "toDo" });
    expect(plan.oneOff).toEqual([{ kind: "oneOff", move: { ...move, status: "done", completedBy: out }, status: { kind: "done" } }]);
    expect(movesPlan(base, november, planToday).monthly[0]?.status).toEqual({ kind: "partlyDone", done: kr(4_000) });
  });
});

describe("the one-off moves of the month", () => {
  it("lists only this month's, in the order they were made, with the status stored", () => {
    const { b, accounts } = planHousehold();
    const todo = b.move({ from: accounts.felles, to: accounts.buffer, amount: kr(1_000), month: "2026-11" });
    const done = b.move({ from: accounts.regning, to: accounts.buffer, amount: kr(2_000), month: "2026-11", status: "done" });
    const skipped = b.move({ from: accounts.felles, to: accounts.byggesparing, amount: kr(3_000), month: "2026-11", status: "skipped" });
    b.move({ from: accounts.felles, to: accounts.buffer, amount: kr(9_000), month: "2026-12" });
    const plan = movesPlan(b.facts(), november, planToday);
    expect(plan.oneOff.map((o) => [o.move.id, o.status.kind])).toEqual([
      [todo, "toDo"],
      [done, "done"],
      [skipped, "skipped"],
    ]);
    expect(plan.oneOff.every((o) => o.kind === "oneOff")).toBe(true);
  });
});
