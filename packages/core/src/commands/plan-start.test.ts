import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import { type Month, addMonths, localDate, month, monthOf } from "../dates.ts";
import { type Facts, type Transaction, householdOf } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import type { AccountId, JobId, TransactionId } from "../ids.ts";
import { money } from "../money.ts";
import { withTransaction } from "../rules/rule-fixtures.ts";
import { accepted, changeMeta, today } from "../testing/command-household.ts";
import { type FactsBuilder, factsBuilder, kr, setAmount } from "../testing/facts-builder.ts";
import { type ApplyResult, apply, commit } from "./apply.ts";
import { checkFacts } from "./check-facts.ts";

const setPlanStart = (facts: Facts, planStart: string): ApplyResult => apply(facts, { kind: "setPlanStart", planStart: month(planStart) }, { asOf: today });
const treatmentOf = (facts: Facts, id: TransactionId) => facts.transactions.get(id)?.treatment;

interface Household {
  readonly b: FactsBuilder;
  readonly everyday: AccountId;
  readonly savings: AccountId;
  readonly food: JobId;
  readonly hobbies: JobId;
}

/** A household whose plan starts in October 2026 and in which no month is open yet. */
function household(planStart = "2026-10"): Household {
  const b = factsBuilder({ planStart });
  const everyday = b.account({ name: "Everyday" });
  const savings = b.account({ name: "Savings", kind: "savings" });
  b.buffer({ monthly: kr(1_000) });
  const food = b.spendJob({ name: "Food", plan: setAmount(kr(5_000)) });
  const hobbies = b.spendJob({ name: "Hobbies", plan: setAmount(kr(500)) });
  return { b, everyday, savings, food, hobbies };
}

