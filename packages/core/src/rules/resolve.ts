/**
 * Which rule applies to a transaction, and what it gives (decision 0047). A rule is the family's standing
 * approval, so the same facts always give the same rule, whatever order the rules are held in.
 */

import type { TreatmentInput } from "../commands/transactions.ts";
import type { Allocation, Rule, RuleShare } from "../facts.ts";
import type { AccountId } from "../ids.ts";
import { type Money, money } from "../money.ts";

/** What a rule is compared with: the facts of a transaction that matter to a match. */
export interface RuleProbe {
  readonly accountId: AccountId;
  /** The transaction's cleaned counterparty, when it has one. */
  readonly counterparty?: string | undefined;
  readonly amount: Money;
}

/** Two names are the same counterparty when they differ only by case or by whitespace around them. */
export function counterpartyKey(name: string): string {
  return name.trim().toLowerCase();
}

function matches(rule: Rule, probe: RuleProbe, key: string): boolean {
  const { counterparty, accountId, min, max } = rule.match;
  if (counterpartyKey(counterparty) !== key) return false;
  if (accountId !== undefined && accountId !== probe.accountId) return false;
  if (min !== undefined && probe.amount < min) return false;
  if (max !== undefined && probe.amount > max) return false;
  return true;
}

function best(rules: Iterable<Rule>, probe: RuleProbe, key: string): Rule | null {
  let winner: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule, probe, key)) continue;
    if (winner === null || rule.priority > winner.priority || (rule.priority === winner.priority && rule.id < winner.id)) winner = rule;
  }
  return winner;
}

/** The highest priority rule whose every field matches, ties going to the smaller ID (decision 0047). */
export function resolveRule(rules: Iterable<Rule>, probe: RuleProbe): Rule | null {
  if (probe.counterparty === undefined) return null;
  return best(rules, probe, counterpartyKey(probe.counterparty));
}

/**
 * `resolveRule` for many probes against the same rules: the rules are sorted by counterparty once, so a
 * probe is compared only with the rules for its own counterparty, not with every rule.
 */
export function ruleResolver(rules: Iterable<Rule>): (probe: RuleProbe) => Rule | null {
  const byCounterparty = new Map<string, Rule[]>();
  for (const rule of rules) {
    const key = counterpartyKey(rule.match.counterparty);
    const list = byCounterparty.get(key);
    if (list === undefined) byCounterparty.set(key, [rule]);
    else list.push(rule);
  }
  if (byCounterparty.size === 0) return () => null;
  return (probe) => {
    if (probe.counterparty === undefined) return null;
    const key = counterpartyKey(probe.counterparty);
    const list = byCounterparty.get(key);
    return list === undefined ? null : best(list, probe, key);
  };
}

type Shares = readonly [RuleShare, ...RuleShare[]];

/**
 * Divide an amount between shares by whole weights so the parts add up to the amount exactly (rule 3).
 * Each part is rounded down, then the units left over go one each to the shares with the largest
 * remainders, the first share winning ties. Every part has the amount's sign. The sums run in BigInt,
 * because an amount times a weight can pass the safe integers.
 */
export function splitByWeights(amount: Money, shares: Shares): readonly [Allocation, ...Allocation[]] {
  const total = shares.reduce((sum, share) => sum + BigInt(share.weight), 0n);
  const whole = BigInt(Math.abs(amount));
  const parts = shares.map((share, index) => {
    const scaled = whole * BigInt(share.weight);
    return { index, floor: scaled / total, remainder: scaled % total };
  });
  const left = Number(whole - parts.reduce((sum, part) => sum + part.floor, 0n));
  const byRemainder = [...parts].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const rounded = new Set(byRemainder.slice(0, left).map((part) => part.index));
  const sign = amount < 0 ? -1 : 1;
  const allocation = (share: RuleShare, index: number): Allocation => ({
    jobId: share.jobId,
    amount: money(sign * (Number(parts[index]?.floor ?? 0n) + (rounded.has(index) ? 1 : 0))),
  });
  const [first, ...rest] = shares;
  return [allocation(first, 0), ...rest.map((share, i) => allocation(share, i + 1))];
}

/** The treatment a rule gives a transaction of this amount. It is always a split: a rule never produces income or a transfer (decision 0047, item 10). */
export function treatmentOfRule(rule: Rule, amount: Money): TreatmentInput {
  const { result } = rule;
  if (result.kind === "job") return { kind: "split", allocations: [{ jobId: result.jobId, amount }] };
  return { kind: "split", allocations: splitByWeights(amount, result.shares) };
}
