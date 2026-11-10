/**
 * What the detail panel shows and does for one transaction: where it came from, which jobs it can be given,
 * which actions make sense for it, and the core command each action sends. Money in has two readings, and
 * they must never be mixed up: a refund is a split with money coming in and reduces what a job spent, while
 * income funds a month.
 */

import {
  type Allocation,
  type Facts,
  type FamilyCommand,
  type ImportBatch,
  type ImportBatchId,
  type ImportRow,
  type IncomeSource,
  type JobId,
  type Month,
  type Transaction,
  type TransactionId,
  addMonths,
  monthOf,
} from "@holt/core";
import type { MessageId } from "../../i18n/messages.ts";
import { jobsInGroupOrder } from "./AllFilter.model.ts";
import type { PickableJob } from "./jobs.ts";

export interface Source {
  readonly rowId: ImportRow["id"];
  readonly fileName: string;
  /** The 1-based line in the file. */
  readonly line: number;
  /** ISO datetime of the import. */
  readonly importedAt: string;
}

/** The import rows that back each transaction, found once for all of them: several back one transaction when files overlap. */
export function sourcesByTransaction(rows: Iterable<ImportRow>, batches: ReadonlyMap<ImportBatchId, ImportBatch>): ReadonlyMap<TransactionId, readonly Source[]> {
  const found = new Map<TransactionId, Source[]>();
  for (const row of rows) {
    if (row.backs === null) continue;
    const batch = batches.get(row.batchId);
    if (batch === undefined || batch.undone) continue;
    const source: Source = { rowId: row.id, fileName: batch.fileName, line: row.line, importedAt: batch.importedAt };
    const list = found.get(row.backs);
    if (list === undefined) found.set(row.backs, [source]);
    else list.push(source);
  }
  for (const list of found.values()) list.sort((a, b) => (a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : a.line - b.line));
  return found;
}

/**
 * The jobs a picker offers for this transaction: the active ones, by group and name, as the Needs you picker
 * does (a paused, finished or archived job takes no new transactions), plus any job the transaction already
 * counts against, so its current job is always in the list.
 */
export function pickableJobsFor(facts: Facts, transaction: Transaction): PickableJob[] {
  const used = new Set<JobId>(transaction.treatment.kind === "split" ? transaction.treatment.allocations.map((a) => a.jobId) : []);
  if (transaction.treatment.kind === "history" && transaction.treatment.jobId !== null) used.add(transaction.treatment.jobId);
  return jobsInGroupOrder(facts, (job) => job.status === "active" || used.has(job.id));
}

export type ActionId = "changeJob" | "split" | "refund" | "income" | "transfer" | "history" | "needsYou" | "note";

/**
 * The actions for a transaction, in the order the panel lists them. Money in has no plain "change job": a job
 * for money in is a refund against it, so it gets that action and income instead.
 */
export function availableActions(transaction: Transaction): readonly ActionId[] {
  const { kind } = transaction.treatment;
  const actions: ActionId[] = transaction.amount > 0 ? ["refund", "split", "income"] : ["changeJob", "split"];
  actions.push("transfer");
  if (kind !== "history") actions.push("history");
  if (kind !== "needsYou") actions.push("needsYou");
  actions.push("note");
  return actions;
}

/** The label of an action, which depends on what the transaction is now: "Choose a job" for one that waits, "Change job" for one that has a job. */
export function actionLabel(action: ActionId, transaction: Transaction): MessageId {
  const { kind } = transaction.treatment;
  switch (action) {
    case "changeJob":
      return kind === "split" ? "browse.action.changeJob" : "browse.action.chooseJob";
    case "split":
      return kind === "split" && transaction.treatment.allocations.length > 1 ? "browse.action.changeSplit" : "browse.action.split";
    case "refund":
      return kind === "split" ? "browse.action.changeRefund" : "browse.action.refund";
    case "income":
      return kind === "income" ? "browse.action.changeIncome" : "browse.action.income";
    case "transfer":
      return kind === "transfer" ? "browse.action.changePartner" : "browse.action.transfer";
    case "history":
      return "browse.action.history";
    case "needsYou":
      return "browse.action.needsYou";
    case "note":
      return transaction.note === undefined ? "browse.action.addNote" : "browse.action.editNote";
  }
}

const setTreatment = (transaction: Transaction, treatment: Extract<FamilyCommand, { kind: "setTreatment" }>["treatment"]): FamilyCommand => ({ kind: "setTreatment", transactionId: transaction.id, treatment });

/** The whole amount counts against one job. */
export function jobCommand(transaction: Transaction, jobId: JobId): FamilyCommand {
  return setTreatment(transaction, { kind: "split", allocations: [{ jobId, amount: transaction.amount }] });
}

/** Money in against a job: a split with money coming in, never income. Null for money out. */
export function refundCommand(transaction: Transaction, jobId: JobId): FamilyCommand | null {
  return transaction.amount > 0 ? jobCommand(transaction, jobId) : null;
}

export function splitCommand(transaction: Transaction, allocations: readonly [Allocation, ...Allocation[]]): FamilyCommand {
  return setTreatment(transaction, { kind: "split", allocations });
}

/** Money in that funds a month. Null for money out. */
export function incomeCommand(transaction: Transaction, fundsMonth: Month, source: IncomeSource): FamilyCommand | null {
  return transaction.amount > 0 ? setTreatment(transaction, { kind: "income", fundsMonth, source }) : null;
}

/** Before the plan start. It keeps the one job it has, so the estimates can still use it. */
export function historyCommand(transaction: Transaction): FamilyCommand {
  const { treatment } = transaction;
  const jobId = treatment.kind === "history" ? treatment.jobId : treatment.kind === "split" && treatment.allocations.length === 1 ? treatment.allocations[0].jobId : null;
  return setTreatment(transaction, { kind: "history", jobId });
}

export function needsYouCommand(transaction: Transaction): FamilyCommand {
  return setTreatment(transaction, { kind: "needsYou" });
}

/** An empty note removes it. */
export function noteCommand(transaction: Transaction, note: string): FamilyCommand {
  return { kind: "setNote", transactionId: transaction.id, note };
}

/** The month income usually funds is the one after it arrives (decision 1). */
export function defaultFundsMonth(transaction: Pick<Transaction, "bookingDate">): Month {
  return addMonths(monthOf(transaction.bookingDate), 1);
}

/** The months the family can pick for income: two before the booking month to three after, so a late contribution can fund the month it was meant for. */
export function fundsMonthChoices(transaction: Pick<Transaction, "bookingDate">): readonly Month[] {
  const booked = monthOf(transaction.bookingDate);
  return [-2, -1, 0, 1, 2, 3].map((offset) => addMonths(booked, offset));
}
