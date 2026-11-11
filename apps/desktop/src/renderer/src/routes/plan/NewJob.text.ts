/**
 * The words of the New job flow: what is wrong with a field, where the money comes from, what the change would
 * do and what Add job did. Each takes the model's plain data and the interface language, and returns a string,
 * so every kind of problem, option and effect has its words here and a new kind fails to compile until it does.
 */

import { type Currency, type FundingOption, type Money, type Month, type Runway, type Unassigned, addMonths, money as makeMoney, monthsBetween } from "@holt/core";
import type { IntlShape } from "react-intl";
import { decimalSeparator } from "../transactions/rule.model.ts";
import type { Added } from "./NewJobBatch.model.ts";
import type { GoalNote } from "./NewJobEffects.model.ts";
import { tenthsText } from "./NewJobEffects.model.ts";
import type { Funding, Problem } from "./NewJob.model.ts";
import { monthAndYear, monthOnly } from "./PlanFormat.ts";
import { moneyText } from "./PlanStatus.ts";

function assertNever(value: never): never {
  throw new Error(`The New job flow has no words for ${JSON.stringify(value)}`);
}

/** A month the way a sentence about a run of months says it: the name alone while it is under a year from the first month, with its year after that. */
export function monthLabel(month: Month, from: Month, locale: string): string {
  return monthsBetween(from, month) < 12 ? monthOnly(month, locale) : monthAndYear(month, locale);
}

/** What is wrong with a field, in words that name what to do. `from` is the first month the job is given money. */
export function problemText(intl: IntlShape, problem: Problem, from: Month): string {
  const { field, code } = problem;
  switch (code) {
    case "nameMissing":
      return intl.formatMessage({ id: field === "accountName" ? "plan.new.problem.accountName" : "plan.new.problem.name" });
    case "groupMissing":
      return intl.formatMessage({ id: "plan.new.problem.groupMissing" });
    case "groupNameMissing":
      return intl.formatMessage({ id: "plan.new.problem.groupName" });
    case "notAnAmount":
      return intl.formatMessage({ id: "plan.new.problem.notAnAmount" });
    case "notAbove":
      return intl.formatMessage({ id: "plan.new.problem.notAbove" });
    case "readyByMissing":
      return intl.formatMessage({ id: "plan.new.problem.readyByMissing" });
    case "readyByTooEarly":
      return intl.formatMessage({ id: "plan.new.problem.readyByTooEarly" }, { from: monthAndYear(from, intl.locale) });
    case "accountMissing":
      return intl.formatMessage({ id: field === "sits" ? "plan.new.problem.sits" : field === "payInto" ? "plan.new.problem.payInto" : "plan.new.problem.paidFrom" });
    case "balanceNotAnAmount":
      return intl.formatMessage({ id: "plan.new.problem.balance" });
    case "balanceDateMissing":
      return intl.formatMessage({ id: "plan.new.problem.balanceDate" });
    case "numberBad":
      return intl.formatMessage({ id: "plan.new.problem.number" });
    case "numberTaken":
      return intl.formatMessage({ id: "plan.new.problem.numberTaken" });
    default:
      return assertNever(code);
  }
}

/** The label of a button that picks where the rest of the money comes from. */
export function optionLabel(intl: IntlShape, option: FundingOption, jobName: (id: FundingOption["moves"][number]["from"]) => string): string {
  const names = option.moves.map((move) => jobName(move.from));
  return option.kind === "split" ? intl.formatMessage({ id: "plan.new.from.split" }, { jobs: intl.formatList(names) }) : intl.formatMessage({ id: "plan.new.from.single" }, { job: names[0] ?? "" });
}

/** What the money with no job does for the job, and what is still needed from other jobs. */
export function fundingNote(intl: IntlShape, funding: Extract<Funding, { kind: "options" }>, currency: Currency): string {
  const { options } = funding;
  const money = (amount: Money) => moneyText(intl, amount, currency);
  if (options.shortfall > 0) {
    return intl.formatMessage(
      { id: "plan.new.from.short" },
      { amount: money(options.amount), available: money(makeMoney(options.unassigned + options.givable)), short: money(options.shortfall) },
    );
  }
  const rest = makeMoney(Math.max(0, options.amount - options.unassigned));
  if (rest === 0) return intl.formatMessage({ id: "plan.new.from.covered" }, { currency, unassigned: money(options.unassigned) });
  if (options.unassigned > 0) return intl.formatMessage({ id: "plan.new.from.partly" }, { currency, unassigned: money(options.unassigned), rest: money(rest) });
  return intl.formatMessage({ id: "plan.new.from.none" }, { currency, rest: money(rest) });
}

