/**
 * Transactions and their treatments (rule 3; decision 10). Before the plan start a transaction is history;
 * from the plan start on it never is, so it waits in "needs you" until the family gives it a treatment.
 * Importing, matching and rules arrive in Milestone 3 and record transactions through these commands.
 */

import { type Allocation, type Facts, type Transaction, type Treatment, householdOf, makeSplit } from "../facts.ts";
import type { RuleId, TransactionId } from "../ids.ts";
import { MoneyError } from "../money.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { planStartFault } from "./check-facts.ts";
import { type Outcome, patched, refuse } from "./refusal.ts";

/**
 * A treatment as a command carries it. A split is plain data here, because a command crosses the bridge and
 * a branded `Split` can only be built from the transaction's amount. The handler builds it with `makeSplit`
 * and refuses allocations that don't add up (rule 3). A stored `Treatment` is also a valid input.
 */
export type TreatmentInput = Exclude<Treatment, { readonly kind: "split" }> | { readonly kind: "split"; readonly allocations: readonly [Allocation, ...Allocation[]] };

export type TransactionCommand =
  | { readonly kind: "recordTransaction"; readonly transaction: Omit<Transaction, "treatment"> & { readonly treatment: TreatmentInput } }
  /** `ruleId` names the rule that gave this treatment, so the screen can say which rule applied. Without it the transaction no longer names a rule: the family decided. */
  | { readonly kind: "setTreatment"; readonly transactionId: TransactionId; readonly treatment: TreatmentInput; readonly ruleId?: RuleId }
  /** An empty note removes it. */
  | { readonly kind: "setNote"; readonly transactionId: TransactionId; readonly note: string };

/** The stored treatment for an input, or null when a split's allocations don't add up. */
export function treatmentFor(input: TreatmentInput, amount: Transaction["amount"]): Treatment | null {
  if (input.kind !== "split") return input;
  try {
    return makeSplit(amount, input.allocations);
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

function put(facts: Facts, transaction: Transaction): Outcome {
  const fault = planStartFault(transaction, householdOf(facts).planStart);
  return fault === null ? patched(editFacts(facts).put("transactions", transaction)) : refuse(fault);
}

export const transactionHandlers: Handlers<TransactionCommand> = {
  recordTransaction(facts, { transaction }) {
    if (facts.transactions.has(transaction.id)) return refuse("idTaken");
    const treatment = treatmentFor(transaction.treatment, transaction.amount);
    if (treatment === null) return refuse("splitDoesNotAddUp");
    return put(facts, { ...transaction, treatment });
  },

  setTreatment(facts, { transactionId, treatment, ruleId }) {
    const transaction = facts.transactions.get(transactionId);
    if (transaction === undefined) return refuse("transactionNotFound");
    const stored = treatmentFor(treatment, transaction.amount);
    if (stored === null) return refuse("splitDoesNotAddUp");
    const { ruleId: _previous, ...rest } = transaction;
    return put(facts, { ...rest, treatment: stored, ...(ruleId === undefined ? {} : { ruleId }) });
  },

  setNote(facts, { transactionId, note }) {
    const transaction = facts.transactions.get(transactionId);
    if (transaction === undefined) return refuse("transactionNotFound");
    const { note: _old, ...rest } = transaction;
    const trimmed = note.trim();
    return patched(editFacts(facts).put("transactions", trimmed === "" ? rest : { ...rest, note: trimmed }));
  },
};
