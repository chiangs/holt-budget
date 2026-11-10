/**
 * The structural invariants of the facts, in one place. `apply` runs this on a command's result and refuses
 * the command if it adds a violation the facts didn't already have, so facts that were sound stay sound.
 * Facts from outside (a database row, a test) may already break some of these; a command is never blamed
 * for those.
 */

import { type Month, monthOf } from "../dates.ts";
import { type Facts, type TableName, type Transaction, householdOf } from "../facts.ts";
import { jobAmounts } from "./jobs.ts";

export type ViolationCode =
  /** A row refers to a row that doesn't exist. */
  | "missingReference"
  | "noBuffer"
  | "moreThanOneBuffer"
  /** The buffer's target follows the plan (buffer months), and only the buffer's does. */
  | "bufferTarget"
  /** Months before the plan start have no state (decision 10). */
  | "budgetMonthBeforePlanStart"
  | "assignmentBeforePlanStart"
  /** Planned months show projections, never assignments (decision 12). */
  | "assignmentInPlannedMonth"
  /** Rule 3 and decision 10: a transaction from the plan start on is never history. */
  | "historyFromPlanStart"
  /** Rule 3 and decision 10: a transaction before the plan start is history, unless it is income that funds a month from the plan start on (decision 6 of 0047). */
  | "notHistoryBeforePlanStart"
  /** Rule 3: a split's allocations add up to the transaction exactly. */
  | "splitDoesNotAddUp"
  /** A pay-into job pays into an account the household pays into. */
  | "payIntoNotPaidInto"
  /** An evened-out spend job keeps its money (decision 6). */
  | "evenOutKeepsMoney"
  /** Rule 1: money is a safe integer of minor units. */
  | "notWholeMoney";

export interface Violation {
  readonly code: ViolationCode;
  readonly table: TableName;
  /** The row's key, or "" for a rule about the whole table. */
  readonly key: string;
  /** The field at fault, when there is one. */
  readonly field?: string;
}

/** Two violations are the same when this matches, so a command is refused only for what it adds. */
export function violationIdentity(v: Violation): string {
  return `${v.code}\u0000${v.table}\u0000${v.key}\u0000${v.field ?? ""}`;
}

/**
 * Rule 3 and decision 10, for a transaction's treatment against the plan start. Null when it fits. Income
 * booked before the plan start keeps its treatment when it funds a month from the plan start on, so October's
 * contributions can fund a plan that starts in November.
 */
export function planStartFault(transaction: Pick<Transaction, "bookingDate" | "treatment">, planStart: Month): "historyFromPlanStart" | "notHistoryBeforePlanStart" | null {
  const { treatment } = transaction;
  if (monthOf(transaction.bookingDate) >= planStart) return treatment.kind === "history" ? "historyFromPlanStart" : null;
  const fundsPlan = treatment.kind === "income" && treatment.fundsMonth >= planStart;
  return treatment.kind === "history" || fundsPlan ? null : "notHistoryBeforePlanStart";
}

