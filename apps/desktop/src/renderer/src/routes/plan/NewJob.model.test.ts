import { type Facts, accountId, apply, computeFigures, groupId, jobId, month } from "@holt/core";
import { NOK, factsBuilder, kr } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Draft,
  type NewJobContext,
  type Start,
  accountNameOf,
  amountOf,
  chosenFunding,
  contextOf,
  defaultGroup,
  defaultPaidFrom,
  fundingKey,
  fundingOf,
  kindForGroup,
  monthOfText,
  readDraft,
  reachOf,
  sitsOptions,
  startingDraft,
} from "./NewJob.model.ts";
import { planMonthOf } from "./PlanMonth.model.ts";
import { assignedInNovember, buildWorld, today } from "./PlanTestWorld.ts";

const world = buildWorld({ income: assignedInNovember + 228 });
const shown = planMonthOf(world.facts, world.figures);
if (shown === null) throw new Error("The test household has a month");
const context: NewJobContext = contextOf(world.facts, world.figures, shown, NOK);
const start = (options: Start = {}): Draft => startingDraft(world.facts, world.figures, today, options);

const spend = (over: Partial<Draft> = {}): Draft => ({ ...start({ kind: "spend" }), name: "Swimming lessons", amount: "800", ...over });
const saveUp = (over: Partial<Draft> = {}): Draft => ({ ...start({ kind: "saveUp" }), name: "Holidays 2", target: "21000", readyBy: "2027-06", ...over });
const payInto = (over: Partial<Draft> = {}): Draft => ({ ...start({ kind: "payInto" }), name: "Youngest", amount: "500", ...over });

const problemsOf = (draft: Draft, where: NewJobContext = context): string[] => {
  const read = readDraft(draft, where);
  return read.ok ? [] : read.problems.map((p) => `${p.field}:${p.code}`);
};

describe("a typed amount", () => {
  it("is money in minor units, whatever separators the family types", () => {
    expect(amountOf("2625", NOK)).toEqual({ ok: true, amount: kr(2_625) });
    expect(amountOf("1 234,50", NOK)).toEqual({ ok: true, amount: 123_450 });
    expect(amountOf("1,234.50", NOK)).toEqual({ ok: true, amount: 123_450 });
  });

  it("is refused in words that tell a missing amount from a zero one", () => {
    expect(amountOf("", NOK)).toEqual({ ok: false, code: "notAnAmount" });
    expect(amountOf("lots", NOK)).toEqual({ ok: false, code: "notAnAmount" });
    expect(amountOf("0", NOK)).toEqual({ ok: false, code: "notAbove" });
    expect(amountOf("-5", NOK)).toEqual({ ok: false, code: "notAbove" });
  });
});

describe("where the form starts", () => {
  it("opens on a save-up job in the first group that counts towards the savings rate", () => {
    const draft = start();
    expect(draft.kind).toBe("saveUp");
    expect(draft.group).toEqual({ kind: "existing", groupId: world.groups.saving });
  });

  it("starts a line added under a group on the kind of job most of that group is", () => {
    expect(kindForGroup(world.facts, world.groups.fixed)).toBe("spend");
    expect(kindForGroup(world.facts, world.groups.living)).toBe("saveUp");
    expect(kindForGroup(world.facts, world.groups.children)).toBe("payInto");
    expect(start({ groupId: world.groups.fixed })).toMatchObject({ kind: "spend", group: { kind: "existing", groupId: world.groups.fixed } });
  });

  it("starts a group with no active jobs on a spend job", () => {
    const empty = factsBuilder({ planStart: "2026-11" });
    const account = empty.account({ name: "Everyday" });
    const group = empty.group({ name: "Nothing yet" });
    empty.spendJob({ name: "Paused", groupId: group, accountId: account, status: "paused", plan: { mode: "setAmount", amount: kr(100) } });
    expect(kindForGroup(empty.facts(), group)).toBe("spend");
  });

  it("puts a spend job in a group that does not count towards the savings rate, and saving in one that does", () => {
    expect(defaultGroup(world.facts, "spend")).toBe(world.groups.fixed);
    expect(defaultGroup(world.facts, "saveUp")).toBe(world.groups.saving);
    expect(defaultGroup(world.facts, "payInto")).toBe(world.groups.saving);
  });

  it("chooses the account the adults pay into for the bills, and the first shared account when nobody pays in", () => {
    expect(defaultPaidFrom(world.facts)).toBe(world.accounts.everyday);
    const b = factsBuilder({ planStart: "2026-11" });
    const first = b.account({ name: "First" });
    const second = b.account({ name: "Second" });
    const person = b.person({ name: "Adult" });
    expect(defaultPaidFrom(b.facts())).toBe(first);
    b.agreement({ person, accountId: second, amount: kr(10_000), day: 20 });
    expect(defaultPaidFrom(b.facts())).toBe(second);
  });

  it("opens a pay-into job on the first account the household pays into, or on a new one when asked or when there is none", () => {
    expect(start({ kind: "payInto" }).payInto).toEqual({ kind: "existing", accountId: world.accounts.kids });
    expect(start({ kind: "payInto", newAccount: true }).payInto.kind).toBe("new");
    const b = factsBuilder({ planStart: "2026-11" });
    b.account({ name: "Everyday" });
    b.group({ name: "Saving" });
    expect(startingDraft(b.facts(), computeFigures(b.facts(), today), today, { kind: "payInto" }).payInto.kind).toBe("new");
  });

  it("starts a new account on today's date so the family types only the balance", () => {
    const draft = start({ kind: "payInto", newAccount: true });
    if (draft.payInto.kind !== "new") throw new Error("Expected a new account");
    expect(draft.payInto.account).toEqual({ name: "", bank: "", balance: "", date: today, importStatements: false, number: "" });
  });
});

