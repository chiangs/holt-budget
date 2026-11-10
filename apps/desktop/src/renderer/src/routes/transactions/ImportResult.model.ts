import { type AccountId, type ImportPreview, type ImportStatusFigures, type LocalDate, type Month, addMonths, lastDayOf, monthOf } from "@holt/core";
import { type BalanceView, balanceView } from "./ImportBalance.model.ts";
import type { Words } from "./ImportSay.ts";

export interface ResultView {
  readonly title: Words;
  /** What else the import did, one sentence each, only for what is not zero. */
  readonly lines: readonly Words[];
  readonly needsYou: number;
  readonly balances: readonly { readonly accountId: AccountId; readonly name: string; readonly view: BalanceView }[];
  /** Whether every account is up to date now, and whether last month's review has what it needs. Null until the figures have caught up. */
  readonly review: ReviewLine | null;
}

/** `good` when every account is up to date, so a tick is honest, and `waiting` when some are not. */
export interface ReviewLine {
  readonly words: Words;
  readonly tone: "good" | "waiting";
}

/**
 * Whether the family can rely on last month's figures. An account is up to date within its rhythm, which can
 * still stop days short of the month's end, so the review's claim needs every account's data to reach the last day.
 */
export function reviewLine(statuses: ImportStatusFigures, accountName: (id: AccountId) => string, today: LocalDate, planStart: Month): ReviewLine | null {
  const accounts = [...statuses.accounts.values()];
  if (accounts.length === 0) return null;
  const waiting = accounts.filter((status) => status.state !== "upToDate");
  if (waiting.length > 0) {
    return { tone: "waiting", words: { id: "import.result.notUpToDate", values: { accounts: { list: waiting.map((status) => accountName(status.accountId)), type: "conjunction" } } } };
  }
  const reviewed = addMonths(monthOf(today), -1);
  const covered = reviewed >= planStart && accounts.every((status) => status.coversTo !== null && status.coversTo >= lastDayOf(reviewed));
  return { tone: "good", words: covered ? { id: "import.result.reviewReady", values: { month: { month: reviewed } } } : { id: "import.result.upToDate" } };
}

export function resultView(input: {
  readonly preview: ImportPreview;
  readonly accountName: (id: AccountId) => string;
  readonly statuses: ImportStatusFigures | null;
  readonly today: LocalDate;
  readonly planStart: Month;
}): ResultView {
  const { preview, accountName, statuses, today, planStart } = input;
  const { counts } = preview;
  const receiving = preview.accounts.filter((line) => line.created > 0).map((line) => accountName(line.accountId));
  const title: Words =
    counts.created === 0 || receiving.length === 0
      ? { id: "import.result.titleNone", values: { fileName: preview.fileName } }
      : { id: "import.result.title", values: { count: counts.created, accounts: { list: receiving, type: "conjunction" } } };
  const lines: Words[] = [];
  if (counts.matched > 0) lines.push({ id: "import.result.matched", values: { count: counts.matched } });
  if (counts.pending > 0) lines.push({ id: "import.result.pending", values: { count: counts.pending } });
  if (counts.transfers > 0) lines.push({ id: "import.result.transfers", values: { count: counts.transfers } });
  if (preview.completedMoves.length > 0) lines.push({ id: "import.result.moves", values: { count: preview.completedMoves.length } });
  return {
    title,
    lines,
    needsYou: counts.needsYou,
    balances: preview.accounts.map((line) => ({ accountId: line.accountId, name: accountName(line.accountId), view: balanceView(line.balance, accountName(line.accountId)) })),
    review: statuses === null ? null : reviewLine(statuses, accountName, today, planStart),
  };
}
