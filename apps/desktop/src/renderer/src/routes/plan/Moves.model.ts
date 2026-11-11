/**
 * What the Moves at the bank panel shows. Core's `movesPlanFrom` decides which moves the month needs and
 * which an import has shown done; this names the accounts, finds the date an import matched, and says what
 * the family can do with each. Holt never moves money: a move is a note for the family to act on at the bank.
 */

import {
  type AccountId,
  type Currency,
  type FamilyCommand,
  type Facts,
  type Figures,
  type LocalDate,
  type Money,
  type Month,
  type MoveId,
  type MovesPlan,
  type TransactionId,
  addMonths,
  lastDayOf,
  localDate,
  movesPlanFrom,
} from "@holt/core";
import type { Words } from "../transactions/ImportSay.ts";
import { readAmount } from "./PlanEdit.model.ts";

/** How an import showed a move done. */
export type Proof =
  | { readonly kind: "import"; readonly count: number; readonly last: LocalDate | null }
  | { readonly kind: "byYou" };

export type MoveStatusLine =
  | { readonly kind: "toDo" }
  | { readonly kind: "partlyDone"; readonly done: Money; readonly of: Money }
  | { readonly kind: "done"; readonly proof: Proof }
  | { readonly kind: "skipped" };

export interface MoveRow {
  readonly key: string;
  readonly kind: "monthly" | "oneOff";
  readonly fromName: string;
  readonly toName: string;
  readonly amount: Money;
  readonly status: MoveStatusLine;
  /** Why a one-off move was made, in the family's words. */
  readonly reason: string | null;
  readonly moveId: MoveId | null;
  /** Only a one-off move still to do can be marked done or skipped: core refuses the rest. */
  readonly canAct: boolean;
}

export interface UnmovedNote {
  readonly accountId: AccountId;
  readonly accountName: string;
  readonly kind: "surplus" | "moveIn";
  readonly amount: Money;
}

export interface MovesView {
  readonly month: Month;
  readonly rows: readonly MoveRow[];
  readonly unmoved: readonly UnmovedNote[];
}

/**
 * The window core counts imported transfers in for a monthly move: the 15th of the month before to the end
 * of the month (decision 0048, E8). It is written here again only to say which date matched, and a test
 * checks it against core's own status.
 */
export function transferWindow(month: Month): { readonly start: LocalDate; readonly end: LocalDate } {
  return { start: localDate(`${addMonths(month, -1)}-15`), end: lastDayOf(month) };
}

/** The transfers an import paired between two accounts in a month's window, not counting one that completed a one-off move. */
export function matchedTransfers(facts: Facts, from: AccountId, to: AccountId, month: Month, asOf: LocalDate): { readonly count: number; readonly last: LocalDate } | null {
  const { start, end } = transferWindow(month);
  const completing = new Set<TransactionId>();
  for (const move of facts.moves.values()) if (move.completedBy !== null) completing.add(move.completedBy);
  let count = 0;
  let last: LocalDate | null = null;
  for (const out of facts.transactions.values()) {
    if (out.amount >= 0 || out.accountId !== from || out.treatment.kind !== "transfer" || out.treatment.partner === null) continue;
    if (out.bookingDate < start || out.bookingDate > end || out.bookingDate > asOf) continue;
    const into = facts.transactions.get(out.treatment.partner);
    if (into === undefined || into.accountId !== to || into.treatment.kind !== "transfer" || into.treatment.partner !== out.id || into.amount !== -out.amount) continue;
    if (completing.has(out.id) || completing.has(into.id)) continue;
    count += 1;
    if (last === null || out.bookingDate > last) last = out.bookingDate;
  }
  return last === null ? null : { count, last };
}

function rowsOf(facts: Facts, plan: MovesPlan, asOf: LocalDate): MoveRow[] {
  const name = (id: AccountId): string => facts.accounts.get(id)?.name ?? "";
  const monthly = plan.monthly.map((move): MoveRow => {
    const status: MoveStatusLine =
      move.status.kind === "done"
        ? { kind: "done", proof: { kind: "import", ...(matchedTransfers(facts, move.from, move.to, plan.month, asOf) ?? { count: 1, last: null }) } }
        : move.status.kind === "partlyDone"
          ? { kind: "partlyDone", done: move.status.done, of: move.amount }
          : { kind: "toDo" };
    return { key: `${move.from}>${move.to}`, kind: "monthly", fromName: name(move.from), toName: name(move.to), amount: move.amount, status, reason: null, moveId: null, canAct: false };
  });
  const oneOff = plan.oneOff.map((entry): MoveRow => {
    const { move } = entry;
    const status: MoveStatusLine =
      entry.status.kind === "done"
        ? {
            kind: "done",
            proof: move.completedBy === null ? { kind: "byYou" } : { kind: "import", count: 1, last: facts.transactions.get(move.completedBy)?.bookingDate ?? null },
          }
        : entry.status.kind === "skipped"
          ? { kind: "skipped" }
          : { kind: "toDo" };
    return {
      key: move.id,
      kind: "oneOff",
      fromName: name(move.from),
      toName: name(move.to),
      amount: move.amount,
      status,
      reason: move.reason.trim() === "" ? null : move.reason,
      moveId: move.id,
      canAct: status.kind === "toDo",
    };
  });
  return [...monthly, ...oneOff];
}

export function movesView(facts: Facts, figures: Figures, month: Month): MovesView {
  const plan = movesPlanFrom(facts, figures, month);
  const name = (id: AccountId): string => facts.accounts.get(id)?.name ?? "";
  return {
    month,
    rows: rowsOf(facts, plan, figures.asOf),
    unmoved: plan.unmoved.map((entry) => ({ accountId: entry.accountId, accountName: name(entry.accountId), kind: entry.kind, amount: entry.amount })),
  };
}

