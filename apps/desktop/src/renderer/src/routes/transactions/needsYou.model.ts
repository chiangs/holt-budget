/**
 * What the Needs you list shows and what each row can do. Everything here is a pure function of the facts
 * and core's `needsYou` figure, so it is tested without a browser. The page turns these into words and
 * sends the commands; it works out no figure.
 */

import {
  type Facts,
  type FamilyCommand,
  type JobId,
  type LocalDate,
  type NeedsYouItem,
  type NeedsYouSuggestion,
  type RuleShare,
  type Transaction,
  type TransactionId,
  type TreatmentInput,
  maxBatchCommands,
} from "@holt/core";

/** Everything a row can offer. Which ones it does depends on the row (`actionsFor`). */
export type RowAction = "accept" | "chooseJob" | "split" | "transfer" | "income" | "refund" | "note" | "alwaysDoThis";

/** What accepting a suggestion would give a transaction, as the words need it: one job by name, or a split over several. */
export type JobLabel = { readonly kind: "job"; readonly name: string } | { readonly kind: "split"; readonly jobs: number };

export interface RowSuggestion {
  readonly kind: NeedsYouSuggestion["kind"];
  /** What Space runs: the suggestion's own command. For a merge it is the merge. */
  readonly command: FamilyCommand;
  /** The job or split accepting would give, or null for a merge, which removes this transaction instead. */
  readonly result: JobLabel | null;
  /** The jobs accepting would use, each once. Empty for a merge. */
  readonly jobs: readonly JobId[];
  /** Those jobs with the share each takes, so a rule can remember the same split. Null for a merge. */
  readonly shares: readonly [RuleShare, ...RuleShare[]] | null;
  /** The earlier transaction the suggestion rests on: the one it copies, or the one it would keep. */
  readonly basis: { readonly date: LocalDate; readonly description: string } | null;
}

export interface NeedsYouRow {
  readonly id: TransactionId;
  readonly transaction: Transaction;
  readonly accountName: string;
  /** The payee, or the bank's description when it gave no payee. */
  readonly who: string;
  /** The bank's own description, when it says more than `who`. */
  readonly detail: string | null;
  readonly direction: "out" | "in";
  readonly suggestion: RowSuggestion | null;
  /** Transactions in other accounts this one could be the other side of. */
  readonly candidates: readonly Transaction[];
  readonly actions: readonly RowAction[];
}

export function directionOf(transaction: Pick<Transaction, "amount">): "out" | "in" {
  return transaction.amount > 0 ? "in" : "out";
}

/**
 * The actions a row offers, in the order the menu lists them. Money out is a cost, so it goes to a job or a
 * split. Money in is income or a refund against a job, and a refund is not income. Either way it can be the
 * other side of a transfer, and can carry a note. A rule needs a payee to match, so a row without one can't
 * make one.
 */
export function actionsFor(transaction: Transaction, suggestion: RowSuggestion | null): readonly RowAction[] {
  const money: readonly RowAction[] = directionOf(transaction) === "out" ? ["chooseJob", "split", "transfer"] : ["income", "refund", "split", "transfer"];
  return [
    ...(suggestion === null ? [] : (["accept"] as const)),
    ...money,
    "note",
    ...(transaction.counterparty === undefined || transaction.counterparty.trim() === "" ? [] : (["alwaysDoThis"] as const)),
  ];
}

export function labelOf(treatment: TreatmentInput, facts: Facts): JobLabel | null {
  if (treatment.kind !== "split") return null;
  const jobs = [...new Set(treatment.allocations.map((allocation) => allocation.jobId))];
  const [only] = jobs;
  if (jobs.length === 1 && only !== undefined) return { kind: "job", name: facts.jobs.get(only)?.name ?? "" };
  return { kind: "split", jobs: jobs.length };
}

/** Each job's size in the split, as a whole weight, leaving out a job that takes nothing. */
function sharesOf(treatment: TreatmentInput): RowSuggestion["shares"] {
  if (treatment.kind !== "split") return null;
  const weights = new Map<JobId, number>();
  for (const { jobId, amount } of treatment.allocations) weights.set(jobId, (weights.get(jobId) ?? 0) + Math.abs(amount));
  const [first, ...rest] = [...weights].filter(([, weight]) => weight > 0).map(([jobId, weight]): RuleShare => ({ jobId, weight }));
  return first === undefined ? null : [first, ...rest];
}

