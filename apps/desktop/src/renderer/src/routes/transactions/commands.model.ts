/**
 * The command each choice on a waiting transaction makes. The page never writes a row: it builds a core
 * command and runs it, and core refuses what breaks a rule. Amounts are the transaction's own signed minor
 * units, never typed text.
 */

import {
  type Allocation,
  type Facts,
  type FamilyCommand,
  type IncomeSource,
  type JobId,
  type LocalDate,
  type Month,
  type Move,
  type MoveId,
  type Transaction,
  type TransactionId,
  addMonths,
  monthOf,
} from "@holt/core";

/**
 * The whole amount to one job. For money out it is the cost. For money in it is a refund, a split with the
 * amount coming back, so it reduces what the job spent and is not income.
 */
export function sortToJob(transaction: Transaction, jobId: JobId): FamilyCommand {
  return { kind: "setTreatment", transactionId: transaction.id, treatment: { kind: "split", allocations: [{ jobId, amount: transaction.amount }] } };
}

export function splitAcross(transaction: Transaction, allocations: readonly [Allocation, ...Allocation[]]): FamilyCommand {
  return { kind: "setTreatment", transactionId: transaction.id, treatment: { kind: "split", allocations } };
}

/** The move at the bank still to do that this pair would complete: the same two accounts and the same amount. */
function moveCompletedBy(facts: Facts, a: Transaction, b: Transaction): MoveId | null {
  const [outgoing, incoming] = a.amount < 0 ? [a, b] : [b, a];
  const found: Move | undefined = [...facts.moves.values()]
    .filter((move) => move.status === "todo" && move.from === outgoing.accountId && move.to === incoming.accountId && move.amount === incoming.amount)
    .sort((x, y) => (x.id < y.id ? -1 : 1))[0];
  return found?.id ?? null;
}

/** A transfer with the partner the family chose, or one still waiting for its other side when none was chosen. */
export function markTransfer(facts: Facts, transaction: Transaction, partner: TransactionId | null): FamilyCommand {
  if (partner === null) return { kind: "setTreatment", transactionId: transaction.id, treatment: { kind: "transfer", partner: null } };
  const other = facts.transactions.get(partner);
  const completesMove = other === undefined ? null : moveCompletedBy(facts, transaction, other);
  return { kind: "pairTransfers", pairs: [{ a: transaction.id, b: partner, ...(completesMove === null ? {} : { completesMove }) }] };
}

export const incomeSources: readonly IncomeSource[] = ["contribution", "recurring", "other"];

/** The months money in could fund, in order: from the month before it was booked to three months after. */
export function fundsMonthChoices(bookingDate: LocalDate): readonly Month[] {
  const booked = monthOf(bookingDate);
  return [-1, 0, 1, 2, 3].map((offset) => addMonths(booked, offset));
}

/** Money in usually funds the month after it arrives (decision 1). */
export function defaultFundsMonth(bookingDate: LocalDate): Month {
  return addMonths(monthOf(bookingDate), 1);
}

export function markIncome(transaction: Transaction, fundsMonth: Month, source: IncomeSource): FamilyCommand {
  return { kind: "setTreatment", transactionId: transaction.id, treatment: { kind: "income", fundsMonth, source } };
}

/** An empty note removes the note. */
export function saveNote(transaction: Transaction, note: string): FamilyCommand {
  return { kind: "setNote", transactionId: transaction.id, note };
}