describe("where the money can sit", () => {
  it("offers the buffer's account first, next to the two largest other buckets, and every other shared account after it", () => {
    const options = sitsOptions(world.facts, world.figures);
    const buckets = world.figures.accounts.get(world.accounts.savings)?.buckets ?? [];
    const expected = buckets
      .filter((bucket) => bucket.jobId !== world.jobs.buffer)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 2)
      .map((bucket) => world.facts.jobs.get(bucket.jobId)?.name);
    expect(options.preferred).toEqual({ accountId: world.accounts.savings, name: "Deposit", neighbours: expected });
    expect(expected).toHaveLength(2);
    expect(options.others).toEqual([{ id: world.accounts.everyday, name: "Everyday" }]);
  });

  it("starts a household with no buffer on the account with most buckets, and one with no shared account on an account of its own", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    const group = b.group({ name: "Saving" });
    const few = b.account({ name: "Few" });
    const many = b.account({ name: "Many" });
    b.saveUpJob({ name: "A", groupId: group, accountId: many, target: { kind: "monthly", amount: kr(100) } });
    b.saveUpJob({ name: "B", groupId: group, accountId: many, target: { kind: "monthly", amount: kr(100) } });
    b.saveUpJob({ name: "C", groupId: group, accountId: few, target: { kind: "monthly", amount: kr(100) } });
    const facts = b.facts();
    const options = sitsOptions(facts, computeFigures(facts, today));
    expect(options.preferred?.name).toBe("Many");
    expect(options.others.map((account) => account.name)).toEqual(["Few"]);

    const bare = factsBuilder({ planStart: "2026-11" });
    bare.group({ name: "Saving" });
    const bareFacts = bare.facts();
    expect(sitsOptions(bareFacts, computeFigures(bareFacts, today))).toEqual({ preferred: null, others: [] });
    expect(startingDraft(bareFacts, computeFigures(bareFacts, today), today).sits).toEqual({ kind: "own" });
  });
});

