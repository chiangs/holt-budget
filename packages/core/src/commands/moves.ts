/**
 * One-off moves at the bank (decision 11). Holt never moves money: a move is a note for the family, which
 * starts as to do and is marked done (by an import, or by the family) or skipped, once.
 */

import type { Move } from "../facts.ts";
import type { MoveId, TransactionId } from "../ids.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { patched, refuse } from "./refusal.ts";

/** A new move. Every move starts as to do, with nothing completing it. */
export type NewMove = Omit<Move, "status" | "completedBy">;

export type MoveOutcome = { readonly status: "done"; readonly completedBy: TransactionId | null } | { readonly status: "skipped" };

export type MoveCommand =
  | { readonly kind: "addMove"; readonly move: NewMove }
  | ({ readonly kind: "setMoveStatus"; readonly moveId: MoveId } & MoveOutcome);

export const moveHandlers: Handlers<MoveCommand> = {
  addMove(facts, { move }) {
    if (facts.moves.has(move.id)) return refuse("idTaken");
    if (move.from === move.to) return refuse("sameAccount");
    if (move.amount <= 0) return refuse("amountNotPositive");
    return patched(editFacts(facts).put("moves", { ...move, status: "todo", completedBy: null }));
  },

  setMoveStatus(facts, command) {
    const move = facts.moves.get(command.moveId);
    if (move === undefined) return refuse("moveNotFound");
    if (move.status !== "todo") return refuse("moveNotToDo");
    const completedBy = command.status === "done" ? command.completedBy : null;
    return patched(editFacts(facts).put("moves", { ...move, status: command.status, completedBy }));
  },
};
