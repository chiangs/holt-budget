/**
 * What the Money in panel shows. Every figure and every status comes from core (`contributionStatuses`,
 * `moneyIn`); this only chooses which of them to show and in which words. A status is a record, not a
 * judgement, so no word here blames anyone.
 *
 * The panel is for the funds month that is current: the money that funds November arrives in October, so on
 * Plan for November a contribution reads "arrived 20 Oct" and the next payday is the 20th of November.
 */

import {
  type AccountId,
  type AgreementId,
  type ContributionAgreement,
  type ContributionState,
  type ContributionStatus,
  type Facts,
  type Figures,
  type LocalDate,
  type Money,
  type Month,
  type PersonId,
  addMonths,
  contributionStatuses,
  money,
  moneyIn,
} from "@holt/core";
import type { Words } from "../transactions/ImportSay.ts";
import { planMonthOf } from "./PlanMonth.model.ts";

/** What the family reads for one contribution in one funds month. One kind for each state core gives. */
export type StatusLine =
  | { readonly kind: "arrived"; readonly on: LocalDate | null }
  | { readonly kind: "late"; readonly on: LocalDate | null }
  | { readonly kind: "parts" }
  | { readonly kind: "short"; readonly missing: Money }
  | { readonly kind: "overdue"; readonly since: LocalDate }
  | { readonly kind: "expected"; readonly on: LocalDate };

type LineOf = { readonly [S in ContributionState]: (status: ContributionStatus) => Extract<StatusLine, { readonly kind: S }> };

/** One entry for every state core gives, so a new state does not compile until it has a line. */
const lines: LineOf = {
  arrived: (s) => ({ kind: "arrived", on: s.arrivedOn }),
  late: (s) => ({ kind: "late", on: s.arrivedOn }),
  parts: () => ({ kind: "parts" }),
  short: (s) => ({ kind: "short", missing: s.stillExpected }),
  overdue: (s) => ({ kind: "overdue", since: s.expectedOn }),
  expected: (s) => ({ kind: "expected", on: s.expectedOn }),
};

export function statusLine(status: ContributionStatus): StatusLine {
  return (lines[status.state] as (status: ContributionStatus) => StatusLine)(status);
}

type WordsOf = { readonly [K in StatusLine["kind"]]: (line: Extract<StatusLine, { readonly kind: K }>) => Words };

const statusTable: WordsOf = {
  arrived: (line) => (line.on === null ? { id: "plan.money.status.arrivedNoDate" } : { id: "plan.money.status.arrived", values: { date: { day: line.on } } }),
  late: (line) => (line.on === null ? { id: "plan.money.status.lateNoDate" } : { id: "plan.money.status.late", values: { date: { day: line.on } } }),
  parts: () => ({ id: "plan.money.status.parts" }),
  short: (line) => ({ id: "plan.money.status.short", values: { amount: { money: line.missing } } }),
  overdue: (line) => ({ id: "plan.money.status.overdue", values: { date: { day: line.since } } }),
  expected: (line) => ({ id: "plan.money.status.expected", values: { date: { day: line.on } } }),
};

/** The words for a status. */
export function statusWords(line: StatusLine): Words {
  return (statusTable[line.kind] as (line: StatusLine) => Words)(line);
}

/** What the second line of a person's amount says: the next payday, or what the next month's money has done already. */
export type NextLine =
  | { readonly kind: "next"; readonly on: LocalDate }
  | { readonly kind: "later"; readonly month: Month; readonly line: StatusLine };

export function nextWords(next: NextLine): Words {
  return next.kind === "next"
    ? { id: "plan.money.next", values: { date: { day: next.on } } }
    : { id: "plan.money.nextMonth", values: { month: { month: next.month }, status: statusWords(next.line) } };
}

/** The line under a person's name: what the contribution is and where it stands. */
export function captionWords(row: Pick<PersonRow, "status" | "startsIn">): Words {
  if (row.status !== null) return { id: "plan.money.row.caption", values: { status: statusWords(row.status) } };
  if (row.startsIn !== null) return { id: "plan.money.row.caption", values: { status: { id: "plan.money.status.starts", values: { month: { month: row.startsIn } } } } };
  return { id: "plan.money.row.kind" };
}

/** Day `day` of the month before the month the money funds, the date core calls `expectedOn`. */
export function expectedOn(day: number, fundsMonth: Month): LocalDate {
  return `${addMonths(fundsMonth, -1)}-${String(day).padStart(2, "0")}` as LocalDate;
}

/** A contribution that starts after the funds month on show, or an agreement that replaces the one on show. */
export interface LaterAgreement {
  readonly agreementId: AgreementId;
  readonly from: Month;
  readonly amount: Money;
}

export interface PersonRow {
  readonly personId: PersonId;
  readonly name: string;
  readonly agreementId: AgreementId;
  readonly amount: Money;
  /** Null for a contribution that has not started yet, which says when it starts instead. */
  readonly status: StatusLine | null;
  readonly startsIn: Month | null;
  readonly next: NextLine | null;
  /** The last month the agreement funds, when it has an end. */
  readonly endsAfter: Month | null;
  /** The agreement that takes over from this one, from a later month. */
  readonly later: LaterAgreement | null;
}