describe("setPlanStart", () => {
  describe("moving the plan start later", () => {
    const { b, food, hobbies, everyday, savings } = household("2026-10");
    const augustHistory = b.history({ date: "2026-08-14", amount: kr(-200), jobId: food });
    const septemberIncome = b.income({ date: "2026-09-20", amount: kr(9_000), fundsMonth: "2026-10" });
    const octoberOneJob = b.spend({ date: "2026-10-05", amount: kr(-300), jobId: food });
    const octoberTwoJobs = b.split({ date: "2026-10-12", allocations: [[food, kr(-200)], [hobbies, kr(-100)]] });
    const octoberIncome = b.income({ date: "2026-10-20", amount: kr(9_000), fundsMonth: "2026-11" });
    const octoberWaiting = b.needsYou({ date: "2026-10-25", amount: kr(-80) });
    const octoberLoose = b.unmatchedTransfer({ date: "2026-10-28", amount: kr(-1_000) });
    const [octoberOut, octoberIn] = b.transfer({ from: everyday, to: savings, date: "2026-10-31", amount: kr(500) });
    const novemberWaiting = b.needsYou({ date: "2026-11-03", amount: kr(-60) });
    const facts = b.facts();
    const after = accepted(setPlanStart(facts, "2026-11"));

    it("moves the plan start", () => {
      expect(householdOf(after).planStart).toBe(month("2026-11"));
    });

    it("turns what waited, was split, was a transfer or was income before the new start into history", () => {
      for (const id of [octoberWaiting, octoberLoose, octoberTwoJobs, septemberIncome, octoberOut, octoberIn]) expect(treatmentOf(after, id)).toEqual({ kind: "history", jobId: null });
    });

    it("keeps the job when the transaction was split to one job, and when it was history with one", () => {
      expect(treatmentOf(after, octoberOneJob)).toEqual({ kind: "history", jobId: food });
      expect(treatmentOf(after, augustHistory)).toEqual({ kind: "history", jobId: food });
    });

    it("keeps income as income when its funds month is on or after the new start (decision 6)", () => {
      expect(treatmentOf(after, octoberIncome)).toEqual(treatmentOf(facts, octoberIncome));
    });

    it("leaves transactions from the new start on as they were", () => {
      expect(treatmentOf(after, novemberWaiting)).toEqual({ kind: "needsYou" });
    });

    it("keeps every transaction's amount, date, account and description", () => {
      for (const [id, t] of facts.transactions) {
        expect(after.transactions.get(id)).toMatchObject({ amount: t.amount, bookingDate: t.bookingDate, accountId: t.accountId, description: t.description });
      }
    });

    it("leaves the household sound", () => {
      expect(checkFacts(facts)).toEqual([]);
      expect(checkFacts(after)).toEqual([]);
    });

    it("lets go of the partner of a transfer that became history, because its other side is no longer a transfer", () => {
      const pair = household("2026-10");
      const [out, into] = pair.b.transfer({ from: pair.everyday, to: pair.savings, date: "2026-10-30", amount: kr(700) });
      const straddling = withTransaction(pair.b.facts(), into, { bookingDate: localDate("2026-11-01") });
      expect(checkFacts(straddling)).toEqual([]);
      const moved = accepted(setPlanStart(straddling, "2026-11"));
      expect(treatmentOf(moved, out)).toEqual({ kind: "history", jobId: null });
      expect(treatmentOf(moved, into)).toEqual({ kind: "transfer", partner: null });
      expect(checkFacts(moved)).toEqual([]);
    });

    it("leaves a pair of transfers alone when the move doesn't reach it", () => {
      const moved = accepted(setPlanStart(facts, "2026-09"));
      expect(treatmentOf(moved, octoberOut)).toEqual(treatmentOf(facts, octoberOut));
    });
  });

  describe("moving the plan start earlier", () => {
    const { b, food, everyday, savings } = household("2026-10");
    const august = b.history({ date: "2026-08-14", amount: kr(-200), jobId: food });
    const septemberNone = b.history({ date: "2026-09-10", amount: kr(-90) });
    const septemberJob = b.history({ date: "2026-09-12", amount: kr(-110), jobId: food });
    const septemberIncome = b.income({ date: "2026-09-20", amount: kr(9_000), fundsMonth: "2026-10" });
    const october = b.spend({ date: "2026-10-05", amount: kr(-300), jobId: food });
    b.transfer({ from: everyday, to: savings, date: "2026-10-09", amount: kr(100) });
    const facts = b.facts();
    const after = accepted(setPlanStart(facts, "2026-09"));

    it("sends history from the new start on to needs you", () => {
      expect(treatmentOf(after, septemberNone)).toEqual({ kind: "needsYou" });
      expect(treatmentOf(after, septemberJob)).toEqual({ kind: "needsYou" });
    });

    it("keeps earlier history, with its job", () => {
      expect(treatmentOf(after, august)).toEqual(treatmentOf(facts, august));
    });

    it("leaves other treatments from the new start on alone, such as income booked before the old start", () => {
      expect(treatmentOf(after, septemberIncome)).toEqual(treatmentOf(facts, septemberIncome));
      expect(treatmentOf(after, october)).toEqual(treatmentOf(facts, october));
    });

    it("leaves the household sound", () => {
      expect(checkFacts(after)).toEqual([]);
    });

    it("sends all history to needs you when the plan starts before it", () => {
      const all = accepted(setPlanStart(facts, "2026-01"));
      expect(treatmentOf(all, august)).toEqual({ kind: "needsYou" });
      expect(checkFacts(all)).toEqual([]);
    });
  });

  describe("once a month has been opened", () => {
    it.each(["open", "closed", "reopened"] as const)("is refused when a month is %s", (state) => {
      const { b } = household("2026-10");
      b.budgetMonth("2026-10", state);
      for (const planStart of ["2026-09", "2026-10", "2026-12"]) expect(setPlanStart(b.facts(), planStart)).toMatchObject({ ok: false, refusal: { code: "planStartMonthOpened" } });
    });

    it("changes nothing when it refuses", () => {
      const { b, food } = household("2026-10");
      b.history({ date: "2026-09-10", amount: kr(-90), jobId: food });
      b.budgetMonth("2026-10", "closed");
      const facts = b.facts();
      const result = setPlanStart(facts, "2026-09");
      expect(result.ok).toBe(false);
      expect(treatmentOf(facts, [...facts.transactions.keys()][0] as TransactionId)).toEqual({ kind: "history", jobId: food });
    });
  });

  it("changes nothing when the plan start stays where it is", () => {
    const { b, food } = household("2026-10");
    b.history({ date: "2026-09-10", amount: kr(-90), jobId: food });
    b.needsYou({ date: "2026-10-10", amount: kr(-90) });
    const result = setPlanStart(b.facts(), "2026-10");
    expect(result.ok && result.patch).toEqual([]);
  });

  it("is one change that undo takes back", () => {
    const { b, food } = household("2026-10");
    b.history({ date: "2026-09-10", amount: kr(-90), jobId: food });
    b.spend({ date: "2026-10-10", amount: kr(-90), jobId: food });
    const facts = b.facts();
    const done = commit(facts, emptyChangeLog(), { kind: "setPlanStart", planStart: month("2026-11") }, changeMeta(1), { asOf: today });
    if (!done.ok) throw new Error("refused");
    expect(done.log.done).toHaveLength(1);
    const undone = undo(done.facts, done.log);
    expect(undone.ok && undone.facts).toEqual(facts);
  });
});