/** Why no money is taken from another job when the month can't be given any. */
export function skippedNote(intl: IntlShape, access: "projection" | "closed", month: Month, next: Month): string {
  return intl.formatMessage(
    { id: access === "projection" ? "plan.new.from.notOpen" : "plan.new.from.closed" },
    { month: monthAndYear(month, intl.locale), next: monthAndYear(next, intl.locale) },
  );
}

export function rateValue(intl: IntlShape, tenths: number | null): string {
  return tenths === null ? intl.formatMessage({ id: "plan.new.effects.noRate" }) : intl.formatMessage({ id: "plan.new.effects.percent" }, { value: tenthsText(tenths, decimalSeparator(intl.locale)) });
}

export function runwayValue(intl: IntlShape, runway: Runway): string {
  return runway.kind === "noEssentials"
    ? intl.formatMessage({ id: "plan.new.effects.runwayNone" })
    : intl.formatMessage({ id: "plan.new.effects.runwayMonths" }, { value: tenthsText(runway.tenths, decimalSeparator(intl.locale)) });
}

export function unassignedValue(intl: IntlShape, unassigned: Unassigned, currency: Currency): string {
  const amount = moneyText(intl, unassigned.amount, currency);
  return unassigned.kind === "overAssigned" ? intl.formatMessage({ id: "plan.new.effects.over" }, { amount }) : amount;
}

/** The sentence for a goal that finishes at another time. */
export function goalText(intl: IntlShape, note: GoalNote): string {
  switch (note.kind) {
    case "later":
    case "earlier": {
      const ready = monthAndYear(note.ready, intl.locale);
      if (note.buffer !== null) {
        return intl.formatMessage({ id: note.kind === "later" ? "plan.new.effects.laterBuffer" : "plan.new.effects.earlierBuffer" }, { buffer: note.buffer, months: note.months, ready });
      }
      return intl.formatMessage({ id: note.kind === "later" ? "plan.new.effects.later" : "plan.new.effects.earlier" }, { name: note.name, months: note.months, ready });
    }
    case "gainsDate":
      return intl.formatMessage({ id: "plan.new.effects.gainsDate" }, { name: note.name, ready: monthAndYear(note.ready, intl.locale) });
    case "losesDate":
      return intl.formatMessage({ id: "plan.new.effects.losesDate" }, { name: note.name });
    default:
      return assertNever(note);
  }
}

/** What Add job did, as the confirmation says it: the job, where it sits and where the rest of its money came from. */
export function addedText(intl: IntlShape, added: Added, currency: Currency): string {
  const money = (amount: Money) => moneyText(intl, amount, currency);
  const from = monthOnly(added.from, intl.locale);
  const lead =
    added.target === null
      ? intl.formatMessage({ id: "plan.new.done.lead" }, { name: added.name, monthly: money(added.first), from })
      : intl.formatMessage(
          { id: "plan.new.done.leadTarget" },
          { name: added.name, monthly: money(added.first), from, target: money(added.target.amount), by: monthLabel(added.target.by, added.from, intl.locale) },
        );
  const { place } = added;
  const where =
    place.kind === "bucket"
      ? intl.formatMessage({ id: "plan.new.done.bucket" }, { account: place.account })
      : place.kind === "ownAccount"
        ? intl.formatMessage({ id: "plan.new.done.own" }, { account: place.account })
        : place.kind === "paidFrom"
          ? intl.formatMessage({ id: "plan.new.done.paidFrom" }, { account: place.account })
          : intl.formatMessage({ id: place.added ? "plan.new.done.paysIntoNew" : "plan.new.done.paysInto" }, { account: place.account });
  const took =
    added.took === null
      ? null
      : intl.formatMessage({ id: added.took.equally ? "plan.new.done.tookEqually" : "plan.new.done.took" }, { jobs: intl.formatList(added.took.jobs) });
  const start =
    added.start === "now"
      ? null
      : intl.formatMessage(
          { id: added.start === "whenOpen" ? "plan.new.done.whenOpen" : "plan.new.done.nextMonth" },
          { month: monthOnly(added.start === "whenOpen" ? added.from : addMonths(added.from, -1), intl.locale), next: from },
        );
  return [lead, where, took, start].filter((part): part is string => part !== null).join(" ");
}
