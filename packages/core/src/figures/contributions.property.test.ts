/**
 * What must hold for any agreements and any payments, however they fall around the days they are expected.
 * The statuses are checked against a plain reading of decision record 0048 that counts days a different way
 * from the code, and a tally proves the generated households reached every state.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { apply } from "../commands/apply.ts";
import { checkFacts } from "../commands/check-facts.ts";
import { type LocalDate, type Month, addMonths, daysBetween, localDate, monthOf, monthRange } from "../dates.ts";
import { type ContributionAgreement, type Facts, type Transaction, householdOf } from "../facts.ts";
import type { AgreementId, TransactionId } from "../ids.ts";
import { type ContributionWorld, arbitraryContributions } from "../testing/contribution-household.ts";
import { averageEstimate } from "../testing/estimates.ts";
import { type ContributionState, type ContributionStatus, computeFigures, contributionStatuses, expectedIncome, moneyIn } from "./index.ts";
import { needsYouItems } from "./needs-you.ts";

const run = { numRuns: 400 };

/** Income that pays this agreement for this month, booked on or before today, from the facts alone. */
function linkedTo(facts: Facts, agreement: AgreementId, fundsMonth: Month, asOf: LocalDate): Transaction[] {
  return [...facts.transactions.values()]
    .filter(
      (t) =>
        t.treatment.kind === "income" &&
        t.treatment.source === "contribution" &&
        t.treatment.agreement === agreement &&
        t.treatment.fundsMonth === fundsMonth &&
        t.bookingDate <= asOf,
    );
}

/** The status the decision record gives, worked out with `daysBetween`. */
function plainState(facts: Facts, status: ContributionStatus, asOf: LocalDate): ContributionState {
  const linked = linkedTo(facts, status.agreementId, status.fundsMonth, asOf);
  const total = linked.reduce((sum, t) => sum + t.amount, 0);
  const expected = `${addMonths(status.fundsMonth, -1)}-${String(facts.contributionAgreements.get(status.agreementId)?.day).padStart(2, "0")}` as LocalDate;
  const daysAfter = (date: LocalDate): number => daysBetween(expected, date);
  if (linked.length >= 1 && total >= status.agreed) {
    if (linked.length >= 2) return "parts";
    return daysAfter((linked[0] as Transaction).bookingDate) <= 3 ? "arrived" : "late";
  }
  if (total > 0) return "short";
  return daysAfter(asOf) > 3 ? "overdue" : "expected";
}

function tally() {
  return { arrived: 0, late: 0, parts: 0, short: 0, overdue: 0, expected: 0 } satisfies Record<ContributionState, number>;
}

