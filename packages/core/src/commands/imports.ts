/**
 * Importing a file and what follows from it (decision 0047). `planImport` (in `../import/`) works out the
 * commands from a parsed file and the facts; these handlers apply them. Only the main process builds an
 * `importFile` command, because it holds the file.
 */

import { type Facts, type ImportBatch, type ImportRow, type Move, type Transaction, householdOf } from "../facts.ts";
import type { ImportBatchId, MoveId, TransactionId } from "../ids.ts";
import { liveBacking } from "../import/matching.ts";
import { describeUndoImport } from "../import/undo-import.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { planStartFault } from "./check-facts.ts";
import { type Outcome, patched, refuse } from "./refusal.ts";

/** Two transactions that are the two sides of one transfer, and the move at the bank their pairing completes when one is named. */
export interface TransferPair {
  readonly a: TransactionId;
  readonly b: TransactionId;
  readonly completesMove?: MoveId;
}

export type ImportCommand =
  /** The batch, every row of the file and the transactions the new rows create, in one change. Rows that match an existing transaction back it and create nothing. */
  | { readonly kind: "importFile"; readonly batch: ImportBatch; readonly rows: readonly ImportRow[]; readonly transactions: readonly Transaction[] }
  /** Marks the batch undone and releases its rows. Removes the transactions no other live import backs, and those only. */
  | { readonly kind: "undoImport"; readonly batchId: ImportBatchId }
  /** Accepts a near match: the dropped transaction's rows back the kept one, and the dropped one goes. */
  | { readonly kind: "mergeTransactions"; readonly keep: TransactionId; readonly drop: TransactionId }
  /** Makes each pair of transactions a transfer, and completes the move at the bank each pair matches when one is named. The pairs go in order, each seeing the pairs before it, so the result is what the same pairs one by one give. A first import has thousands, which is why they travel together. */
  | { readonly kind: "pairTransfers"; readonly pairs: readonly TransferPair[] };

/**
 * A new transaction is backed by the row that creates it, which gives it its own ID, and it has that row's
 * account, amount and booking date. An existing one is backed by at most one row of the file, with its
 * account and amount. Pending rows back nothing. The batch's counts say what the rows do.
 */
function importAgrees(facts: Facts, { batch, rows, transactions }: Extract<ImportCommand, { kind: "importFile" }>): Outcome | null {
  const created = new Map(transactions.map((t) => [t.id, t]));
  if (created.size !== transactions.length) return refuse("importDisagrees");
  const rowIds = new Set<string>();
  const backedNew = new Set<TransactionId>();
  const backedOld = new Set<TransactionId>();
  let pending = 0;
  let from = rows[0]?.bookingDate;
  let to = from;
  for (const row of rows) {
    if (facts.importRows.has(row.id) || facts.transactions.has(row.id as string as TransactionId) || rowIds.has(row.id)) return refuse("idTaken");
    rowIds.add(row.id);
    if (!facts.accounts.has(row.accountId)) return refuse("accountNotFound");
    if (row.batchId !== batch.id) return refuse("importDisagrees");
    if (from === undefined || row.bookingDate < from) from = row.bookingDate;
    if (to === undefined || row.bookingDate > to) to = row.bookingDate;
    if (row.pending) {
      pending += 1;
      if (row.backs !== null) return refuse("importDisagrees");
      continue;
    }
    if (row.backs === null) return refuse("importDisagrees");
    const fresh = created.get(row.backs);
    const backed = fresh ?? facts.transactions.get(row.backs);
    if (backed === undefined || backed.accountId !== row.accountId || backed.amount !== row.amount) return refuse("importDisagrees");
    if (fresh === undefined) {
      if (backedOld.has(backed.id)) return refuse("importDisagrees");
      backedOld.add(backed.id);
    } else {
      if ((row.id as string) !== fresh.id || fresh.bookingDate !== row.bookingDate) return refuse("importDisagrees");
      backedNew.add(fresh.id);
    }
  }
  for (const t of transactions) {
    if (facts.transactions.has(t.id)) return refuse("idTaken");
    if (!facts.accounts.has(t.accountId)) return refuse("accountNotFound");
    if (!["needsYou", "history", "split"].includes(t.treatment.kind)) return refuse("importDisagrees");
  }
  const counted =
    backedNew.size === transactions.length &&
    batch.rows === rows.length &&
    batch.created === transactions.length &&
    batch.matched === backedOld.size &&
    batch.pending === pending &&
    batch.from === from &&
    batch.to === to &&
    !batch.undone;
  return counted ? null : refuse("importDisagrees");
}

