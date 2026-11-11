/**
 * The moves to make at the bank in a month (decision record 0048, "Moves at the bank for a month"). The
 * accounts' monthly moves are one net number each (0046): money to move in, or a surplus to move out. This
 * pairs them into concrete moves, next to the one-off moves already stored, and says which are done by
 * reading the transfers the family has imported. Holt never moves money; it only says what is left to do.
 */

import { type LocalDate, type Month, addMonths, lastDayOf, localDate } from "../dates.ts";
import type { Facts, Move, Transaction } from "../facts.ts";
import type { AccountId, TransactionId } from "../ids.ts";
import { compareIds } from "../import/matching.ts";
import { type Money, money } from "../money.ts";
import { type Figures, computeFigures } from "./index.ts";

/** A monthly move is done once imported transfers between the two accounts cover it, and partly done while they cover some of it. */
export type MonthlyMoveStatus = { readonly kind: "done" } | { readonly kind: "partlyDone"; readonly done: Money } | { readonly kind: "toDo" };

/** A one-off move's status is the one stored: marked done by an imported transfer or by the family, or skipped. */
export type OneOffMoveStatus = { readonly kind: "done" } | { readonly kind: "toDo" } | { readonly kind: "skipped" };

export interface MonthlyBankMove {
  readonly kind: "monthly";
  readonly from: AccountId;
  readonly to: AccountId;
  readonly amount: Money;
  readonly status: MonthlyMoveStatus;
}

export interface OneOffBankMove {
  readonly kind: "oneOff";
  readonly move: Move;
  readonly status: OneOffMoveStatus;
}

/** Money the pairing left where it was: a surplus with no account that needs it, or a need with no surplus to meet it. */
export interface UnmovedMoney {
  readonly accountId: AccountId;
  readonly kind: "surplus" | "moveIn";
  readonly amount: Money;
}

export interface MovesPlan {
  readonly month: Month;
  /** Largest first. */
  readonly monthly: readonly MonthlyBankMove[];
  /** The stored one-off moves of the month, in the order they were made. */
  readonly oneOff: readonly OneOffBankMove[];
  /**
   * What the monthly moves leave. A month with nothing unassigned and nothing carried in leaves nothing; money without a job
   * leaves a surplus in the account the income lands in, and an over-assigned month leaves a need.
   */
  readonly unmoved: readonly UnmovedMoney[];
}

/**
 * Which imported transfers count towards a month's monthly move: those booked from the 15th of the month before to
 * the end of the month. The money that funds November lands in October, around payday (decision 1), and the family
 * moves it on to the other accounts once it has landed, so the moves for November are made in the second half of
 * October. A window that began on 1 November would call a move made on 21 October to do all through November. A
 * window that began on 1 October would count a transfer made in the first half of October, which moved October's own
 * money (it landed in September). The 15th falls between the two, a few days before the usual paydays. It is the
 * interpretation recorded in 0048 (open question 4) for Stephen to confirm.
 */
function windowOf(m: Month): { readonly start: LocalDate; readonly end: LocalDate } {
  return { start: localDate(`${addMonths(m, -1)}-15`), end: lastDayOf(m) };
}

interface Remaining {
  readonly accountId: AccountId;
  left: number;
}

/** Largest first, so the biggest surplus meets the biggest need. The ID breaks a tie, so the same facts always give the same moves. */
function largestFirst(list: Remaining[]): Remaining[] {
  return list.sort((a, b) => b.left - a.left || compareIds(a.accountId, b.accountId));
}

/** What transfers between each ordered pair of accounts moved in the window, from the pairs the family imported. */
function transferredInWindow(facts: Facts, { start, end }: { readonly start: LocalDate; readonly end: LocalDate }, asOf: LocalDate): ReadonlyMap<string, Money> {
  const completing = new Set<TransactionId>();
  for (const move of facts.moves.values()) if (move.completedBy !== null) completing.add(move.completedBy);

  const moved = new Map<string, number>();
  for (const out of facts.transactions.values()) {
    if (out.amount >= 0 || out.treatment.kind !== "transfer" || out.treatment.partner === null) continue;
    if (out.bookingDate < start || out.bookingDate > end || out.bookingDate > asOf) continue;
    const into: Transaction | undefined = facts.transactions.get(out.treatment.partner);
    if (into?.treatment.kind !== "transfer" || into.treatment.partner !== out.id || into.amount !== -out.amount) continue;
    // A transfer that completed a one-off move is that move's, and cannot also be part of the monthly one.
    if (completing.has(out.id) || completing.has(into.id)) continue;
    const key = `${out.accountId}>${into.accountId}`;
    moved.set(key, (moved.get(key) ?? 0) + into.amount);
  }
  return new Map([...moved].map(([key, amount]) => [key, money(amount)]));
}

export function movesPlanFrom(facts: Facts, figures: Figures, month: Month): MovesPlan {
  const surpluses: Remaining[] = [];
  const needs: Remaining[] = [];
  for (const [accountId, account] of figures.accounts) {
    const move = account.monthlyMoves.get(month);
    if (move?.kind === "surplus") surpluses.push({ accountId, left: move.amount });
    if (move?.kind === "moveIn") needs.push({ accountId, left: move.amount });
  }
  largestFirst(surpluses);
  largestFirst(needs);

  const pairs: { from: AccountId; to: AccountId; amount: Money }[] = [];
  let s = 0;
  let n = 0;
  while (s < surpluses.length && n < needs.length) {
    const [from, to] = [surpluses[s] as Remaining, needs[n] as Remaining];
    const amount = Math.min(from.left, to.left);
    pairs.push({ from: from.accountId, to: to.accountId, amount: money(amount) });
    from.left -= amount;
    to.left -= amount;
    if (from.left === 0) s += 1;
    if (to.left === 0) n += 1;
  }

  const transferred = pairs.length === 0 ? new Map<string, Money>() : transferredInWindow(facts, windowOf(month), figures.asOf);
  const monthly = pairs.map(({ from, to, amount }): MonthlyBankMove => {
    const done = transferred.get(`${from}>${to}`) ?? money(0);
    return { kind: "monthly", from, to, amount, status: done >= amount ? { kind: "done" } : done > 0 ? { kind: "partlyDone", done } : { kind: "toDo" } };
  });

  const oneOff = [...facts.moves.values()]
    .filter((move) => move.month === month)
    .sort((a, b) => compareIds(a.id, b.id))
    .map((move): OneOffBankMove => ({ kind: "oneOff", move, status: { kind: move.status === "todo" ? "toDo" : move.status } }));

  const unmoved: UnmovedMoney[] = [
    ...surpluses.filter(({ left }) => left > 0).map(({ accountId, left }): UnmovedMoney => ({ accountId, kind: "surplus", amount: money(left) })),
    ...needs.filter(({ left }) => left > 0).map(({ accountId, left }): UnmovedMoney => ({ accountId, kind: "moveIn", amount: money(left) })),
  ].sort((a, b) => compareIds(a.accountId, b.accountId));

  return { month, monthly, oneOff, unmoved };
}

/** The moves to make at the bank in `month`, as of `asOf`. */
export function movesPlan(facts: Facts, month: Month, asOf: LocalDate): MovesPlan {
  return movesPlanFrom(facts, computeFigures(facts, asOf), month);
}
