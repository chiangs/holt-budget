/**
 * What the family typed becomes a command, or a reason it can't. An amount is read by core's `parseMoney`
 * (through the same reader the split editor uses), so no float ever stands for money, and the amount typed
 * is the amount assigned: nothing here rounds, scales or fixes it.
 */

import { type Currency, type FamilyCommand, type JobId, type Money, type Month, money } from "@holt/core";
import { parseAmountText } from "../transactions/SplitEditor.model.ts";

export type AmountProblem =
  /** The text isn't an amount. */
  | "notAnAmount"
  /** A minus sign: an assignment is never negative. */
  | "negative";

export type AssignEdit =
  | { readonly kind: "unchanged" }
  | { readonly kind: "invalid"; readonly problem: AmountProblem }
  | { readonly kind: "assign"; readonly amount: Money; readonly command: Extract<FamilyCommand, { kind: "assign" }> };

/** An amount the family typed, or the reason it isn't one. The word for a missing amount is "notAnAmount". */
export function readAmount(text: string, code: Currency): { readonly kind: "amount"; readonly amount: Money } | { readonly kind: "invalid"; readonly problem: AmountProblem } {
  const amount = parseAmountText(text, code);
  if (amount === null) return { kind: "invalid", problem: "notAnAmount" };
  if (amount < 0) return { kind: "invalid", problem: "negative" };
  return { kind: "amount", amount };
}

/** Typing an amount over a job's assigned amount. The same amount, or the same text typed again, changes nothing and records nothing. */
export function planAssignEdit(text: string, args: { readonly month: Month; readonly jobId: JobId; readonly current: Money; readonly currency: Currency }): AssignEdit {
  const read = readAmount(text, args.currency);
  if (read.kind === "invalid") return read;
  if (read.amount === args.current) return { kind: "unchanged" };
  return { kind: "assign", amount: read.amount, command: { kind: "assign", month: args.month, jobId: args.jobId, amount: read.amount } };
}

export type MoveDestination = { readonly kind: "job"; readonly jobId: JobId } | { readonly kind: "unassigned" };

export interface MoveForm {
  readonly from: JobId | null;
  readonly to: MoveDestination | null;
  readonly amountText: string;
}

export type MoveProblem = "chooseFrom" | "chooseTo" | "sameJob" | AmountProblem | "notAbove" | "tooMuch";

export type MovePlan =
  | { readonly kind: "problem"; readonly problem: MoveProblem }
  | { readonly kind: "move"; readonly amount: Money; readonly command: FamilyCommand };

/**
 * Money moves from one job's assignment to another's, or from a job back to unassigned (which is how the family
 * brings an over-assigned month back to zero). The family can't move more than the job has assigned.
 */
export function planMove(form: MoveForm, args: { readonly month: Month; readonly currency: Currency; readonly assignedOf: (jobId: JobId) => Money }): MovePlan {
  if (form.from === null) return { kind: "problem", problem: "chooseFrom" };
  if (form.to === null) return { kind: "problem", problem: "chooseTo" };
  if (form.to.kind === "job" && form.to.jobId === form.from) return { kind: "problem", problem: "sameJob" };
  const read = readAmount(form.amountText, args.currency);
  if (read.kind === "invalid") return { kind: "problem", problem: read.problem };
  if (read.amount === 0) return { kind: "problem", problem: "notAbove" };
  const available = args.assignedOf(form.from);
  if (read.amount > available) return { kind: "problem", problem: "tooMuch" };
  const { amount } = read;
  const command: FamilyCommand =
    form.to.kind === "job"
      ? { kind: "moveAssignment", month: args.month, from: form.from, to: form.to.jobId, amount }
      : { kind: "assign", month: args.month, jobId: form.from, amount: money(available - amount) };
  return { kind: "move", amount, command };
}