export const importHandlers: Handlers<ImportCommand> = {
  importFile(facts, command) {
    const { batch, rows, transactions } = command;
    if (facts.importBatches.has(batch.id)) return refuse("idTaken");
    for (const other of facts.importBatches.values()) if (!other.undone && other.fingerprint === batch.fingerprint) return refuse("importFingerprintLive");
    const disagreement = importAgrees(facts, command);
    if (disagreement !== null) return disagreement;
    const editor = editFacts(facts).put("importBatches", batch);
    for (const row of rows) editor.put("importRows", row);
    for (const t of transactions) editor.put("transactions", t);
    return patched(editor);
  },

  undoImport(facts, { batchId }) {
    const result = describeUndoImport(facts, batchId);
    if (!result.ok) return result;
    const { preview } = result;
    const batch = facts.importBatches.get(batchId);
    if (batch === undefined) return refuse("importNotFound");
    const editor = editFacts(facts).put("importBatches", { ...batch, undone: true });
    for (const row of facts.importRows.values()) if (row.batchId === batchId && row.backs !== null) editor.put("importRows", { ...row, backs: null });
    for (const id of preview.removed) editor.remove("transactions", id);
    for (const id of preview.movesBackToDo) {
      const move = facts.moves.get(id);
      if (move !== undefined) editor.put("moves", { ...move, status: "todo", completedBy: null });
    }
    for (const id of preview.partnersUnlinked) {
      const t = facts.transactions.get(id);
      if (t !== undefined) editor.put("transactions", { ...t, treatment: { kind: "transfer", partner: null } });
    }
    return patched(editor);
  },

  mergeTransactions(facts, { keep, drop }) {
    if (keep === drop) return refuse("mergeSameTransaction");
    const kept = facts.transactions.get(keep);
    const dropped = facts.transactions.get(drop);
    if (kept === undefined || dropped === undefined) return refuse("transactionNotFound");
    if (kept.accountId !== dropped.accountId || kept.amount !== dropped.amount) return refuse("mergeMismatch");
    const backing = liveBacking(facts);
    const keptBy = backing.get(keep) ?? [];
    if ((backing.get(drop) ?? []).some((batch) => keptBy.includes(batch))) return refuse("mergeSameFile");
    const editor = editFacts(facts).remove("transactions", drop);
    for (const row of facts.importRows.values()) if (row.backs === drop) editor.put("importRows", { ...row, backs: keep });
    for (const move of facts.moves.values()) if (move.completedBy === drop) editor.put("moves", { ...move, completedBy: keep });
    for (const t of facts.transactions.values()) {
      if (t.treatment.kind === "transfer" && t.treatment.partner === drop) editor.put("transactions", { ...t, treatment: { kind: "transfer", partner: null } });
    }
    return patched(editor);
  },

  pairTransfers(facts, { pairs }) {
    const { planStart } = householdOf(facts);
    const transactions = new Map<TransactionId, Transaction>();
    const moves = new Map<MoveId, Move>();
    for (const { a, b, completesMove } of pairs) {
      const first = transactions.get(a) ?? facts.transactions.get(a);
      const second = transactions.get(b) ?? facts.transactions.get(b);
      if (first === undefined || second === undefined) return refuse("transactionNotFound");
      if (first.accountId === second.accountId) return refuse("transferSameAccount");
      if (first.amount === 0 || first.amount !== -second.amount) return refuse("transferAmountsDiffer");
      for (const [self, other] of [[first, second], [second, first]] as const) {
        if (self.treatment.kind === "transfer" && self.treatment.partner !== null && self.treatment.partner !== other.id) return refuse("transferAlreadyPaired");
        const fault = planStartFault({ bookingDate: self.bookingDate, treatment: { kind: "transfer", partner: other.id } }, planStart);
        if (fault !== null) return refuse(fault);
      }
      for (const [self, other] of [[first, second], [second, first]] as const) {
        const { ruleId: _rule, ...rest } = self;
        transactions.set(self.id, { ...rest, treatment: { kind: "transfer", partner: other.id } });
      }
      if (completesMove !== undefined) {
        const move = moves.get(completesMove) ?? facts.moves.get(completesMove);
        if (move === undefined) return refuse("moveNotFound");
        if (move.status !== "todo") return refuse("moveNotToDo");
        const [outgoing, incoming] = first.amount < 0 ? [first, second] : [second, first];
        if (move.from !== outgoing.accountId || move.to !== incoming.accountId || move.amount !== incoming.amount) return refuse("moveDoesNotMatch");
        moves.set(move.id, { ...move, status: "done", completedBy: outgoing.id });
      }
    }
    const editor = editFacts(facts);
    for (const transaction of transactions.values()) editor.put("transactions", transaction);
    for (const move of moves.values()) editor.put("moves", move);
    return patched(editor);
  },
};
