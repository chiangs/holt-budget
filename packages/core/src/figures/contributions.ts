/**
 * Who pays into the household, and whether it arrived (decision record 0048, "Definitions"). A status is a
 * record, not a judgement: it says what the facts show for one agreement and one month the money funds.
 * Only an income transaction that names the agreement counts toward it, so a contribution the family has not
 * yet linked is real money in the account but is not matched here.
 *
 * Expected income is what the agreements still wait for. It is never part of money available, which counts
 * only what has arrived (rule 4).
 */

import { type LocalDate, type Month, addDays, addMonths, monthOf, monthRange } from "../dates.ts";
import { type ContributionAgreement, type Facts, type Transaction, householdOf } from "../facts.ts";
import type { AccountId, AgreementId, PersonId, TransactionId } from "../ids.ts";
import { type Money, money } from "../money.ts";

/** Money counts as on time when it is booked up to this many days after the day it is expected. */
export const graceDays = 3;

/** A waiting transaction can be a contribution when it is booked within this many days of the day it is expected. */
const matchDays = 7;

const monthsBack = 2;
const monthsForward = 1;

export type ContributionState = "arrived" | "late" | "parts" | "short" | "overdue" | "expected";

export interface ContributionStatus {
  readonly agreementId: AgreementId;
  readonly personId: PersonId;
  readonly personName: string;
  readonly accountId: AccountId;
  /** The month the money funds. */
  readonly fundsMonth: Month;
  readonly state: ContributionState;
  readonly agreed: Money;
  /** The linked income booked on or before today, net of any linked refund. */
  readonly arrived: Money;
  /** What the agreement still waits for: the rest of the amount for expected, overdue and short, and nothing for the other states. */
  readonly stillExpected: Money;
  /** The linked income that counts, oldest booking first. */
  readonly transactionIds: readonly TransactionId[];
  /** The latest booking date of those transactions. */
  readonly arrivedOn: LocalDate | null;
  /** Day `day` of the month before the month it funds. */
  readonly expectedOn: LocalDate;
  /** The last day it counts as on time. */
  readonly graceUntil: LocalDate;
}

export interface ExpectedIncomeMonth {
  readonly month: Month;
  /** What is still expected for the month, the sum of `contributions`. */
  readonly amount: Money;
  /** The statuses that still wait for money, in the order `contributionStatuses` lists them. */
  readonly contributions: readonly ContributionStatus[];
}

export interface MoneyInMonth {
  readonly month: Month;
  /** Income that funds the month, from any source, booked on or before today. */
  readonly actual: Money;
  /** Contributions still expected. */
  readonly expected: Money;
  readonly total: Money;
}

interface Booked {
  readonly id: TransactionId;
  readonly date: LocalDate;
  readonly amount: number;
}

type Arrivals = ReadonlyMap<AgreementId, ReadonlyMap<Month, readonly Booked[]>>;

/** The income each agreement was paid by, per funds month, booked on or before `asOf` (every booking when it is left out). */
function arrivalsOf(facts: Facts, asOf?: LocalDate): Arrivals {
  const arrivals = new Map<AgreementId, Map<Month, Booked[]>>();
  if (facts.contributionAgreements.size === 0) return arrivals;
  for (const t of facts.transactions.values()) {
    const { treatment } = t;
    if (treatment.kind !== "income" || treatment.source !== "contribution" || treatment.agreement === undefined) continue;
    if (asOf !== undefined && t.bookingDate > asOf) continue;
    let months = arrivals.get(treatment.agreement);
    if (months === undefined) {
      months = new Map();
      arrivals.set(treatment.agreement, months);
    }
    const list = months.get(treatment.fundsMonth);
    const booked: Booked = { id: t.id, date: t.bookingDate, amount: t.amount };
    if (list === undefined) months.set(treatment.fundsMonth, [booked]);
    else list.push(booked);
  }
  return arrivals;
}

const oldestFirst = (a: Booked, b: Booked): number => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1);