describe("income from before the plan start (decision 6 of 0047)", () => {
  const november = household("2026-11");
  november.b.income({ date: "2026-10-20", amount: kr(30_000), fundsMonth: "2026-11" });
  november.b.income({ date: "2026-10-25", amount: kr(5_000), fundsMonth: "2026-11" });
  november.b.history({ date: "2026-10-28", amount: kr(-400) });
  const facts = november.b.facts();

  it("lets October's contributions fund the first month of a plan that starts in November", () => {
    expect(checkFacts(facts)).toEqual([]);
    const figures = computeFigures(facts, today);
    expect(figures.months.get(month("2026-11"))).toMatchObject({ income: kr(35_000), available: kr(35_000) });
  });

  it("counts the same income when the plan start moves to November from October", () => {
    const october = household("2026-10");
    october.b.income({ date: "2026-10-20", amount: kr(30_000), fundsMonth: "2026-11" });
    october.b.income({ date: "2026-10-25", amount: kr(5_000), fundsMonth: "2026-11" });
    const before = october.b.facts();
    const moved = accepted(setPlanStart(before, "2026-11"));
    expect(computeFigures(moved, today).months.get(month("2026-11"))?.income).toBe(kr(35_000));
    expect(computeFigures(before, today).months.get(month("2026-11"))?.income).toBe(kr(35_000));
    expect(checkFacts(moved)).toEqual([]);
  });

  it("accepts a new income transaction booked before the plan start that funds a month from it on", () => {
    const record = (fundsMonth: string): ApplyResult =>
      apply(
        facts,
        { kind: "recordTransaction", transaction: { id: "00000000-0000-7000-8000-0000000fffff" as TransactionId, accountId: november.everyday, bookingDate: "2026-10-30" as Transaction["bookingDate"], amount: kr(1_000), description: "Contribution", treatment: { kind: "income", fundsMonth: month(fundsMonth), source: "contribution" } } },
        { asOf: today },
      );
    expect(record("2026-11").ok).toBe(true);
    expect(record("2026-12").ok).toBe(true);
    expect(record("2026-10")).toMatchObject({ ok: false, refusal: { code: "notHistoryBeforePlanStart" } });
  });

  it("still sends every other treatment before the plan start to history", () => {
    const waiting = new Map(facts.transactions);
    const [first] = [...waiting.values()];
    if (first === undefined) throw new Error("no transactions");
    for (const treatment of [{ kind: "needsYou" }, { kind: "transfer", partner: null }] as const) {
      const wrong: Facts = { ...facts, transactions: new Map(waiting).set(first.id, { ...first, bookingDate: "2026-10-03" as Transaction["bookingDate"], treatment }) };
      expect(checkFacts(wrong).map((v) => v.code)).toContain("notHistoryBeforePlanStart");
    }
  });
});