describe("a spend job", () => {
  it("is valid with a name, a group, an amount above zero and the account its bills are paid from", () => {
    const read = readDraft(spend(), context);
    expect(read).toMatchObject({ ok: true, job: { kind: "spend", name: "Swimming lessons", first: kr(800), amount: kr(800), essential: false, keepsMoney: false, where: { kind: "account", accountId: world.accounts.everyday } } });
  });

  it("says what is wrong with each field, one reason each", () => {
    expect(problemsOf(spend({ name: "   " }))).toEqual(["name:nameMissing"]);
    expect(problemsOf(spend({ group: { kind: "existing", groupId: null } }))).toEqual(["group:groupMissing"]);
    expect(problemsOf(spend({ group: { kind: "new", name: " ", counts: false } }))).toEqual(["groupName:groupNameMissing"]);
    expect(problemsOf(spend({ amount: "" }))).toEqual(["amount:notAnAmount"]);
    expect(problemsOf(spend({ amount: "800 kr please" }))).toEqual(["amount:notAnAmount"]);
    expect(problemsOf(spend({ amount: "0" }))).toEqual(["amount:notAbove"]);
    expect(problemsOf(spend({ paidFrom: null }))).toEqual(["paidFrom:accountMissing"]);
  });

  it("asks where the money sits, and not where the bills are paid from, once it keeps its money", () => {
    expect(problemsOf(spend({ keepsMoney: true, paidFrom: null, sits: { kind: "account", accountId: world.accounts.savings } }))).toEqual([]);
    expect(problemsOf(spend({ keepsMoney: true, sits: { kind: "account", accountId: null } }))).toEqual(["sits:accountMissing"]);
    expect(readDraft(spend({ keepsMoney: true, sits: { kind: "own" } }), context)).toMatchObject({ ok: true, job: { keepsMoney: true, where: { kind: "own" } } });
  });

  it("keeps the essential choice", () => {
    expect(readDraft(spend({ essential: true }), context)).toMatchObject({ ok: true, job: { essential: true } });
  });
});

describe("a save-up job", () => {
  it("works out the monthly amount from the target and the month it is ready by, over the months from this one", () => {
    expect(readDraft(saveUp(), context)).toMatchObject({
      ok: true,
      job: { kind: "saveUp", first: kr(2_625), target: { kind: "amountByMonth", amount: kr(21_000), readyBy: "2027-06" }, reach: { monthly: kr(2_625), months: 8, from: "2026-11", to: "2027-06" } },
    });
  });

  it("is valid with a monthly amount instead, and a target and a date are then not looked at", () => {
    const read = readDraft(saveUp({ targetMode: "monthly", amount: "1200", target: "nonsense", readyBy: "never" }), context);
    expect(read).toMatchObject({ ok: true, job: { kind: "saveUp", first: kr(1_200), target: { kind: "monthly", amount: kr(1_200) }, reach: null } });
  });

  it("says what is wrong with the target, the date and the monthly amount", () => {
    expect(problemsOf(saveUp({ target: "" }))).toEqual(["target:notAnAmount"]);
    expect(problemsOf(saveUp({ target: "0" }))).toEqual(["target:notAbove"]);
    expect(problemsOf(saveUp({ readyBy: "" }))).toEqual(["readyBy:readyByMissing"]);
    expect(problemsOf(saveUp({ readyBy: "2026-13" }))).toEqual(["readyBy:readyByMissing"]);
    expect(problemsOf(saveUp({ readyBy: "2026-10" }))).toEqual(["readyBy:readyByTooEarly"]);
    expect(problemsOf(saveUp({ targetMode: "monthly", amount: "" }))).toEqual(["amount:notAnAmount"]);
    expect(problemsOf(saveUp({ targetMode: "monthly", amount: "0" }))).toEqual(["amount:notAbove"]);
    expect(problemsOf(saveUp({ sits: { kind: "account", accountId: null } }))).toEqual(["sits:accountMissing"]);
    expect(problemsOf(saveUp({ name: "", target: "", readyBy: "", group: { kind: "existing", groupId: null } }))).toEqual([
      "name:nameMissing",
      "group:groupMissing",
      "target:notAnAmount",
      "readyBy:readyByMissing",
    ]);
  });

  it("is ready by this month in one go, and not by an earlier one", () => {
    expect(readDraft(saveUp({ readyBy: "2026-11" }), context)).toMatchObject({ ok: true, job: { first: kr(21_000), reach: { months: 1, from: "2026-11", to: "2026-11" } } });
    expect(problemsOf(saveUp({ readyBy: "2026-10" }))).toEqual(["readyBy:readyByTooEarly"]);
  });

  it("is not a one-month job when the date has only passed by one month: the sentence counts months from the first one to the date, both included", () => {
    const December = reachOf(saveUp({ readyBy: "2026-12" }), context);
    expect(December).toMatchObject({ kind: "reach", reach: { months: 2, monthly: kr(10_500) } });
    const next = reachOf(saveUp({ readyBy: "2027-11" }), context);
    expect(next).toMatchObject({ kind: "reach", reach: { months: 13 } });
  });
});