describe("the statuses", () => {
  it("equal the decision record's precedence, and the generated households reach every state", () => {
    const seen = tally();
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts, asOf }) => {
        for (const status of contributionStatuses(facts, asOf)) {
          expect(status.state).toBe(plainState(facts, status, asOf));
          seen[status.state] += 1;
        }
      }),
      run,
    );
    for (const [state, count] of Object.entries(seen)) expect(count, `no household reached ${state}`).toBeGreaterThan(0);
  });

  it("depend on the facts and the day alone, whatever order the rows are held in", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts, asOf }) => {
        const shuffled: Facts = {
          ...facts,
          transactions: new Map([...facts.transactions].reverse()),
          contributionAgreements: new Map([...facts.contributionAgreements].reverse()),
          people: new Map([...facts.people].reverse()),
        };
        const statuses = contributionStatuses(facts, asOf);
        expect(contributionStatuses(shuffled, asOf)).toEqual(statuses);
        expect(contributionStatuses(facts, asOf)).toEqual(statuses);
        expect(expectedIncome(shuffled, asOf)).toEqual(expectedIncome(facts, asOf));
      }),
      run,
    );
  });

  it("list the transactions that count and add up to what arrived", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts, asOf }) => {
        for (const status of contributionStatuses(facts, asOf)) {
          const linked = linkedTo(facts, status.agreementId, status.fundsMonth, asOf);
          expect([...status.transactionIds].sort()).toEqual(linked.map((t) => t.id).sort());
          expect(status.arrived).toBe(linked.reduce((sum, t) => sum + t.amount, 0));
          expect(status.arrivedOn).toBe(linked.length === 0 ? null : linked.map((t) => t.bookingDate).sort().at(-1));
        }
      }),
      run,
    );
  });

  it("never count more than the income linked to the agreement for that month", () => {
    fc.assert(
      fc.property(arbitraryContributions(), ({ facts, asOf }) => {
        for (const status of contributionStatuses(facts, asOf)) {
          const everything = [...facts.transactions.values()].filter(
            (t) => t.treatment.kind === "income" && t.treatment.agreement === status.agreementId && t.treatment.fundsMonth === status.fundsMonth,
          );
          expect(status.arrived).toBeLessThanOrEqual(everything.reduce((sum, t) => sum + t.amount, 0));
        }
      }),
      run,
    );
  });

  it("cover each agreement once for each month of the window it funds, from the plan start", () => {
    fc.assert(
      fc.property(arbitraryContributions(), ({ facts, asOf }) => {
        const current = monthOf(asOf);
        const statuses = contributionStatuses(facts, asOf);
        const planStart = householdOf(facts).planStart;
        for (const agreement of facts.contributionAgreements.values()) {
          const covered = statuses.filter((s) => s.agreementId === agreement.id).map((s) => s.fundsMonth);
          const should = monthRange(addMonths(current, -2), addMonths(current, 1)).filter((m) => m >= planStart && m >= agreement.from && (agreement.to === undefined || m <= agreement.to));
          expect(covered).toEqual(should);
        }
      }),
      run,
    );
  });

  it("are listed by month, then person, then agreement", () => {
    fc.assert(
      fc.property(arbitraryContributions(), ({ facts, asOf }) => {
        const key = (s: ContributionStatus) => `${s.fundsMonth}\u0000${s.personName}\u0000${s.agreementId}`;
        const keys = contributionStatuses(facts, asOf).map(key);
        expect(keys).toEqual([...keys].sort());
      }),
      run,
    );
  });

  it("change nothing when a contribution that names no agreement is added", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), fc.integer({ min: -3, max: 3 }), fc.integer({ min: -2_000_000, max: 8_000_000 }), fc.integer({ min: 0, max: 28 }), ({ facts, asOf }, delta, amount, offset) => {
        const fundsMonth = addMonths(monthOf(asOf), delta);
        const added: Transaction = {
          id: "00000000-0000-7000-8000-0000000fffff" as TransactionId,
          accountId: [...facts.accounts.keys()][0] as Transaction["accountId"],
          bookingDate: `${addMonths(fundsMonth, -1)}-${String(offset + 1).padStart(2, "0")}` as LocalDate,
          amount: amount as Transaction["amount"],
          description: "unlinked",
          treatment: { kind: "income", fundsMonth, source: "contribution" },
        };
        const more: Facts = { ...facts, transactions: new Map(facts.transactions).set(added.id, added) };
        expect(contributionStatuses(more, asOf)).toEqual(contributionStatuses(facts, asOf));
        expect(expectedIncome(more, asOf)).toEqual(expectedIncome(facts, asOf));
      }),
      run,
    );
  });
});

describe("expected income", () => {
  it("is never negative, and zero for a month that has arrived, arrived late or arrived in parts", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts, asOf }) => {
        for (const month of expectedIncome(facts, asOf)) {
          expect(month.amount).toBeGreaterThanOrEqual(0);
          for (const c of month.contributions) {
            expect(c.stillExpected).toBeGreaterThan(0);
            expect(["expected", "overdue", "short"]).toContain(c.state);
          }
        }
        for (const status of contributionStatuses(facts, asOf)) {
          expect(status.stillExpected).toBeGreaterThanOrEqual(0);
          if (status.state === "arrived" || status.state === "late" || status.state === "parts") expect(status.stillExpected).toBe(0);
          else expect(status.stillExpected).toBe(Math.max(0, status.agreed - status.arrived));
        }
      }),
      run,
    );
  });

  it("is the rest of every agreement's amount in each month it runs, and its months run from the current month to the horizon", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), fc.integer({ min: 0, max: 14 }), ({ facts, asOf }, horizon) => {
        const months = expectedIncome(facts, asOf, horizon);
        expect(months.map((m) => m.month)).toEqual(monthRange(monthOf(asOf), addMonths(monthOf(asOf), horizon)));
        for (const m of months) {
          let rest = 0;
          for (const agreement of facts.contributionAgreements.values()) {
            const runs = m.month >= agreement.from && (agreement.to === undefined || m.month <= agreement.to) && m.month >= householdOf(facts).planStart;
            if (!runs) continue;
            const got = linkedTo(facts, agreement.id, m.month, asOf);
            const total = got.reduce((sum, t) => sum + t.amount, 0);
            rest += Math.max(0, agreement.amount - total);
          }
          expect(m.amount).toBe(rest);
        }
      }),
      run,
    );
  });

  it("does not grow when a payment is linked to an agreement", () => {
    fc.assert(
      fc.property(arbitraryContributions(), fc.nat(), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 1, max: 9_000_000 }), ({ facts, asOf }, which, delta, amount) => {
        const agreement = [...facts.contributionAgreements.values()][which % facts.contributionAgreements.size];
        if (agreement === undefined) throw new Error("no agreement");
        const fundsMonth = addMonths(monthOf(asOf), delta);
        const added: Transaction = {
          id: "00000000-0000-7000-8000-0000000ffffe" as TransactionId,
          accountId: agreement.accountId,
          bookingDate: asOf,
          amount: amount as Transaction["amount"],
          description: "linked",
          treatment: { kind: "income", fundsMonth, source: "contribution", agreement: agreement.id },
        };
        const more: Facts = { ...facts, transactions: new Map(facts.transactions).set(added.id, added) };
        const before = expectedIncome(facts, asOf);
        const after = expectedIncome(more, asOf);
        before.forEach((m, i) => expect((after[i] as (typeof after)[number]).amount).toBeLessThanOrEqual(m.amount));
      }),
      run,
    );
  });
});

