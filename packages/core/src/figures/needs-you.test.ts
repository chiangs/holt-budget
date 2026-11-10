import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { apply } from "../commands/apply.ts";
import { checkFacts } from "../commands/check-facts.ts";
import type { Facts, Transaction } from "../facts.ts";
import type { JobId, TransactionId } from "../ids.ts";
import { money } from "../money.ts";
import { ruleOf, withRules, withTransaction } from "../rules/rule-fixtures.ts";
import { accepted, today } from "../testing/command-household.ts";
import { type FactsBuilder, factsBuilder, kr, setAmount } from "../testing/facts-builder.ts";
import { computeFigures } from "./index.ts";
import { type NeedsYouSuggestion, needsYouItems } from "./needs-you.ts";

interface Setup {
  readonly b: FactsBuilder;
  readonly everyday: ReturnType<FactsBuilder["account"]>;
  readonly savings: ReturnType<FactsBuilder["account"]>;
  readonly food: JobId;
  readonly eatingOut: JobId;
  readonly car: JobId;
}

function setUp(): Setup {
  const b = factsBuilder({ planStart: "2026-10" });
  const everyday = b.account({ name: "Everyday" });
  const savings = b.account({ name: "Savings", kind: "savings" });
  b.buffer({ monthly: kr(1_000) });
  const food = b.spendJob({ name: "Food", plan: setAmount(kr(5_000)) });
  const eatingOut = b.spendJob({ name: "Eating out", plan: setAmount(kr(500)) });
  const car = b.spendJob({ name: "Car", plan: setAmount(kr(800)) });
  return { b, everyday, savings, food, eatingOut, car };
}

/** The facts with each named transaction given a counterparty. */
function named(facts: Facts, names: readonly (readonly [TransactionId, string])[]): Facts {
  return names.reduce((current, [id, counterparty]) => withTransaction(current, id, { counterparty }), facts);
}

/** The treatment a suggestion would set, for the suggestions that set one. */
const treatmentSet = (suggestion: NeedsYouSuggestion | null | undefined) => (suggestion?.command.kind === "setTreatment" ? suggestion.command.treatment : undefined);

const ids = (items: ReturnType<typeof needsYouItems>): TransactionId[] => items.map((i) => i.transaction.id);

