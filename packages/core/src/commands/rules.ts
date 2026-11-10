/**
 * Rules for sorting transactions, and the plan start (decision 0047). A rule is the family's standing
 * approval: `planImport` applies the best matching rule to each new transaction.
 */

import { type Month, monthOf } from "../dates.ts";
import { type Facts, type Rule, type RuleMatch, type RuleResult, type Transaction, type Treatment, householdOf } from "../facts.ts";
import type { JobId, RuleId, TransactionId } from "../ids.ts";
import { counterpartyKey } from "../rules/resolve.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { type Outcome, type RefusalCode, patched, refuse } from "./refusal.ts";

export interface RuleChanges {
  readonly match?: RuleMatch;
  readonly result?: RuleResult;
  readonly priority?: number;
}

export type RuleCommand =
  | { readonly kind: "addRule"; readonly rule: Rule }
  | { readonly kind: "changeRule"; readonly ruleId: RuleId; readonly changes: RuleChanges }
  | { readonly kind: "deleteRule"; readonly ruleId: RuleId }
  /** Moves the plan start and reclassifies transactions: those before it become history, those from it on stop being history. Refused once a month has been opened. */
  | { readonly kind: "setPlanStart"; readonly planStart: Month };

/** Why a rule can't be stored, or null when it can. A rule never produces income or a transfer, because its result has no such kind. */
function ruleFault(facts: Facts, rule: Rule): Exclude<RefusalCode, "breaksFacts"> | null {
  const { match, result } = rule;
  if (counterpartyKey(match.counterparty) === "") return "ruleCounterpartyMissing";
  if (match.min !== undefined && match.max !== undefined && match.min > match.max) return "ruleRangeBackwards";
  if (result.kind === "split" && result.shares.some((share) => !Number.isSafeInteger(share.weight) || share.weight <= 0)) return "ruleWeightNotPositive";
  const jobs = result.kind === "job" ? [result.jobId] : result.shares.map((share) => share.jobId);
  if (jobs.some((id) => !facts.jobs.has(id))) return "jobNotFound";
  if (match.accountId !== undefined && !facts.accounts.has(match.accountId)) return "accountNotFound";
  return null;
}

function putRule(facts: Facts, rule: Rule): Outcome {
  const fault = ruleFault(facts, rule);
  return fault === null ? patched(editFacts(facts).put("rules", rule)) : refuse(fault);
}

function withoutRule({ ruleId: _gone, ...rest }: Transaction): Transaction {
  return rest;
}

/** The job a transaction keeps as history: the one job it was split to, or none. */
function jobKept(treatment: Treatment): JobId | null {
  if (treatment.kind !== "split") return null;
  const [first] = treatment.allocations;
  return first !== undefined && treatment.allocations.every((a) => a.jobId === first.jobId) ? first.jobId : null;
}

/**
 * The treatment a transaction has once the plan starts in `planStart`. Before it, a transaction is history,
 * except income that funds a month from the plan start on (decision 6). From it on, history waits in needs you.
 */
function reclassified(transaction: Transaction, planStart: Month): Treatment {
  const { treatment } = transaction;
  if (monthOf(transaction.bookingDate) >= planStart) return treatment.kind === "history" ? { kind: "needsYou" } : treatment;
  if (treatment.kind === "history" || (treatment.kind === "income" && treatment.fundsMonth >= planStart)) return treatment;
  return { kind: "history", jobId: jobKept(treatment) };
}

export const ruleHandlers: Handlers<RuleCommand> = {
  addRule(facts, { rule }) {
    return facts.rules.has(rule.id) ? refuse("idTaken") : putRule(facts, rule);
  },

  changeRule(facts, { ruleId, changes }) {
    const rule = facts.rules.get(ruleId);
    if (rule === undefined) return refuse("ruleNotFound");
    return putRule(facts, { ...rule, match: changes.match ?? rule.match, result: changes.result ?? rule.result, priority: changes.priority ?? rule.priority });
  },

  deleteRule(facts, { ruleId }) {
    if (!facts.rules.has(ruleId)) return refuse("ruleNotFound");
    const editor = editFacts(facts).remove("rules", ruleId);
    for (const t of facts.transactions.values()) {
      if (t.ruleId === ruleId) editor.put("transactions", withoutRule(t));
    }
    return patched(editor);
  },

  setPlanStart(facts, { planStart }) {
    if (facts.budgetMonths.size > 0) return refuse("planStartMonthOpened");
    const household = householdOf(facts);
    const changed = new Map<TransactionId, Transaction>();
    for (const t of facts.transactions.values()) {
      const treatment = reclassified(t, planStart);
      if (treatment !== t.treatment) changed.set(t.id, { ...t, treatment });
    }
    for (const [id, now] of [...changed]) {
      const was = facts.transactions.get(id)?.treatment;
      if (was?.kind !== "transfer" || was.partner === null || now.treatment.kind === "transfer") continue;
      const partner = changed.get(was.partner) ?? facts.transactions.get(was.partner);
      if (partner?.treatment.kind === "transfer" && partner.treatment.partner === id) {
        changed.set(partner.id, { ...partner, treatment: { kind: "transfer", partner: null } });
      }
    }
    const editor = editFacts(facts).put("household", { ...household, planStart });
    for (const t of changed.values()) editor.put("transactions", t);
    return patched(editor);
  },
};