describe("money in", () => {
  it("is what arrived plus what is expected, with the parts kept apart", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts, asOf }) => {
        const expected = expectedIncome(facts, asOf);
        moneyIn(facts, asOf).forEach((m, i) => {
          const actual = [...facts.transactions.values()].filter((t) => t.treatment.kind === "income" && t.treatment.fundsMonth === m.month && t.bookingDate <= asOf).reduce((sum, t) => sum + t.amount, 0);
          expect(m.actual).toBe(actual);
          expect(m.expected).toBe((expected[i] as (typeof expected)[number]).amount);
          expect(m.total).toBe(m.actual + m.expected);
        });
      }),
      run,
    );
  });
});

describe("the plan", () => {
  it("has the same money available, whatever the agreements, because expected income is not money (rule 4)", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts, asOf }) => {
        const without: Facts = { ...facts, contributionAgreements: new Map() };
        const options = { estimate: averageEstimate };
        const a = computeFigures(facts, asOf, options).months;
        const b = computeFigures(without, asOf, options).months;
        expect([...a.values()].map((m) => [m.month, m.income, m.available, m.unassigned, m.carriedIn])).toEqual([...b.values()].map((m) => [m.month, m.income, m.available, m.unassigned, m.carriedIn]));
      }),
      run,
    );
  });

  it("moves, in each account and month from the current one, the assignments less the income that arrived and the contributions still expected", () => {
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts, asOf }) => {
        const figures = computeFigures(facts, asOf, { estimate: averageEstimate });
        const expected = expectedIncome(facts, asOf);
        for (const account of figures.accounts.values()) {
          for (const [m, move] of account.monthlyMoves) {
            const assigned = [...figures.jobs.values()].filter((j) => j.job.accountId === account.account.id).reduce((sum, j) => sum + (j.months.get(m)?.assigned.amount ?? 0), 0);
            const arrived = [...facts.transactions.values()]
              .filter((t) => t.accountId === account.account.id && t.treatment.kind === "income" && t.treatment.fundsMonth === m && t.bookingDate <= asOf)
              .reduce((sum, t) => sum + t.amount, 0);
            const coming = (expected.find((e) => e.month === m)?.contributions ?? []).filter((c) => c.accountId === account.account.id).reduce((sum, c) => sum + c.stillExpected, 0);
            const net = assigned - arrived - coming;
            expect(move).toEqual(net > 0 ? { kind: "moveIn", amount: net } : net < 0 ? { kind: "surplus", amount: -net } : { kind: "none" });
          }
        }
      }),
      run,
    );
  });
});

describe("the generator", () => {
  it("reaches linked and unlinked payments, and agreements that end", () => {
    let linked = 0;
    let unlinked = 0;
    let ended = 0;
    fc.assert(
      fc.property(arbitraryContributions({ refunds: true }), ({ facts }: ContributionWorld) => {
        for (const t of facts.transactions.values()) {
          if (t.treatment.kind !== "income") continue;
          if (t.treatment.agreement === undefined) unlinked += 1;
          else linked += 1;
        }
        for (const a of facts.contributionAgreements.values()) if (a.to !== undefined) ended += 1;
      }),
      run,
    );
    expect([linked, unlinked, ended].every((n) => n > 0)).toBe(true);
  });
});

