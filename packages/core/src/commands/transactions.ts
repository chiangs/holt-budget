/**
 * Transactions and their treatments (rule 3; decision 10). Before the plan start a transaction is history;
 * from the plan start on it never is, so it waits in "needs you" until the family gives it a treatment.
 * Importing, matching and rules arrive in Milestone 3 and record transactions through these commands.
 */

import { type Facts, type Transaction, type Treatment, householdOf } from "../facts.ts";
import type { TransactionId } from "../ids.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { planStartFault } from "./check-facts.ts";
import { type Outcome, patched, refuse } from "./refusal.ts";

export type TransactionCommand =
  | { readonly kind: "recordTransaction"; readonly transaction: Transaction }
  | { readonly kind: "setTreatment"; readonly transactionId: TransactionId; readonly treatment: Treatment };

function put(facts: Facts, transaction: Transaction): Outcome {
  const fault = planStartFault(transaction, householdOf(facts).planStart);
  return fault === null ? patched(editFacts(facts).put("transactions", transaction)) : refuse(fault);
}

export const transactionHandlers: Handlers<TransactionCommand> = {
  recordTransaction(facts, { transaction }) {
    if (facts.transactions.has(transaction.id)) return refuse("idTaken");
    return put(facts, transaction);
  },

  setTreatment(facts, { transactionId, treatment }) {
    const transaction = facts.transactions.get(transactionId);
    if (transaction === undefined) return refuse("transactionNotFound");
    return put(facts, { ...transaction, treatment });
  },
};
