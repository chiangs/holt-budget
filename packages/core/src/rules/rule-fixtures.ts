/** Builders for the tests of rules, suggestions and the plan start. Synthetic data only. */

import type { Facts, Rule, RuleMatch, RuleOrigin, RuleResult, Transaction } from "../facts.ts";
import { type TransactionId, ruleId } from "../ids.ts";
import { testId } from "../testing/facts-builder.ts";

export interface RuleSpec {
  readonly n: number;
  readonly counterparty: string;
  readonly result: RuleResult;
  readonly accountId?: RuleMatch["accountId"];
  readonly min?: RuleMatch["min"];
  readonly max?: RuleMatch["max"];
  readonly priority?: number;
  readonly origin?: RuleOrigin;
}

/** A rule whose ID is made from `n`, so rules sort by `n` when their priorities tie. */
export function ruleOf(spec: RuleSpec): Rule {
  const match: RuleMatch = {
    counterparty: spec.counterparty,
    ...(spec.accountId === undefined ? {} : { accountId: spec.accountId }),
    ...(spec.min === undefined ? {} : { min: spec.min }),
    ...(spec.max === undefined ? {} : { max: spec.max }),
  };
  return { id: ruleId(testId(700_000 + spec.n)), match, result: spec.result, origin: spec.origin ?? "set", priority: spec.priority ?? 0 };
}

export function withRules(facts: Facts, ...rules: readonly Rule[]): Facts {
  return { ...facts, rules: new Map([...facts.rules, ...rules.map((r): [Rule["id"], Rule] => [r.id, r])]) };
}

/** The same facts with fields set on one transaction, such as its counterparty. */
export function withTransaction(facts: Facts, id: TransactionId, fields: Partial<Omit<Transaction, "id">>): Facts {
  const row = facts.transactions.get(id);
  if (row === undefined) throw new Error(`No transaction ${id}`);
  return { ...facts, transactions: new Map([...facts.transactions, [id, { ...row, ...fields }]]) };
}