describe("the payments that wait for you", () => {
  const waitingSpec = fc.record({
    account: fc.integer({ min: 0, max: 1 }),
    month: fc.integer({ min: -3, max: 3 }),
    day: fc.integer({ min: 1, max: 28 }),
    pick: fc.nat(),
    kind: fc.constantFrom("whole", "plusOne", "minusOne", "half", "tiny", "out", "zero"),
  });

  /** The world with payments waiting, each with a description of its own so no two look like a duplicate, and a twin of some agreements so that some payments fit two equally well. */
  const withWaiting = arbitraryContributions().chain(({ facts: made, asOf }) =>
    fc.tuple(fc.array(waitingSpec, { minLength: 1, maxLength: 10 }), fc.array(fc.nat(), { maxLength: 2 })).map(([specs, twinned]) => {
      const twins = new Map(made.contributionAgreements);
      twinned.forEach((which, i) => {
        const original = [...made.contributionAgreements.values()][which % made.contributionAgreements.size] as ContributionAgreement;
        const id = `00000000-0000-7000-8000-0000000e${String(i).padStart(4, "0")}` as AgreementId;
        twins.set(id, { ...original, id });
      });
      const facts: Facts = { ...made, contributionAgreements: twins };
      const agreements = [...facts.contributionAgreements.values()];
      const accounts = [...facts.accounts.keys()];
      const transactions = new Map(facts.transactions);
      specs.forEach((spec, i) => {
        const agreement = agreements[spec.pick % agreements.length] as (typeof agreements)[number];
        const amount = { whole: agreement.amount, plusOne: agreement.amount + 1, minusOne: agreement.amount - 1, half: Math.floor(agreement.amount / 2), tiny: 1, out: -agreement.amount, zero: 0 }[spec.kind];
        const id = `00000000-0000-7000-8000-0000000f${String(i).padStart(4, "0")}` as TransactionId;
        transactions.set(id, {
          id,
          accountId: accounts[spec.account] as Transaction["accountId"],
          bookingDate: `${addMonths(monthOf(asOf), spec.month)}-${String(spec.day).padStart(2, "0")}` as LocalDate,
          amount: amount as Transaction["amount"],
          description: `Waiting ${i}`,
          treatment: { kind: "needsYou" },
        });
      });
      return { facts: { ...facts, transactions } satisfies Facts, asOf };
    }),
  );

  /** The agreement a waiting payment is most likely under, worked out one candidate at a time from the decision. */
  function plainMatch(facts: Facts, t: Transaction): { readonly id: AgreementId | null; readonly tied: boolean } {
    if (t.amount <= 0) return { id: null, tied: false };
    const funds = addMonths(monthOf(t.bookingDate), 1);
    const scored: { id: AgreementId; fit: number; days: number }[] = [];
    for (const a of facts.contributionAgreements.values()) {
      const covers = funds >= householdOf(facts).planStart && funds >= a.from && (a.to === undefined || funds <= a.to);
      const days = Math.abs(Number(t.bookingDate.slice(8)) - a.day);
      if (a.accountId !== t.accountId || !covers || days > 7) continue;
      const paid = [...facts.transactions.values()]
        .filter((x) => x.treatment.kind === "income" && x.treatment.source === "contribution" && x.treatment.agreement === a.id && x.treatment.fundsMonth === funds)
        .reduce((sum, x) => sum + x.amount, 0);
      const left = a.amount - paid;
      if (left <= 0 || t.amount > left) continue;
      scored.push({ id: a.id, fit: t.amount === left ? 0 : 1, days });
    }
    const best = scored.reduce<{ fit: number; days: number } | null>((b, s) => (b === null || s.fit < b.fit || (s.fit === b.fit && s.days < b.days) ? s : b), null);
    const closest = scored.filter((s) => s.fit === best?.fit && s.days === best.days);
    return closest.length === 1 ? { id: (closest[0] as (typeof closest)[number]).id, tied: false } : { id: null, tied: closest.length > 1 };
  }

  it("get the suggestion the decision gives, and the generated households offer some, withhold some and tie some", () => {
    let offered = 0;
    let withheld = 0;
    let ties = 0;
    fc.assert(
      fc.property(withWaiting, ({ facts }) => {
        for (const item of needsYouItems(facts)) {
          const { id, tied } = plainMatch(facts, item.transaction);
          expect(item.suggestion?.kind === "contribution" ? item.suggestion.agreementId : null).toBe(id);
          if (id === null) withheld += 1;
          else offered += 1;
          if (tied) ties += 1;
        }
      }),
      run,
    );
    expect([offered, withheld, ties].every((n) => n > 0), `offered ${offered}, withheld ${withheld}, tied ${ties}`).toBe(true);
  });

  it("can always be accepted, and the payment then names the agreement", () => {
    let accepted = 0;
    fc.assert(
      fc.property(withWaiting, ({ facts }) => {
        const later = localDate("2030-01-01");
        for (const item of needsYouItems(facts)) {
          if (item.suggestion?.kind !== "contribution") continue;
          const done = apply(facts, item.suggestion.command, { asOf: later });
          if (!done.ok) throw new Error(`Refused: ${done.refusal.code}`);
          const before = checkFacts(facts).length;
          expect(checkFacts(done.facts).length).toBeLessThanOrEqual(before);
          const linked = done.facts.transactions.get(item.transaction.id)?.treatment;
          expect(linked).toMatchObject({ kind: "income", source: "contribution", agreement: item.suggestion.agreementId });
          accepted += 1;
        }
      }),
      run,
    );
    expect(accepted).toBeGreaterThan(0);
  });
});