describe("needsYouItems", () => {
  it("lists only transactions that wait for you", () => {
    const { b, food, everyday, savings } = setUp();
    b.history({ date: "2026-09-10", amount: kr(-100) });
    b.spend({ date: "2026-10-02", amount: kr(-200), jobId: food });
    b.income({ date: "2026-10-03", amount: kr(9_000), fundsMonth: "2026-11" });
    b.transfer({ from: everyday, to: savings, date: "2026-10-04", amount: kr(300) });
    b.unmatchedTransfer({ date: "2026-10-05", amount: kr(-50) });
    const waiting = b.needsYou({ date: "2026-10-06", amount: kr(-75) });
    expect(ids(needsYouItems(b.facts()))).toEqual([waiting]);
  });

  it("lists nothing when nothing waits", () => {
    const { b, food } = setUp();
    b.spend({ date: "2026-10-02", amount: kr(-200), jobId: food });
    expect(needsYouItems(b.facts())).toEqual([]);
    expect(needsYouItems(setUp().b.facts())).toEqual([]);
  });

  it("lists the newest booking date first, and the smaller ID first on the same date", () => {
    const { b } = setUp();
    const older = b.needsYou({ date: "2026-10-02", amount: kr(-1) });
    const sameFirst = b.needsYou({ date: "2026-10-09", amount: kr(-2) });
    const sameSecond = b.needsYou({ date: "2026-10-09", amount: kr(-3) });
    const newest = b.needsYou({ date: "2026-11-01", amount: kr(-4) });
    expect(ids(needsYouItems(b.facts()))).toEqual([newest, sameFirst, sameSecond, older]);
  });

  it("lists the same way whatever order the transactions are held in", () => {
    const { b } = setUp();
    for (let i = 0; i < 6; i++) b.needsYou({ date: `2026-10-${String(1 + (i % 3)).padStart(2, "0")}`, amount: kr(-(i + 1)) });
    const facts = b.facts();
    const reversed: Facts = { ...facts, transactions: new Map([...facts.transactions].reverse()) };
    expect(ids(needsYouItems(reversed))).toEqual(ids(needsYouItems(facts)));
  });

  it("carries the transaction exactly as stored", () => {
    const { b } = setUp();
    const id = b.needsYou({ date: "2026-10-02", amount: kr(-1) });
    const facts = b.facts();
    expect(needsYouItems(facts)[0]?.transaction).toBe(facts.transactions.get(id));
  });

  it("is part of the figures", () => {
    const { b } = setUp();
    b.needsYou({ date: "2026-10-02", amount: kr(-1) });
    const facts = b.facts();
    expect(computeFigures(facts, today).needsYou).toEqual(needsYouItems(facts));
  });

  describe("a rule made after the transaction arrived", () => {
    const { b, food, eatingOut, everyday, savings } = setUp();
    const kiwi = b.needsYou({ date: "2026-10-12", amount: kr(-300) });
    const unnamed = b.needsYou({ date: "2026-10-13", amount: kr(-310) });
    const other = b.needsYou({ date: "2026-10-14", amount: kr(-320) });
    const rule = ruleOf({ n: 1, counterparty: "kiwi", result: { kind: "job", jobId: food } });
    const matching = withRules(
      named(b.facts(), [
        [kiwi, "KIWI "],
        [other, "Rema 1000"],
      ]),
      rule,
    );

    it("is offered as applying the rule, with the setTreatment that does it", () => {
      const item = needsYouItems(matching).find((i) => i.transaction.id === kiwi);
      expect(item?.suggestion).toEqual({
        kind: "rule",
        ruleId: rule.id,
        command: { kind: "setTreatment", transactionId: kiwi, treatment: { kind: "split", allocations: [{ jobId: food, amount: kr(-300) }] }, ruleId: rule.id },
      });
    });

    it("is not offered for a transaction it does not match", () => {
      const items = needsYouItems(matching);
      expect(items.find((i) => i.transaction.id === other)?.suggestion).toBeNull();
      expect(items.find((i) => i.transaction.id === unnamed)?.suggestion).toBeNull();
    });

    it("sorts the transaction when the family accepts it, and the transaction leaves needs you", () => {
      const suggestion = needsYouItems(matching).find((i) => i.transaction.id === kiwi)?.suggestion;
      if (suggestion === null || suggestion === undefined) throw new Error("no suggestion");
      const after = accepted(apply(matching, suggestion.command, { asOf: today }));
      expect(after.transactions.get(kiwi)?.treatment).toMatchObject({ kind: "split", allocations: [{ jobId: food, amount: kr(-300) }] });
      expect(after.transactions.get(kiwi)?.ruleId).toBe(rule.id);
      expect(ids(needsYouItems(after))).not.toContain(kiwi);
      expect(checkFacts(after)).toEqual([]);
    });

    it("gives a split rule's shares, rounded so they add up", () => {
      const shared = withRules(matching, ruleOf({ n: 2, counterparty: "kiwi", priority: 5, result: { kind: "split", shares: [{ jobId: food, weight: 2 }, { jobId: eatingOut, weight: 1 }] } }));
      const item = needsYouItems(shared).find((i) => i.transaction.id === kiwi);
      expect(treatmentSet(item?.suggestion)).toEqual({
        kind: "split",
        allocations: [
          { jobId: food, amount: kr(-200) },
          { jobId: eatingOut, amount: kr(-100) },
        ],
      });
    });

    it("uses the rule with the highest priority, and the smaller ID on a tie", () => {
      const low = ruleOf({ n: 3, counterparty: "kiwi", priority: 1, result: { kind: "job", jobId: eatingOut } });
      const tie = ruleOf({ n: 0, counterparty: "kiwi", priority: 0, result: { kind: "job", jobId: eatingOut } });
      expect(needsYouItems(withRules(matching, low)).find((i) => i.transaction.id === kiwi)?.suggestion).toMatchObject({ kind: "rule", ruleId: low.id });
      expect(needsYouItems(withRules(matching, tie)).find((i) => i.transaction.id === kiwi)?.suggestion).toMatchObject({ kind: "rule", ruleId: tie.id });
    });

    it("leaves a refund alone when the rule is for purchases (decision 9)", () => {
      const purchases = withRules(withTransaction(matching, kiwi, { amount: kr(300) }), ruleOf({ n: 4, counterparty: "kiwi", max: kr(-1), priority: 9, result: { kind: "job", jobId: eatingOut } }));
      expect(needsYouItems(purchases).find((i) => i.transaction.id === kiwi)?.suggestion).toMatchObject({ kind: "rule", ruleId: rule.id });
    });

    it("applies to the rule's account only", () => {
      const savingsOnly = ruleOf({ n: 5, counterparty: "kiwi", accountId: savings, priority: 9, result: { kind: "job", jobId: eatingOut } });
      const everydayOnly = ruleOf({ n: 6, counterparty: "kiwi", accountId: everyday, priority: 9, result: { kind: "job", jobId: eatingOut } });
      expect(needsYouItems(withRules(matching, savingsOnly)).find((i) => i.transaction.id === kiwi)?.suggestion).toMatchObject({ ruleId: rule.id });
      expect(needsYouItems(withRules(matching, everydayOnly)).find((i) => i.transaction.id === kiwi)?.suggestion).toMatchObject({ ruleId: everydayOnly.id });
    });
  });

  describe("same as last time", () => {
    const { b, food, eatingOut, car, savings } = setUp();
    const first = b.spend({ date: "2026-10-01", amount: kr(-300), jobId: food });
    const second = b.spend({ date: "2026-10-10", amount: kr(-200), jobId: eatingOut });
    const waiting = b.needsYou({ date: "2026-10-20", amount: kr(-500) });
    const earlierWaiting = b.needsYou({ date: "2026-10-05", amount: kr(-50) });
    const later = b.spend({ date: "2026-10-25", amount: kr(-100), jobId: car });
    const facts = named(b.facts(), [
      [first, "Kiwi"],
      [second, " kiwi "],
      [waiting, "KIWI"],
      [earlierWaiting, "Kiwi"],
      [later, "Kiwi"],
    ]);
    const suggestionFor = (f: Facts, id: TransactionId) => needsYouItems(f).find((i) => i.transaction.id === id)?.suggestion;

    it("offers the treatment of the most recent earlier transaction from the same counterparty, ignoring case and spaces", () => {
      expect(suggestionFor(facts, waiting)).toEqual({
        kind: "sameAsLast",
        from: second,
        command: { kind: "setTreatment", transactionId: waiting, treatment: { kind: "split", allocations: [{ jobId: eatingOut, amount: kr(-500) }] } },
      });
    });

    it("does not look at transactions booked later", () => {
      expect(suggestionFor(facts, earlierWaiting)).toMatchObject({ kind: "sameAsLast", from: first });
    });

    it("uses another account's transaction from the same counterparty", () => {
      const f = withTransaction(facts, second, { accountId: savings });
      expect(suggestionFor(f, waiting)).toMatchObject({ from: second });
    });

    it("scales a split to the new amount by the same shares", () => {
      const split = setUp();
      const earlier = split.b.split({ date: "2026-10-01", allocations: [[split.food, kr(-600)], [split.car, kr(-300)]] });
      const now = split.b.needsYou({ date: "2026-10-09", amount: kr(-100) });
      const suggestion = suggestionFor(named(split.b.facts(), [[earlier, "Circle K"], [now, "Circle K"]]), now);
      expect(treatmentSet(suggestion)).toEqual({
        kind: "split",
        allocations: [
          { jobId: split.food, amount: money(-6_667) },
          { jobId: split.car, amount: money(-3_333) },
        ],
      });
    });

    it("keeps the new amount's sign when the earlier transaction was a refund", () => {
      const refund = setUp();
      const earlier = refund.b.spend({ date: "2026-10-01", amount: kr(450), jobId: refund.food });
      const now = refund.b.needsYou({ date: "2026-10-09", amount: kr(-90) });
      const suggestion = suggestionFor(named(refund.b.facts(), [[earlier, "Kiwi"], [now, "Kiwi"]]), now);
      expect(treatmentSet(suggestion)).toEqual({ kind: "split", allocations: [{ jobId: refund.food, amount: kr(-90) }] });
    });

    it("skips an earlier transaction that carries no usable shares and falls back to the one before", () => {
      const skip = setUp();
      const usable = skip.b.spend({ date: "2026-10-01", amount: kr(-300), jobId: skip.food });
      const mixed = skip.b.split({ date: "2026-10-05", allocations: [[skip.food, kr(-500)], [skip.car, kr(200)]] });
      const zero = skip.b.spend({ date: "2026-10-06", amount: kr(0), jobId: skip.car });
      const now = skip.b.needsYou({ date: "2026-10-09", amount: kr(-90) });
      const suggestion = suggestionFor(named(skip.b.facts(), [[usable, "Kiwi"], [mixed, "Kiwi"], [zero, "Kiwi"], [now, "Kiwi"]]), now);
      expect(suggestion).toMatchObject({ kind: "sameAsLast", from: usable });
    });

    it("offers nothing without a counterparty, or without an earlier split from the same one", () => {
      const none = setUp();
      none.b.spend({ date: "2026-10-01", amount: kr(-300), jobId: none.food });
      const unnamed = none.b.needsYou({ date: "2026-10-09", amount: kr(-90) });
      const history = none.b.history({ date: "2026-09-01", amount: kr(-300), jobId: none.food });
      const income = none.b.income({ date: "2026-10-02", amount: kr(100), fundsMonth: "2026-11" });
      const pending = none.b.needsYou({ date: "2026-10-03", amount: kr(-300) });
      const different = none.b.needsYou({ date: "2026-10-10", amount: kr(-95) });
      const f = named(none.b.facts(), [[history, "Kiwi"], [income, "Kiwi"], [pending, "Kiwi"], [different, "Vy"]]);
      expect(suggestionFor(f, unnamed)).toBeNull();
      expect(suggestionFor(f, different)).toBeNull();
      expect(needsYouItems(f).every((i) => i.suggestion === null)).toBe(true);
    });

    it("loses to a rule", () => {
      const rule = ruleOf({ n: 1, counterparty: "kiwi", result: { kind: "job", jobId: car } });
      expect(suggestionFor(withRules(facts, rule), waiting)).toMatchObject({ kind: "rule", ruleId: rule.id });
    });

    it("sorts the transaction when the family accepts it", () => {
      const suggestion = suggestionFor(facts, waiting);
      if (suggestion === undefined || suggestion === null) throw new Error("no suggestion");
      const after = accepted(apply(facts, suggestion.command, { asOf: today }));
      expect(after.transactions.get(waiting)?.treatment.kind).toBe("split");
      expect(checkFacts(after)).toEqual([]);
    });
  });

  describe("a near match", () => {
    it("offers to drop the waiting transaction into the one it may duplicate, and keeps the decided one", () => {
      const { b, food } = setUp();
      const decided = b.spend({ date: "2026-11-03", amount: kr(-249), jobId: food, description: "Netflix" });
      const waiting = b.needsYou({ date: "2026-11-04", amount: kr(-249), description: "Netflix" });
      const items = needsYouItems(b.facts());
      expect(ids(items)).toEqual([waiting]);
      expect(items[0]?.suggestion).toEqual({ kind: "merge", command: { kind: "mergeTransactions", keep: decided, drop: waiting } });
    });

    it("loses to a rule, and wins over same as last time", () => {
      const { b, food, car } = setUp();
      const earlier = b.spend({ date: "2026-10-01", amount: kr(-249), jobId: food, description: "Streaming" });
      const decided = b.spend({ date: "2026-11-03", amount: kr(-249), jobId: food, description: "Netflix" });
      const waiting = b.needsYou({ date: "2026-11-04", amount: kr(-249), description: "Netflix" });
      const base = named(b.facts(), [[earlier, "Netflix"], [waiting, "Netflix"]]);
      expect(needsYouItems(base)[0]?.suggestion).toMatchObject({ kind: "merge", command: { keep: decided, drop: waiting } });
      const rule = ruleOf({ n: 1, counterparty: "netflix", result: { kind: "job", jobId: car } });
      expect(needsYouItems(withRules(base, rule))[0]?.suggestion).toMatchObject({ kind: "rule" });
    });

    it("drops only one of two waiting transactions that duplicate each other", () => {
      const { b } = setUp();
      const first = b.needsYou({ date: "2026-11-03", amount: kr(-249), description: "Netflix" });
      const second = b.needsYou({ date: "2026-11-04", amount: kr(-249), description: "Netflix" });
      const merges = needsYouItems(b.facts()).flatMap((i) => (i.suggestion?.kind === "merge" ? [i.suggestion.command] : []));
      expect(merges).toEqual([{ kind: "mergeTransactions", keep: first, drop: second }]);
    });

    it("never drops a transaction that another suggestion keeps, nor keeps one that it drops", () => {
      const { b } = setUp();
      for (const day of ["03", "04", "05", "06", "07"]) b.needsYou({ date: `2026-11-${day}`, amount: kr(-45), description: "Coffee" });
      const merges = needsYouItems(b.facts()).flatMap((i) => (i.suggestion?.kind === "merge" ? [i.suggestion.command] : []));
      expect(merges.length).toBeGreaterThan(0);
      const dropped = new Set(merges.map((m) => m.drop));
      const kept = new Set(merges.map((m) => m.keep));
      expect([...dropped].filter((id) => kept.has(id))).toEqual([]);
      expect(dropped.size).toBe(merges.length);
    });

    it("keeps offering nothing for a transaction two days away", () => {
      const { b } = setUp();
      b.needsYou({ date: "2026-11-03", amount: kr(-249), description: "Netflix" });
      b.needsYou({ date: "2026-11-05", amount: kr(-249), description: "Netflix" });
      expect(needsYouItems(b.facts()).every((i) => i.suggestion === null)).toBe(true);
    });
  });

  describe("transfer candidates", () => {
    it("lists the other side a transfer could pair with, and nothing for a payment with no partner", () => {
      const { b, everyday, savings } = setUp();
      const out = b.needsYou({ accountId: everyday, date: "2026-11-03", amount: kr(-2_000) });
      const into = b.needsYou({ accountId: savings, date: "2026-11-05", amount: kr(2_000) });
      const alone = b.needsYou({ accountId: everyday, date: "2026-11-06", amount: kr(-77) });
      const items = needsYouItems(b.facts());
      const candidates = (id: TransactionId) => items.find((i) => i.transaction.id === id)?.transferCandidates;
      expect(candidates(out)).toEqual([into]);
      expect(candidates(into)).toEqual([out]);
      expect(candidates(alone)).toEqual([]);
    });

    it("does not stop the item having a suggestion", () => {
      const { b, everyday, savings, food } = setUp();
      const earlier = b.spend({ accountId: everyday, date: "2026-10-01", amount: kr(-2_000), jobId: food });
      const out = b.needsYou({ accountId: everyday, date: "2026-11-03", amount: kr(-2_000) });
      b.needsYou({ accountId: savings, date: "2026-11-05", amount: kr(2_000) });
      const item = needsYouItems(named(b.facts(), [[earlier, "Landlord"], [out, "Landlord"]])).find((i) => i.transaction.id === out);
      expect(item?.transferCandidates).toHaveLength(1);
      expect(item?.suggestion?.kind).toBe("sameAsLast");
    });
  });

  describe("on generated households", () => {
    const names = ["Kiwi", "kiwi", "Rema 1000", "Vy", "Coop Extra"];
    const households = fc
      .array(
        fc.record({
          day: fc.integer({ min: 1, max: 9 }),
          amount: fc.constantFrom(-4_500, -4_500, -12_000, -30_000, 5_000),
          name: fc.option(fc.constantFrom(...names), { nil: null }),
          jobPick: fc.option(fc.nat(), { nil: null }),
          description: fc.constantFrom("Netflix", "Lunch", "Bus"),
        }),
        { maxLength: 20 },
      )
      .map((rows) => {
        const { b, food, eatingOut, car } = setUp();
        const jobs = [food, eatingOut, car];
        const made = rows.map((r) => {
          const date = `2026-10-${String(r.day).padStart(2, "0")}`;
          const amount = money(r.amount);
          const id =
            r.jobPick === null ? b.needsYou({ date, amount, description: r.description }) : b.spend({ date, amount, jobId: jobs[r.jobPick % jobs.length] as JobId, description: r.description });
          return [id, r.name] as const;
        });
        return named(b.facts(), made.flatMap(([id, name]) => (name === null ? [] : [[id, name] as const])));
      });

    it("offers a suggestion for a transaction only from facts that are in the household", () => {
      fc.assert(
        fc.property(households, (facts) => {
          for (const item of needsYouItems(facts)) {
            expect(item.transaction.treatment.kind).toBe("needsYou");
            const s = item.suggestion;
            if (s === null) continue;
            if (s.kind === "merge") {
              expect(facts.transactions.has(s.command.keep)).toBe(true);
              expect(s.command.drop).toBe(item.transaction.id);
              continue;
            }
            expect(s.command.transactionId).toBe(item.transaction.id);
            if (s.kind === "sameAsLast") {
              const from = facts.transactions.get(s.from) as Transaction;
              expect(from.treatment.kind).toBe("split");
              expect(from.counterparty?.trim().toLowerCase()).toBe(item.transaction.counterparty?.trim().toLowerCase());
              expect(from.bookingDate < item.transaction.bookingDate || (from.bookingDate === item.transaction.bookingDate && from.id < item.transaction.id)).toBe(true);
            }
            expect(accepted(apply(facts, s.command, { asOf: today })).transactions.get(item.transaction.id)?.treatment.kind).toBe("split");
          }
        }),
      );
    });

    it("never suggests dropping a transaction that another suggestion keeps", () => {
      let offered = 0;
      fc.assert(
        fc.property(households, (facts) => {
          const merges = needsYouItems(facts).flatMap((i) => (i.suggestion?.kind === "merge" ? [i.suggestion.command] : []));
          const kept = new Set(merges.map((m) => m.keep));
          for (const m of merges) expect(kept.has(m.drop)).toBe(false);
          offered += merges.length;
        }),
      );
      expect(offered).toBeGreaterThan(0);
    });

    it("lists the same items whatever order the transactions are held in", () => {
      fc.assert(
        fc.property(households, (facts) => {
          const shuffled: Facts = { ...facts, transactions: new Map([...facts.transactions].reverse()) };
          expect(needsYouItems(shuffled)).toEqual(needsYouItems(facts));
        }),
      );
    });
  });
});