describe("moving the plan start on generated households", () => {
  const start = month("2026-06");
  const months = (from: number, to: number): fc.Arbitrary<Month> => fc.integer({ min: from, max: to }).map((i) => addMonths(start, i));

  interface Entry {
    readonly monthOffset: number;
    readonly day: number;
    readonly kind: "history" | "historyJob" | "incomeNear" | "incomeFar" | "needsYou" | "oneJob" | "twoJobs" | "looseTransfer" | "pair";
    readonly fundsOffset: number;
    readonly amount: number;
  }

  /**
   * A sound household planned from June 2026 with no month open. Before June a transaction is history or
   * income that funds June or later. From June on it is anything. `before` and `from` narrow the kinds, so
   * a property can aim at the households where a round trip should lose nothing.
   */
  function generated(kindsBefore: readonly Entry["kind"][], kindsFrom: readonly Entry["kind"][]): fc.Arbitrary<Facts> {
    const entry = (kinds: readonly Entry["kind"][], offsets: [number, number]): fc.Arbitrary<Entry> =>
      fc.record({
        monthOffset: fc.integer({ min: offsets[0], max: offsets[1] }),
        day: fc.integer({ min: 1, max: 27 }),
        kind: fc.constantFrom(...kinds),
        fundsOffset: fc.integer({ min: 0, max: 5 }),
        amount: fc.integer({ min: 1, max: 50_000 }),
      });
    return fc.tuple(fc.array(entry(kindsBefore, [-3, -1]), { maxLength: 8 }), fc.array(entry(kindsFrom, [0, 4]), { maxLength: 10 })).map(([before, from]) => {
      const { b, everyday, savings, food, hobbies } = household("2026-06");
      for (const e of [...before, ...from]) {
        const date = `${addMonths(start, e.monthOffset)}-${String(e.day).padStart(2, "0")}`;
        const amount = money(-e.amount);
        switch (e.kind) {
          case "history":
            b.history({ date, amount });
            break;
          case "historyJob":
            b.history({ date, amount, jobId: food });
            break;
          case "incomeNear":
            b.income({ date, amount: money(e.amount), fundsMonth: addMonths(start, e.fundsOffset - 2) });
            break;
          case "incomeFar":
            b.income({ date, amount: money(e.amount), fundsMonth: addMonths(start, 7 + e.fundsOffset) });
            break;
          case "needsYou":
            b.needsYou({ date, amount });
            break;
          case "oneJob":
            b.spend({ date, amount, jobId: food });
            break;
          case "twoJobs":
            b.split({ date, allocations: [[food, money(-e.amount)], [hobbies, money(-1)]] });
            break;
          case "looseTransfer":
            b.unmatchedTransfer({ date, amount });
            break;
          case "pair":
            b.transfer({ from: everyday, to: savings, date, amount: money(e.amount) });
            break;
        }
      }
      return b.facts();
    });
  }

  const everything: readonly Entry["kind"][] = ["incomeNear", "incomeFar", "needsYou", "oneJob", "twoJobs", "looseTransfer", "pair"];
  const beforeKinds: readonly Entry["kind"][] = ["history", "historyJob", "incomeFar"];
  const undecided: readonly Entry["kind"][] = ["needsYou", "incomeFar"];
  const noJobs: readonly Entry["kind"][] = ["history", "incomeFar"];

  const soundHouseholds = generated(beforeKinds, everything);

  it("generates households that are sound", () => {
    fc.assert(
      fc.property(soundHouseholds, (facts) => {
        expect(checkFacts(facts)).toEqual([]);
      }),
    );
  });

  it("gives a sound household for any new plan start, changing only treatments", () => {
    fc.assert(
      fc.property(soundHouseholds, months(-3, 6), (facts, to) => {
        const result = setPlanStart(facts, to);
        if (!result.ok) throw new Error(`refused: ${result.refusal.message}`);
        expect(checkFacts(result.facts)).toEqual([]);
        for (const change of result.patch) {
          expect(["household", "transactions"]).toContain(change.table);
          if (change.table === "transactions" && change.before !== null && change.after !== null) {
            const { treatment: _before, ...beforeRest } = change.before;
            const { treatment: _after, ...afterRest } = change.after;
            expect(afterRest).toEqual(beforeRest);
          }
        }
      }),
    );
  });

  it("puts each transaction before the new start in history or income that funds on or after it, and nothing from it on in history", () => {
    fc.assert(
      fc.property(soundHouseholds, months(-3, 6), (facts, to) => {
        const after = accepted(setPlanStart(facts, to));
        for (const t of after.transactions.values()) {
          const kind = t.treatment.kind;
          if (monthOf(t.bookingDate) >= to) expect(kind).not.toBe("history");
          else expect(kind === "history" || (t.treatment.kind === "income" && t.treatment.fundsMonth >= to)).toBe(true);
        }
      }),
    );
  });

  it("keeps the job of a history row or a one-job split that stays before the new start", () => {
    fc.assert(
      fc.property(soundHouseholds, months(-3, 6), (facts, to) => {
        const after = accepted(setPlanStart(facts, to));
        for (const [id, was] of facts.transactions) {
          const now = after.transactions.get(id)?.treatment;
          if (monthOf(was.bookingDate) >= to || now?.kind !== "history") continue;
          const job = was.treatment.kind === "history" ? was.treatment.jobId : was.treatment.kind === "split" && was.treatment.allocations.length === 1 ? was.treatment.allocations[0]?.jobId : null;
          expect(now.jobId).toBe(job ?? null);
        }
      }),
    );
  });

  it("is undone exactly by undo", () => {
    fc.assert(
      fc.property(soundHouseholds, months(-3, 6), (facts, to) => {
        const done = commit(facts, emptyChangeLog(), { kind: "setPlanStart", planStart: to }, changeMeta(1), { asOf: today });
        if (!done.ok) throw new Error("refused");
        const undone = undo(done.facts, done.log);
        expect(undone.ok && undone.facts).toEqual(facts);
      }),
    );
  });

  describe("moving earlier and back", () => {
    const roundTrip = (facts: Facts, earlier: Month): Facts => accepted(setPlanStart(accepted(setPlanStart(facts, earlier)), householdOf(facts).planStart));
    const loses = (facts: Facts, earlier: Month): boolean =>
      [...facts.transactions.values()].some((t) => monthOf(t.bookingDate) >= earlier && monthOf(t.bookingDate) < householdOf(facts).planStart && t.treatment.kind === "history" && t.treatment.jobId !== null);

    it("restores every treatment exactly when no history in between carried a job", () => {
      fc.assert(
        fc.property(generated(noJobs, everything), months(-3, -1), (facts, earlier) => {
          expect(roundTrip(facts, earlier)).toEqual(facts);
        }),
      );
    });

    it("restores them if and only if no history in between carried a job, which is all it loses", () => {
      fc.assert(
        fc.property(soundHouseholds, months(-3, -1), (facts, earlier) => {
          const back = roundTrip(facts, earlier);
          if (!loses(facts, earlier)) expect(back).toEqual(facts);
          else {
            expect(back).not.toEqual(facts);
            for (const [id, t] of facts.transactions) {
              const now = back.transactions.get(id) as Transaction;
              const lostJob = t.treatment.kind === "history" && t.treatment.jobId !== null && monthOf(t.bookingDate) >= earlier;
              expect(now.treatment).toEqual(lostJob ? { kind: "history", jobId: null } : t.treatment);
            }
          }
        }),
      );
    });
  });

  describe("moving later and back", () => {
    const roundTrip = (facts: Facts, later: Month): Facts => accepted(setPlanStart(accepted(setPlanStart(facts, later)), householdOf(facts).planStart));
    const decided = (facts: Facts, later: Month): boolean =>
      [...facts.transactions.values()].some((t) => {
        const inBetween = monthOf(t.bookingDate) >= householdOf(facts).planStart && monthOf(t.bookingDate) < later;
        return inBetween && !(t.treatment.kind === "needsYou" || (t.treatment.kind === "income" && t.treatment.fundsMonth >= later));
      });

    it("restores every treatment exactly when everything in between still waited or was income funding the later months", () => {
      fc.assert(
        fc.property(generated(beforeKinds, undecided), months(1, 6), (facts, later) => {
          expect(roundTrip(facts, later)).toEqual(facts);
        }),
      );
    });

    it("restores them if and only if everything in between still waited or funded the later months", () => {
      fc.assert(
        fc.property(soundHouseholds, months(1, 6), (facts, later) => {
          const back = roundTrip(facts, later);
          if (decided(facts, later)) expect(back).not.toEqual(facts);
          else expect(back).toEqual(facts);
        }),
      );
    });
  });
});