export function checkFacts(facts: Facts): Violation[] {
  const violations: Violation[] = [];
  const planStart = householdOf(facts).planStart;

  const flag = (code: ViolationCode, table: TableName, key: string, field?: string): void => {
    violations.push(field === undefined ? { code, table, key } : { code, table, key, field });
  };
  const whole = (table: TableName, key: string, field: string, amount: number): void => {
    if (!Number.isSafeInteger(amount)) flag("notWholeMoney", table, key, field);
  };
  const exists = (table: TableName, key: string): boolean => (facts[table] as ReadonlyMap<string, unknown>).has(key);
  const refers = (table: TableName, key: string, field: string, target: TableName, id: string): void => {
    if (!exists(target, id)) flag("missingReference", table, key, field);
  };

  for (const household of facts.household.values()) whole("household", household.id, "evenOutStep", household.evenOutStep);
  for (const account of facts.accounts.values()) whole("accounts", account.id, "openingBalance", account.openingBalance);

  const buffers: string[] = [];
  for (const job of facts.jobs.values()) {
    refers("jobs", job.id, "groupId", "groups", job.groupId);
    refers("jobs", job.id, "accountId", "accounts", job.accountId);
    for (const [field, amount] of jobAmounts(job)) whole("jobs", job.id, field, amount);
    switch (job.kind) {
      case "spend":
        if (job.plan.mode === "evenOut" && !job.keepsMoney) flag("evenOutKeepsMoney", "jobs", job.id, "keepsMoney");
        break;
      case "saveUp":
        if (job.role === "buffer") buffers.push(job.id);
        if ((job.role === "buffer") !== (job.target.kind === "bufferMonths")) flag("bufferTarget", "jobs", job.id, "target");
        break;
      case "payInto": {
        const target = facts.accounts.get(job.payInto);
        if (target === undefined) flag("missingReference", "jobs", job.id, "payInto");
        else if (target.scope !== "paidInto") flag("payIntoNotPaidInto", "jobs", job.id, "payInto");
        break;
      }
    }
  }
  if (buffers.length === 0) flag("noBuffer", "jobs", "");
  if (buffers.length > 1) for (const id of buffers) flag("moreThanOneBuffer", "jobs", id);

  for (const budgetMonth of facts.budgetMonths.values()) {
    if (budgetMonth.month < planStart) flag("budgetMonthBeforePlanStart", "budgetMonths", budgetMonth.month);
  }

  for (const [key, assignment] of facts.assignments) {
    refers("assignments", key, "jobId", "jobs", assignment.jobId);
    whole("assignments", key, "amount", assignment.amount);
    if (assignment.month < planStart) flag("assignmentBeforePlanStart", "assignments", key, "month");
    else if (!facts.budgetMonths.has(assignment.month)) flag("assignmentInPlannedMonth", "assignments", key, "month");
  }

  for (const t of facts.transactions.values()) {
    refers("transactions", t.id, "accountId", "accounts", t.accountId);
    if (t.ruleId !== undefined) refers("transactions", t.id, "ruleId", "rules", t.ruleId);
    whole("transactions", t.id, "amount", t.amount);
    const fault = planStartFault(t, planStart);
    if (fault !== null) flag(fault, "transactions", t.id, "treatment");
    const treatment = t.treatment;
    switch (treatment.kind) {
      case "split": {
        let sum = 0;
        for (const allocation of treatment.allocations) {
          whole("transactions", t.id, "allocations", allocation.amount);
          sum += allocation.amount;
        }
        if (treatment.allocations.some((a) => !exists("jobs", a.jobId))) flag("missingReference", "transactions", t.id, "allocations");
        if (sum !== t.amount) flag("splitDoesNotAddUp", "transactions", t.id, "allocations");
        break;
      }
      case "history":
        if (treatment.jobId !== null) refers("transactions", t.id, "treatment.jobId", "jobs", treatment.jobId);
        break;
      case "transfer":
        if (treatment.partner !== null) refers("transactions", t.id, "treatment.partner", "transactions", treatment.partner);
        break;
      case "income":
      case "needsYou":
        break;
    }
  }

  for (const rule of facts.rules.values()) {
    const jobs = rule.result.kind === "job" ? [rule.result.jobId] : rule.result.shares.map((share) => share.jobId);
    if (jobs.some((id) => !exists("jobs", id))) flag("missingReference", "rules", rule.id, "result");
    if (rule.match.accountId !== undefined) refers("rules", rule.id, "match.accountId", "accounts", rule.match.accountId);
  }

  for (const move of facts.moves.values()) {
    refers("moves", move.id, "from", "accounts", move.from);
    refers("moves", move.id, "to", "accounts", move.to);
    if (move.completedBy !== null) refers("moves", move.id, "completedBy", "transactions", move.completedBy);
    whole("moves", move.id, "amount", move.amount);
  }

  for (const value of facts.enteredValues.values()) {
    if (value.unit === "money") whole("enteredValues", value.id, "value", value.value);
  }

  return violations;
}

/** The violations in `after` that `before` didn't have. */
export function addedViolations(before: Facts, after: Facts): Violation[] {
  const now = checkFacts(after);
  if (now.length === 0) return now;
  const had = new Set(checkFacts(before).map(violationIdentity));
  return now.filter((v) => !had.has(violationIdentity(v)));
}