describe("the sentence about what a month takes", () => {
  it("has nothing to say until the target and the date are both readable", () => {
    expect(reachOf(saveUp({ target: "" }), context)).toEqual({ kind: "waiting" });
    expect(reachOf(saveUp({ readyBy: "" }), context)).toEqual({ kind: "waiting" });
    expect(reachOf(saveUp({ target: "lots" }), context)).toEqual({ kind: "waiting" });
  });

  it("starts in the month after a closed one, which takes no money, so the same target is spread over one month fewer", () => {
    const closed = { ...context, access: "closed" as const };
    expect(reachOf(saveUp(), closed)).toMatchObject({ kind: "reach", reach: { from: "2026-12", months: 7, monthly: kr(3_000) } });
    expect(reachOf(saveUp({ readyBy: "2026-11" }), closed)).toEqual({ kind: "tooEarly", from: "2026-12" });
  });

  it("reads a month input only when it is a real month", () => {
    expect(monthOfText("2027-06")).toBe(month("2027-06"));
    expect(monthOfText(" 2027-06 ")).toBe(month("2027-06"));
    for (const text of ["", "2027-6", "2027-13", "2027-00", "27-06", "2027-06-01"]) expect(monthOfText(text)).toBeNull();
  });
});

describe("a pay-into job", () => {
  it("pays into an account the household already pays into, from the account the family chose", () => {
    expect(readDraft(payInto(), context)).toMatchObject({
      ok: true,
      job: { kind: "payInto", first: kr(500), amount: kr(500), account: { kind: "existing", accountId: world.accounts.kids }, paidFrom: world.accounts.everyday },
    });
  });

  const adding = (over: Partial<{ name: string; bank: string; balance: string; date: string; importStatements: boolean; number: string }>): Draft =>
    payInto({ payInto: { kind: "new", account: { name: "Youngest's savings", bank: "Bulder", balance: "5600", date: "2026-11-05", importStatements: false, number: "", ...over } } });

  it("adds an account with a name that carries the bank, a typed balance and the day it is for", () => {
    expect(readDraft(adding({}), context)).toMatchObject({
      ok: true,
      job: { account: { kind: "new", name: "Youngest's savings · Bulder", balance: kr(5_600), date: "2026-11-05", number: null } },
    });
    expect(accountNameOf({ name: " Youngest's savings ", bank: "  " })).toBe("Youngest's savings");
  });

  it("says what is wrong with the account, field by field", () => {
    expect(problemsOf(payInto({ payInto: { kind: "existing", accountId: null } }))).toEqual(["payInto:accountMissing"]);
    expect(problemsOf(adding({ name: " " }))).toEqual(["accountName:nameMissing"]);
    expect(problemsOf(adding({ balance: "" }))).toEqual(["balance:balanceNotAnAmount"]);
    expect(problemsOf(adding({ balance: "-1" }))).toEqual(["balance:balanceNotAnAmount"]);
    expect(problemsOf(adding({ date: "" }))).toEqual(["balanceDate:balanceDateMissing"]);
    expect(problemsOf(adding({ date: "2026-02-30" }))).toEqual(["balanceDate:balanceDateMissing"]);
    expect(problemsOf(payInto({ amount: "" }))).toEqual(["amount:notAnAmount"]);
    expect(problemsOf(payInto({ paidFrom: null }))).toEqual(["paidFrom:accountMissing"]);
  });

  it("accepts a balance of nothing, since a new account can be empty", () => {
    expect(problemsOf(adding({ balance: "0" }))).toEqual([]);
  });

  it("asks for the account's number only when its statements are to be imported, and reads it however the bank writes it", () => {
    expect(problemsOf(adding({ number: "nonsense" }))).toEqual([]);
    expect(problemsOf(adding({ importStatements: true, number: "123" }))).toEqual(["number:numberBad"]);
    expect(readDraft(adding({ importStatements: true, number: "1234.56.78901" }), context)).toMatchObject({ ok: true, job: { account: { kind: "new", number: "12345678901" } } });
  });
});