function suggestionView(suggestion: NeedsYouSuggestion, facts: Facts): RowSuggestion {
  const earlier = (id: TransactionId): RowSuggestion["basis"] => {
    const found = facts.transactions.get(id);
    return found === undefined ? null : { date: found.bookingDate, description: found.counterparty ?? found.description };
  };
  if (suggestion.kind === "merge") return { kind: "merge", command: suggestion.command, result: null, jobs: [], shares: null, basis: earlier(suggestion.command.keep) };
  const { treatment } = suggestion.command;
  return {
    kind: suggestion.kind,
    command: suggestion.command,
    result: labelOf(treatment, facts),
    jobs: treatment.kind === "split" ? [...new Set(treatment.allocations.map((allocation) => allocation.jobId))] : [],
    shares: sharesOf(treatment),
    basis: suggestion.kind === "sameAsLast" ? earlier(suggestion.from) : null,
  };
}

/** One row for each waiting transaction, in the order the figure gives: newest booking date first, then by ID. */
export function needsYouRows(facts: Facts, items: readonly NeedsYouItem[]): NeedsYouRow[] {
  return items.map((item) => {
    const { transaction } = item;
    const suggestion = item.suggestion === null ? null : suggestionView(item.suggestion, facts);
    const who = transaction.counterparty ?? transaction.description;
    return {
      id: transaction.id,
      transaction,
      accountName: facts.accounts.get(transaction.accountId)?.name ?? "",
      who,
      detail: transaction.description.trim().toLowerCase() === who.trim().toLowerCase() ? null : transaction.description,
      direction: directionOf(transaction),
      suggestion,
      candidates: item.transferCandidates.flatMap((id) => facts.transactions.get(id) ?? []),
      actions: actionsFor(transaction, suggestion),
    };
  });
}

/** Accepting every suggestion at once. */
export interface AcceptAll {
  /** One batch of the suggestions' own commands, so it is one change with one undo. Null when no row has a suggestion. */
  readonly command: FamilyCommand | null;
  /** How many suggestions the batch holds. */
  readonly count: number;
  /** How many rows have a suggestion. More than `count` only when one batch can't hold them all. */
  readonly total: number;
}

export function acceptAll(rows: readonly NeedsYouRow[], limit: number = maxBatchCommands): AcceptAll {
  const all = rows.flatMap((row) => (row.suggestion === null ? [] : [row.suggestion.command]));
  const commands = all.slice(0, limit);
  return { command: commands.length === 0 ? null : { kind: "batch", commands }, count: commands.length, total: all.length };
}

/**
 * After the rows changed, the row to select. The same row if it is still there. Otherwise the first row that
 * followed it in the old list and survives, or, when it was last, the nearest one before it.
 */
export function reselect(before: readonly TransactionId[], after: readonly TransactionId[], selected: TransactionId | null): TransactionId | null {
  if (after.length === 0) return null;
  if (selected !== null && after.includes(selected)) return selected;
  const kept = new Set(after);
  const from = selected === null ? -1 : before.indexOf(selected);
  if (from < 0) return after[0] ?? null;
  const following = before.slice(from + 1).find((id) => kept.has(id));
  if (following !== undefined) return following;
  return before.slice(0, from).findLast((id) => kept.has(id)) ?? after[0] ?? null;
}

/** The row `step` away from the selected one, stopping at the ends. Nothing selected starts at the first row. */
export function moveSelection(ids: readonly TransactionId[], selected: TransactionId | null, step: number): TransactionId | null {
  if (ids.length === 0) return null;
  const at = selected === null ? -1 : ids.indexOf(selected);
  const next = at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + step));
  return ids[next] ?? null;
}

/** How many rows to draw: a screenful at a time, and always enough to include the selected row. */
export const pageSize = 50;

export function visibleCount(total: number, requested: number, selectedIndex: number): number {
  return Math.min(total, Math.max(requested, selectedIndex + 1));
}
