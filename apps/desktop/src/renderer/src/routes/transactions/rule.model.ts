/**
 * "Always do this": the rule a decision would make, and the one change that makes it. The rule matches the
 * payee, optionally one account and an amount range, and gives one job or a split. It is limited to the
 * direction of the transaction it comes from, so a rule for a purchase doesn't swallow a refund from the same
 * shop (decision 0047, item 9). One batch adds the rule and sorts this transaction, and the others the rule
 * matches when the family asks, so the whole thing is one change with one undo.
 */

import {
  type Currency,
  type FamilyCommand,
  type Facts,
  type JobId,
  type Money,
  MoneyError,
  type Rule,
  type RuleId,
  type RuleMatch,
  type RuleOrigin,
  type RuleResult,
  maxBatchCommands,
  money,
  parseMoney,
  resolveRule,
  treatmentOfRule,
} from "@holt/core";
import type { NeedsYouRow } from "./needsYou.model.ts";

export type RuleResultChoice =
  | { readonly kind: "job"; readonly jobId: JobId | null }
  /** The same jobs in the same proportions as the suggestion, for a payment that always covers several things. */
  | { readonly kind: "sameSplit" };

export interface RuleForm {
  readonly result: RuleResultChoice;
  readonly onlyThisAccount: boolean;
  /** The smallest and largest amount, as the family typed them: whole currency units, no sign. Empty means no limit. */
  readonly low: string;
  readonly high: string;
  readonly alsoSortOthers: boolean;
}

/** The suggestion's job when it is one, its split when it is several, and otherwise nothing chosen. */
export function startingForm(row: NeedsYouRow): RuleForm {
  const suggestion = row.suggestion;
  const [only] = suggestion?.jobs ?? [];
  const sameSplit = suggestion !== null && suggestion.jobs.length > 1 && suggestion.shares !== null;
  return {
    result: sameSplit ? { kind: "sameSplit" } : { kind: "job", jobId: suggestion?.jobs.length === 1 && only !== undefined ? only : null },
    onlyThisAccount: false,
    low: "",
    high: "",
    alsoSortOthers: true,
  };
}

export type RuleProblem = "chooseJob" | "badAmount" | "rangeBackwards";

export type RulePlan =
  | { readonly ok: false; readonly problem: RuleProblem }
  | { readonly ok: true; readonly rule: Rule; /** The other waiting transactions this rule would sort, in list order. */ readonly others: readonly NeedsYouRow[] };

/** A typed amount: null when empty, or "bad" when it isn't an amount of zero or more. */
function typedAmount(text: string, currency: Currency, separator: "," | "."): Money | null | "bad" {
  if (text.trim() === "") return null;
  try {
    const amount = parseMoney(text, currency, separator);
    return amount < 0 ? "bad" : amount;
  } catch (error) {
    if (error instanceof MoneyError) return "bad";
    throw error;
  }
}

/** The bounds on the signed amount. Money out is below zero, so a typed range is mirrored, and a rule always stops at the direction of its transaction. */
function signedRange(direction: NeedsYouRow["direction"], low: Money | null, high: Money | null): Pick<RuleMatch, "min" | "max"> {
  if (direction === "out") {
    return { max: money(low === null || low < 1 ? -1 : -low), ...(high === null ? {} : { min: money(-high) }) };
  }
  return { min: money(low === null || low < 1 ? 1 : low), ...(high === null ? {} : { max: high }) };
}

const sameJobs = (a: readonly JobId[], b: readonly JobId[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

/**
 * The rule the form describes for this row, or what stops it. Its origin is "learned" when the family chose
 * something other than what the app suggested, and "set" when they chose with nothing to correct. Its priority
 * is one above the best rule that already matches this transaction, so the new rule wins, and 0 otherwise.
 */
export function planRule(input: { id: RuleId; row: NeedsYouRow; rows: readonly NeedsYouRow[]; facts: Facts; form: RuleForm; currency: Currency; separator: "," | "." }): RulePlan {
  const { id, row, rows, facts, form, currency, separator } = input;
  const { transaction, suggestion } = row;
  const counterparty = transaction.counterparty;

  let result: RuleResult;
  if (form.result.kind === "job") {
    if (form.result.jobId === null) return { ok: false, problem: "chooseJob" };
    result = { kind: "job", jobId: form.result.jobId };
  } else {
    if (suggestion === null || suggestion.shares === null) return { ok: false, problem: "chooseJob" };
    result = { kind: "split", shares: suggestion.shares };
  }

  const low = typedAmount(form.low, currency, separator);
  const high = typedAmount(form.high, currency, separator);
  if (low === "bad" || high === "bad") return { ok: false, problem: "badAmount" };
  if (high !== null && (high < 1 || (low !== null && low > high))) return { ok: false, problem: "rangeBackwards" };

  const match: RuleMatch = {
    counterparty: counterparty ?? "",
    ...(form.onlyThisAccount ? { accountId: transaction.accountId } : {}),
    ...signedRange(row.direction, low, high),
  };
  const resultJobs = result.kind === "job" ? [result.jobId] : result.shares.map((share) => share.jobId);
  const corrects = suggestion !== null && suggestion.kind !== "merge" && !sameJobs(suggestion.jobs, resultJobs);
  const origin: RuleOrigin = corrects ? "learned" : "set";
  const best = resolveRule(facts.rules.values(), { accountId: transaction.accountId, counterparty, amount: transaction.amount });
  const rule: Rule = { id, match, result, origin, priority: best === null ? 0 : best.priority + 1 };

  const withRule = [...facts.rules.values(), rule];
  const others = rows.filter(
    (other) =>
      other.id !== row.id &&
      other.suggestion?.kind !== "merge" &&
      resolveRule(withRule, { accountId: other.transaction.accountId, counterparty: other.transaction.counterparty, amount: other.transaction.amount })?.id === id,
  );
  return { ok: true, rule, others };
}

/** One batch: add the rule, then sort this transaction and, if asked, the others it matches, each naming the rule. `sorted` is how many it sorts. */
export function ruleCommand(plan: Extract<RulePlan, { ok: true }>, row: NeedsYouRow, alsoSortOthers: boolean): { readonly command: FamilyCommand; readonly sorted: number } {
  const { rule, others } = plan;
  const sort = (target: NeedsYouRow): FamilyCommand => ({
    kind: "setTreatment",
    transactionId: target.id,
    treatment: treatmentOfRule(rule, target.transaction.amount),
    ruleId: rule.id,
  });
  const sorted = [row, ...(alsoSortOthers ? others : [])].slice(0, maxBatchCommands - 1);
  return { command: { kind: "batch", commands: [{ kind: "addRule", rule }, ...sorted.map(sort)] }, sorted: sorted.length };
}

/** The decimal separator the family types with, from the language. */
export function decimalSeparator(locale: string): "," | "." {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value === "," ? "," : ".";
}
