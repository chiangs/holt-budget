/**
 * Undoing an import (decision 0047, "Undoing an import"). The batch is marked undone and its rows let go of
 * the transactions they backed. A transaction an import brought goes once no live row backs it; one that
 * another live import backs stays, and so does one the family recorded by hand. The preview names every
 * loss before it happens.
 */

import type { Facts, Transaction } from "../facts.ts";
import type { ImportBatchId, MoveId, TransactionId } from "../ids.ts";
import { type Refusal, refusal } from "../commands/refusal.ts";
import { compareIds, creatingRow, liveBacking } from "./matching.ts";

/** What the family did to a transaction that the undo removes. */
export type ChangeByYou = "note" | "treatment";

export interface UndoImportPreview {
  readonly batchId: ImportBatchId;
  /** Every transaction the undo removes, with its treatment. */
  readonly removed: readonly TransactionId[];
  /** Removed transactions the family has noted or given a treatment since: the losses to show first. */
  readonly changedByYou: readonly { readonly transactionId: TransactionId; readonly changes: readonly ChangeByYou[] }[];
  /** Transactions this import backed that stay, because another live import backs them too. */
  readonly keptByAnotherImport: readonly TransactionId[];
  /** Transactions this import matched that the family recorded by hand. They stay, backed by no file. */
  readonly keptRecordedByHand: readonly TransactionId[];
  /** Moves at the bank completed by a pair the undo breaks. They go back to to do. */
  readonly movesBackToDo: readonly MoveId[];
  /** Transfers that stay while their partner goes. They wait for their other side again. */
  readonly partnersUnlinked: readonly TransactionId[];
}

export type UndoImportResult = { readonly ok: true; readonly preview: UndoImportPreview } | { readonly ok: false; readonly refusal: Refusal };

/** Import gives a transaction one of these: needs you, history with no job, or what a rule says. Anything else came from the family. */
function changesByYou(t: Transaction): ChangeByYou[] {
  const changes: ChangeByYou[] = [];
  if (t.note !== undefined) changes.push("note");
  const treatment = t.treatment;
  const fromImport =
    treatment.kind === "needsYou" ||
    (treatment.kind === "transfer" && treatment.partner !== null) ||
    (t.ruleId !== undefined && (treatment.kind === "split" || treatment.kind === "history")) ||
    (treatment.kind === "history" && treatment.jobId === null);
  if (!fromImport) changes.push("treatment");
  return changes;
}

export function describeUndoImport(facts: Facts, batchId: ImportBatchId): UndoImportResult {
  const batch = facts.importBatches.get(batchId);
  if (batch === undefined) return { ok: false, refusal: refusal("importNotFound") };
  if (batch.undone) return { ok: false, refusal: refusal("importAlreadyUndone") };

  const backedHere = new Set<TransactionId>();
  for (const row of facts.importRows.values()) if (row.batchId === batchId && row.backs !== null) backedHere.add(row.backs);
  const backing = liveBacking(facts);

  const removed: TransactionId[] = [];
  const keptByAnotherImport: TransactionId[] = [];
  const keptRecordedByHand: TransactionId[] = [];
  for (const id of [...backedHere].sort(compareIds)) {
    if ((backing.get(id) ?? []).some((other) => other !== batchId)) keptByAnotherImport.push(id);
    else if (creatingRow(facts, { id }) === undefined) keptRecordedByHand.push(id);
    else removed.push(id);
  }

  const gone = new Set(removed);
  const changedByYou = removed.flatMap((id) => {
    const t = facts.transactions.get(id);
    const changes = t === undefined ? [] : changesByYou(t);
    return changes.length === 0 ? [] : [{ transactionId: id, changes }];
  });
  const partnersUnlinked = [...facts.transactions.values()]
    .filter((t) => !gone.has(t.id) && t.treatment.kind === "transfer" && t.treatment.partner !== null && gone.has(t.treatment.partner))
    .map((t) => t.id)
    .sort(compareIds);
  // A pair completes a move, so the move is to do again when either side goes, whichever side it names.
  const broken = new Set([...gone, ...partnersUnlinked]);
  const movesBackToDo = [...facts.moves.values()]
    .filter((m) => m.completedBy !== null && broken.has(m.completedBy))
    .map((m) => m.id)
    .sort(compareIds);

  return { ok: true, preview: { batchId, removed, changedByYou, keptByAnotherImport, keptRecordedByHand, movesBackToDo, partnersUnlinked } };
}