/** Day `agreement.day` of the month before the month the money funds. */
export function expectedDate(agreement: Pick<ContributionAgreement, "day">, fundsMonth: Month): LocalDate {
  return `${addMonths(fundsMonth, -1)}-${String(agreement.day).padStart(2, "0")}` as LocalDate;
}

function stateOf(agreed: number, total: number, count: number, arrivedOn: LocalDate | null, graceUntil: LocalDate, asOf: LocalDate): ContributionState {
  if (arrivedOn !== null && total >= agreed) {
    if (count > 1) return "parts";
    return arrivedOn <= graceUntil ? "arrived" : "late";
  }
  if (total > 0) return "short";
  return asOf > graceUntil ? "overdue" : "expected";
}

function statusOf(agreement: ContributionAgreement, personName: string, fundsMonth: Month, booked: readonly Booked[], asOf: LocalDate): ContributionStatus {
  const expectedOn = expectedDate(agreement, fundsMonth);
  const graceUntil = addDays(expectedOn, graceDays);
  const sorted = booked.length > 1 ? [...booked].sort(oldestFirst) : booked;
  const total = sorted.reduce((sum, b) => sum + b.amount, 0);
  const arrivedOn = sorted.at(-1)?.date ?? null;
  const state = stateOf(agreement.amount, total, sorted.length, arrivedOn, graceUntil, asOf);
  const waiting = state === "expected" || state === "overdue" || state === "short";
  return {
    agreementId: agreement.id,
    personId: agreement.personId,
    personName,
    accountId: agreement.accountId,
    fundsMonth,
    state,
    agreed: agreement.amount,
    arrived: money(total),
    stillExpected: money(waiting ? Math.max(0, agreement.amount - total) : 0),
    transactionIds: sorted.map((b) => b.id),
    arrivedOn,
    expectedOn,
    graceUntil,
  };
}

function byMonthPersonAgreement(a: ContributionStatus, b: ContributionStatus): number {
  if (a.fundsMonth !== b.fundsMonth) return a.fundsMonth < b.fundsMonth ? -1 : 1;
  if (a.personName !== b.personName) return a.personName < b.personName ? -1 : 1;
  return a.agreementId < b.agreementId ? -1 : a.agreementId > b.agreementId ? 1 : 0;
}

/** A funds month the plan has started and the agreement covers. */
function covers(agreement: ContributionAgreement, m: Month, planStart: Month): boolean {
  return m >= planStart && m >= agreement.from && (agreement.to === undefined || m <= agreement.to);
}

function statusesFor(facts: Facts, asOf: LocalDate, months: readonly Month[]): ContributionStatus[] {
  const { planStart } = householdOf(facts);
  const arrivals = arrivalsOf(facts, asOf);
  const statuses: ContributionStatus[] = [];
  for (const agreement of facts.contributionAgreements.values()) {
    const personName = facts.people.get(agreement.personId)?.name ?? "";
    const paid = arrivals.get(agreement.id);
    for (const m of months) {
      if (covers(agreement, m, planStart)) statuses.push(statusOf(agreement, personName, m, paid?.get(m) ?? [], asOf));
    }
  }
  return statuses.sort(byMonthPersonAgreement);
}

/**
 * A status for every agreement in each month it funds, from two months before the current month to one
 * after it: the money that arrives this month funds next month. Ordered by the month, then the person's
 * name, then the agreement.
 */
export function contributionStatuses(facts: Facts, asOf: LocalDate): ContributionStatus[] {
  const current = monthOf(asOf);
  return statusesFor(facts, asOf, monthRange(addMonths(current, -monthsBack), addMonths(current, monthsForward)));
}

/**
 * What the agreements still wait for in each month from the current month to the horizon. An agreement that
 * has ended, or has not started, waits for nothing.
 */