describe("a field the kind does not have", () => {
  it("never changes whether a draft is valid or what it means", () => {
    const noise = fc.record({
      target: fc.string({ maxLength: 12 }),
      readyBy: fc.string({ maxLength: 8 }),
      targetMode: fc.constantFrom("byMonth", "monthly"),
      keepsMoney: fc.boolean(),
      sits: fc.constantFrom({ kind: "own" } as const, { kind: "account", accountId: null } as const),
      payInto: fc.constantFrom({ kind: "existing", accountId: null } as const, { kind: "new", account: { name: "", bank: "", balance: "x", date: "", importStatements: true, number: "7" } } as const),
    });
    fc.assert(
      fc.property(noise, (extra) => {
        const spendPlain = spend();
        expect(readDraft({ ...spendPlain, target: extra.target, readyBy: extra.readyBy, targetMode: extra.targetMode, sits: extra.sits, payInto: extra.payInto }, context)).toEqual(readDraft(spendPlain, context));
        const into = payInto();
        expect(readDraft({ ...into, target: extra.target, readyBy: extra.readyBy, targetMode: extra.targetMode, keepsMoney: extra.keepsMoney, sits: extra.sits }, context)).toEqual(readDraft(into, context));
        const saving = saveUp();
        expect(readDraft({ ...saving, payInto: extra.payInto, keepsMoney: extra.keepsMoney, paidFrom: null }, context)).toEqual(readDraft(saving, context));
      }),
    );
  });
});

describe("choosing where the money comes from", () => {
  const options = (amount: string) => {
    const read = readDraft(spend({ amount }), context);
    if (!read.ok) throw new Error("Expected a valid job");
    const funding = fundingOf(read.job, context, world.figures, null);
    if (funding.kind !== "options") throw new Error("Expected options");
    return funding;
  };

  it("offers the split first, then each job that could give the rest alone, and picks the first until the family picks another", () => {
    const funding = options("3000");
    expect(funding.options.options.map((option) => option.kind)[0]).toBe("split");
    expect(funding.options.options.slice(1).every((option) => option.kind === "single")).toBe(true);
    expect(funding.chosen).toBe(funding.options.options[0]);
    expect(funding.options.unassigned).toBe(kr(228));
  });

  it("keeps the family's choice by what it is, and falls back to the first when the choice is gone", () => {
    const { options: found } = options("3000");
    const single = found.options.find((option) => option.kind === "single");
    if (single === undefined) throw new Error("Expected a single option");
    expect(chosenFunding(found, fundingKey(single))).toBe(single);
    expect(chosenFunding(found, "single:gone")).toBe(found.options[0]);
    expect(chosenFunding(found, null)).toBe(found.options[0]);
  });

  it("gives every option its own key", () => {
    const { options: found } = options("3000");
    const keys = found.options.map(fundingKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has no choice to make, and nothing taken from another job, when the money with no job covers it", () => {
    const funding = options("200");
    expect(funding.options.options).toHaveLength(1);
    expect(funding.chosen).toMatchObject({ kind: "unassigned", fromUnassigned: kr(200), moves: [] });
  });

  it("offers nothing when the other jobs cannot cover what is missing, and says how much is", () => {
    const funding = options("999999");
    expect(funding.options.options).toEqual([]);
    expect(funding.chosen).toBeNull();
    expect(funding.options.shortfall).toBeGreaterThan(0);
    expect(funding.options.shortfall).toBe(kr(999_999) - funding.options.unassigned - funding.options.givable);
  });

  it("skips funding for a month that is not open, with the reason", () => {
    const read = readDraft(spend(), context);
    if (!read.ok) throw new Error("Expected a valid job");
    expect(fundingOf(read.job, { ...context, access: "projection" }, world.figures, null)).toEqual({ kind: "skipped", access: "projection" });
    expect(fundingOf(read.job, { ...context, access: "closed" }, world.figures, null)).toEqual({ kind: "skipped", access: "closed" });
  });
});

describe("the household in the facts the form reads", () => {
  it("does not change them", () => {
    const before: Facts = world.facts;
    readDraft(spend(), context);
    sitsOptions(world.facts, world.figures);
    expect(world.facts).toBe(before);
    expect(apply(world.facts, { kind: "batch", commands: [] }, { asOf: today }).ok).toBe(true);
    expect([groupId, jobId, accountId].length).toBe(3);
  });
});