export function laterWords(later: LaterAgreement): Words {
  return { id: "plan.money.laterChange", values: { month: { month: later.from }, amount: { money: later.amount } } };
}

export function endsWords(after: Month): Words {
  return { id: "plan.money.endsAfter", values: { month: { month: after } } };
}

export interface MoneyInView {
  /** The funds month the panel is about. */
  readonly month: Month;
  readonly asOf: LocalDate;
  readonly rows: readonly PersonRow[];
  /** What arrived for the month from any source, and what contributions still wait for. Kept apart, because only what arrived is money available. */
  readonly inThisMonth: { readonly actual: Money; readonly expected: Money };
}

function covers(agreement: ContributionAgreement, m: Month): boolean {
  return agreement.from <= m && (agreement.to === undefined || m <= agreement.to);
}

/** The next payday: the day of this month when it has not passed, and otherwise what the following month's money has done. The agreement that funds the following month decides, so a change of amount shows the new payday. */
function nextOf(agreements: readonly ContributionAgreement[], month: Month, statuses: ReadonlyMap<AgreementId, ReadonlyMap<Month, ContributionStatus>>): NextLine | null {
  const following = addMonths(month, 1);
  const funds = agreements.findLast((agreement) => covers(agreement, following));
  if (funds === undefined) return null;
  const status = statuses.get(funds.id)?.get(following);
  if (status === undefined) return { kind: "next", on: expectedOn(funds.day, following) };
  return status.state === "expected" ? { kind: "next", on: status.expectedOn } : { kind: "later", month: following, line: statusLine(status) };
}

export function moneyInView(facts: Facts, figures: Figures): MoneyInView | null {
  const shown = planMonthOf(facts, figures);
  if (shown === null) return null;
  const { month } = shown;
  const asOf = figures.asOf;

  const statuses = new Map<AgreementId, Map<Month, ContributionStatus>>();
  for (const status of contributionStatuses(facts, asOf)) {
    const months = statuses.get(status.agreementId) ?? new Map<Month, ContributionStatus>();
    months.set(status.fundsMonth, status);
    statuses.set(status.agreementId, months);
  }

  const byPerson = new Map<PersonId, ContributionAgreement[]>();
  for (const person of facts.people.values()) byPerson.set(person.id, []);
  for (const agreement of facts.contributionAgreements.values()) {
    const own = byPerson.get(agreement.personId);
    if (own === undefined) byPerson.set(agreement.personId, [agreement]);
    else own.push(agreement);
  }

  const rows: PersonRow[] = [];
  for (const [personId, agreements] of byPerson) {
    if (agreements.length === 0) continue;
    const name = facts.people.get(personId)?.name ?? "";
    const sorted = [...agreements].sort((a, b) => (a.from === b.from ? (a.id < b.id ? -1 : 1) : a.from < b.from ? -1 : 1));
    const current = sorted.findLast((agreement) => covers(agreement, month));
    const upcoming = sorted.find((agreement) => agreement.from > month);
    const later: LaterAgreement | null = upcoming === undefined ? null : { agreementId: upcoming.id, from: upcoming.from, amount: upcoming.amount };

    if (current !== undefined) {
      const status = statuses.get(current.id)?.get(month);
      rows.push({
        personId,
        name,
        agreementId: current.id,
        amount: current.amount,
        status: status === undefined ? null : statusLine(status),
        startsIn: null,
        next: nextOf(sorted, month, statuses),
        endsAfter: current.to === undefined || (upcoming !== undefined && addMonths(current.to, 1) === upcoming.from) ? null : current.to,
        later,
      });
    } else if (upcoming !== undefined) {
      rows.push({
        personId,
        name,
        agreementId: upcoming.id,
        amount: upcoming.amount,
        status: null,
        startsIn: upcoming.from,
        next: { kind: "next", on: expectedOn(upcoming.day, upcoming.from) },
        endsAfter: upcoming.to ?? null,
        later: null,
      });
    }
  }

  const found = moneyIn(facts, asOf).find((entry) => entry.month === month);
  return { month, asOf, rows, inThisMonth: { actual: found?.actual ?? money(0), expected: found?.expected ?? money(0) } };
}

/** An adult the family can name when it adds a contribution. */
export interface AdultChoice {
  readonly personId: PersonId;
  readonly name: string;
}

/** The adults in the order they joined the household, which is the order Money in lists them. */
export function adultsOf(facts: Facts): readonly AdultChoice[] {
  return [...facts.people.values()].filter((person) => person.kind === "adult").map((person) => ({ personId: person.id, name: person.name }));
}

export interface AccountChoice {
  readonly accountId: AccountId;
  readonly name: string;
}

/** The accounts a contribution can land in: the shared ones, in the order they were made. */
export function sharedAccountsOf(facts: Facts): readonly AccountChoice[] {
  return [...facts.accounts.values()].filter((account) => account.scope === "shared").map((account) => ({ accountId: account.id, name: account.name }));
}