type StatusWords = { readonly [K in MoveStatusLine["kind"]]: (line: Extract<MoveStatusLine, { readonly kind: K }>) => Words };

const statusTable: StatusWords = {
  toDo: () => ({ id: "plan.moves.status.toDo" }),
  partlyDone: (line) => ({ id: "plan.moves.status.partlyDone", values: { done: { money: line.done }, total: { money: line.of } } }),
  done: () => ({ id: "plan.moves.status.done" }),
  skipped: () => ({ id: "plan.moves.status.skipped" }),
};

export function statusWords(line: MoveStatusLine): Words {
  return (statusTable[line.kind] as (line: MoveStatusLine) => Words)(line);
}

/** What the status rests on, for a move that is done. */
export function proofWords(line: MoveStatusLine): Words | null {
  if (line.kind !== "done") return null;
  const { proof } = line;
  if (proof.kind === "byYou") return { id: "plan.moves.proof.byYou" };
  if (proof.last === null) return { id: "plan.moves.proof.importNoDate" };
  return { id: "plan.moves.proof.import", values: { count: proof.count, date: { day: proof.last } } };
}

export function moveWords(row: Pick<MoveRow, "amount" | "fromName" | "toName">): Words {
  return { id: "plan.moves.move", values: { amount: { money: row.amount }, from: row.fromName, to: row.toName } };
}

export function unmovedWords(note: UnmovedNote): Words {
  return {
    id: note.kind === "surplus" ? "plan.moves.unmoved.surplus" : "plan.moves.unmoved.moveIn",
    values: { amount: { money: note.amount }, account: note.accountName },
  };
}

/** Marked done by the family, with no transfer to point to. An import that shows the transfer would have done it. */
export function markDone(moveId: MoveId): FamilyCommand {
  return { kind: "setMoveStatus", moveId, status: "done", completedBy: null };
}

export function skip(moveId: MoveId): FamilyCommand {
  return { kind: "setMoveStatus", moveId, status: "skipped" };
}

export interface MoveChoice {
  readonly accountId: AccountId;
  readonly name: string;
}

/** Every account a move can run between: the shared accounts first, then the ones the household pays into. */
export function moveAccounts(facts: Facts): readonly MoveChoice[] {
  const all = [...facts.accounts.values()];
  return [...all.filter((a) => a.scope === "shared"), ...all.filter((a) => a.scope !== "shared")].map((a) => ({ accountId: a.id, name: a.name }));
}

export interface MoveForm {
  readonly from: AccountId | null;
  readonly to: AccountId | null;
  readonly amountText: string;
  readonly reason: string;
}

export type MoveProblem = "chooseFrom" | "chooseTo" | "sameAccount" | "notAnAmount" | "negative" | "notAbove";

export type MovePlan =
  | { readonly kind: "problem"; readonly problem: MoveProblem }
  | { readonly kind: "add"; readonly command: FamilyCommand; readonly amount: Money };

export interface MoveContext {
  readonly month: Month;
  readonly currency: Currency;
  readonly accounts: readonly AccountId[];
  readonly newMoveId: () => MoveId;
}

/** A one-off move: money from one account to another this month, to make at the bank. */
export function planAddMove(form: MoveForm, context: MoveContext): MovePlan {
  if (form.from === null || !context.accounts.includes(form.from)) return { kind: "problem", problem: "chooseFrom" };
  if (form.to === null || !context.accounts.includes(form.to)) return { kind: "problem", problem: "chooseTo" };
  if (form.from === form.to) return { kind: "problem", problem: "sameAccount" };
  const read = readAmount(form.amountText, context.currency);
  if (read.kind === "invalid") return { kind: "problem", problem: read.problem };
  if (read.amount <= 0) return { kind: "problem", problem: "notAbove" };
  return {
    kind: "add",
    amount: read.amount,
    command: { kind: "addMove", move: { id: context.newMoveId(), from: form.from, to: form.to, amount: read.amount, month: context.month, reason: form.reason.trim() } },
  };
}

const moveProblems: { readonly [K in MoveProblem]: Words } = {
  chooseFrom: { id: "plan.moves.problem.chooseFrom" },
  chooseTo: { id: "plan.moves.problem.chooseTo" },
  sameAccount: { id: "plan.moves.problem.sameAccount" },
  notAnAmount: { id: "plan.problem.notAnAmount" },
  negative: { id: "plan.problem.negative" },
  notAbove: { id: "plan.money.problem.notAbove" },
};

export function moveProblemWords(problem: MoveProblem): Words {
  return moveProblems[problem];
}

/** The field a problem is about. */
export function moveProblemField(problem: MoveProblem): "from" | "to" | "amount" {
  return problem === "chooseFrom" ? "from" : problem === "chooseTo" || problem === "sameAccount" ? "to" : "amount";
}

export function addedMoveWords(plan: Extract<MovePlan, { readonly kind: "add" }>, names: { readonly from: string; readonly to: string }): Words {
  return { id: "plan.moves.done.added", values: { amount: { money: plan.amount }, from: names.from, to: names.to } };
}

export function markedDoneWords(row: Pick<MoveRow, "amount" | "toName">): Words {
  return { id: "plan.moves.done.markedDone", values: { amount: { money: row.amount }, to: row.toName } };
}

export function skippedWords(row: Pick<MoveRow, "amount" | "toName">): Words {
  return { id: "plan.moves.done.skipped", values: { amount: { money: row.amount }, to: row.toName } };
}
