import { type AccountId, type ChangeByYou, type Facts, type ImportBatchId, type LocalDate, type Money, type MoveId, type Refusal, type TransactionId, describeUndoImport } from "@holt/core";

export interface UndoLine {
  readonly transactionId: TransactionId;
  readonly date: LocalDate;
  readonly description: string;
  readonly amount: Money;
}

export interface ChangedLine extends UndoLine {
  readonly changes: readonly ChangeByYou[];
}

export interface UndoMoveLine {
  readonly moveId: MoveId;
  readonly month: string;
  readonly amount: Money;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

/** What an undo would do, in the order the family needs it: what they would lose first, then what stays and what changes around it. */
export interface UndoView {
  readonly batchId: ImportBatchId;
  readonly fileName: string;
  readonly removed: number;
  /** Removed transactions the family has changed since, which the undo takes with it. */
  readonly changed: readonly ChangedLine[];
  readonly keptByAnotherImport: readonly UndoLine[];
  readonly keptRecordedByHand: readonly UndoLine[];
  readonly moves: readonly UndoMoveLine[];
  readonly partners: readonly UndoLine[];
}

export type UndoDescription = { readonly ok: true; readonly view: UndoView } | { readonly ok: false; readonly refusal: Refusal };

/** Core's description of the undo, worked out on the page's own copy of the facts. Nothing crosses the bridge. */
export function undoView(facts: Facts, batchId: ImportBatchId): UndoDescription {
  const described = describeUndoImport(facts, batchId);
  if (!described.ok) return described;
  const { preview } = described;
  const line = (transactionId: TransactionId): UndoLine => {
    const t = facts.transactions.get(transactionId);
    return { transactionId, date: t?.bookingDate ?? ("" as LocalDate), description: t?.description ?? "", amount: t?.amount ?? (0 as Money) };
  };
  const accountName = (id: AccountId): string => facts.accounts.get(id)?.name ?? "";
  const byDate = (a: UndoLine, b: UndoLine): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.transactionId < b.transactionId ? -1 : 1);
  return {
    ok: true,
    view: {
      batchId,
      fileName: facts.importBatches.get(batchId)?.fileName ?? "",
      removed: preview.removed.length,
      changed: preview.changedByYou.map(({ transactionId, changes }) => ({ ...line(transactionId), changes })).sort(byDate),
      keptByAnotherImport: preview.keptByAnotherImport.map(line).sort(byDate),
      keptRecordedByHand: preview.keptRecordedByHand.map(line).sort(byDate),
      moves: preview.movesBackToDo.flatMap((id) => {
        const move = facts.moves.get(id);
        return move === undefined ? [] : [{ moveId: id, month: move.month, amount: move.amount, from: accountName(move.from), to: accountName(move.to), reason: move.reason }];
      }),
      partners: preview.partnersUnlinked.map(line).sort(byDate),
    },
  };
}

/** The first few of a long list, and how many more there are, so a dialog stays short however big the import was. */
export function firstOf<T>(items: readonly T[], size: number): { readonly shown: readonly T[]; readonly more: number } {
  return { shown: items.slice(0, size), more: Math.max(0, items.length - size) };
}