export function expectedIncome(facts: Facts, asOf: LocalDate, horizonMonths = 12): ExpectedIncomeMonth[] {
  const current = monthOf(asOf);
  const months = monthRange(current, addMonths(current, horizonMonths));
  const waiting = statusesFor(facts, asOf, months).filter((s) => s.stillExpected > 0);
  return months.map((month) => {
    const contributions = waiting.filter((s) => s.fundsMonth === month);
    return { month, amount: money(contributions.reduce((sum, s) => sum + s.stillExpected, 0)), contributions };
  });
}

/** The money each month will have from outside, kept in the two parts it comes in: what arrived and what is expected. */
export function moneyIn(facts: Facts, asOf: LocalDate, horizonMonths = 12): MoneyInMonth[] {
  const actual = new Map<Month, number>();
  for (const t of facts.transactions.values()) {
    if (t.treatment.kind === "income" && t.bookingDate <= asOf) actual.set(t.treatment.fundsMonth, (actual.get(t.treatment.fundsMonth) ?? 0) + t.amount);
  }
  return expectedIncome(facts, asOf, horizonMonths).map(({ month, amount }) => {
    const arrived = money(actual.get(month) ?? 0);
    return { month, actual: arrived, expected: amount, total: money(arrived + amount) };
  });
}

/** The agreement a waiting transaction could be a payment of, and the month the money would fund. */
export interface ContributionMatch {
  readonly agreement: ContributionAgreement;
  readonly fundsMonth: Month;
}

interface Candidate {
  readonly agreement: ContributionAgreement;
  /** 0 when the amount is exactly what the agreement still waits for, 1 when it is a part of that. */
  readonly fit: 0 | 1;
  readonly days: number;
}

const dayOf = (date: LocalDate): number => Number(date.slice(8, 10));

/**
 * For each waiting transaction of money in, the agreement it is most likely a payment of. The money funds the
 * month after its booking month (decision 1), so it is expected on day `day` of its booking month. A
 * transaction fits an agreement of its account that covers that month when it is booked within `matchDays`
 * of the day, and when its amount is what the agreement still waits for or a part of it. That is the whole
 * agreement while nothing has arrived. A month already paid in full has nothing left to match. The closest
 * fit wins by amount first and then by day, and a tie between agreements gives no match.
 */
export function matchContributions(facts: Facts, waiting: readonly Transaction[]): ReadonlyMap<TransactionId, ContributionMatch> {
  const matches = new Map<TransactionId, ContributionMatch>();
  if (facts.contributionAgreements.size === 0) return matches;
  const { planStart } = householdOf(facts);
  const byAccount = new Map<AccountId, ContributionAgreement[]>();
  for (const agreement of facts.contributionAgreements.values()) {
    const here = byAccount.get(agreement.accountId);
    if (here === undefined) byAccount.set(agreement.accountId, [agreement]);
    else here.push(agreement);
  }
  let arrivals: Arrivals | undefined;

  for (const t of waiting) {
    const here = byAccount.get(t.accountId);
    if (here === undefined || t.amount <= 0) continue;
    const fundsMonth = addMonths(monthOf(t.bookingDate), 1);
    let best: Candidate | undefined;
    let tied = false;
    for (const agreement of here) {
      if (!covers(agreement, fundsMonth, planStart)) continue;
      const days = Math.abs(dayOf(t.bookingDate) - agreement.day);
      if (days > matchDays) continue;
      arrivals ??= arrivalsOf(facts);
      const left = agreement.amount - (arrivals.get(agreement.id)?.get(fundsMonth) ?? []).reduce((sum, b) => sum + b.amount, 0);
      if (left <= 0 || t.amount > left) continue;
      const candidate: Candidate = { agreement, fit: t.amount === left ? 0 : 1, days };
      if (best === undefined || candidate.fit < best.fit || (candidate.fit === best.fit && candidate.days < best.days)) {
        best = candidate;
        tied = false;
      } else if (candidate.fit === best.fit && candidate.days === best.days) {
        tied = true;
      }
    }
    if (best !== undefined && !tied) matches.set(t.id, { agreement: best.agreement, fundsMonth });
  }
  return matches;
}
