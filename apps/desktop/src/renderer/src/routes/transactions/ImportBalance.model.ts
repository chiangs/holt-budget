import type { AccountId, BalanceCheck, LikelyCause, Money } from "@holt/core";
import type { Words } from "./ImportSay.ts";

export interface BalanceView {
  readonly accountId: AccountId;
  readonly status: BalanceCheck["kind"];
  /** The one line that says how the check came out. */
  readonly result: Words;
  /** Why the balances may differ, in words. Empty unless they do. */
  readonly causes: readonly Words[];
  /** What a difference means for the import: it flags the account and stops nothing (rule 5). For an account not checked, what that means for its status. */
  readonly note: Words | null;
}

/** One sentence for each gap, and one for each other kind of cause, with the counts added up. */
export function causeWords(causes: readonly LikelyCause[]): Words[] {
  const words: Words[] = [];
  let nearDuplicates = 0;
  let moves = 0;
  let pendingRows = 0;
  let pendingAmount = 0;
  for (const cause of causes) {
    switch (cause.kind) {
      case "gap":
        words.push({ id: "import.cause.gap", values: { from: { day: cause.from }, to: { day: cause.to } } });
        break;
      case "nearDuplicate":
        nearDuplicates += 1;
        break;
      case "pending":
        pendingRows += cause.rows.length;
        pendingAmount += cause.amount;
        break;
      case "moveToDo":
        moves += 1;
        break;
    }
  }
  if (nearDuplicates > 0) words.push({ id: "import.cause.nearDuplicate", values: { count: nearDuplicates } });
  if (pendingRows > 0) words.push({ id: "import.cause.pending", values: { rows: pendingRows, amount: { money: pendingAmount } } });
  if (moves > 0) words.push({ id: "import.cause.moveToDo", values: { count: moves } });
  return words;
}

const money = (amount: Money) => ({ money: amount });

export function balanceView(check: BalanceCheck, accountName: string): BalanceView {
  switch (check.kind) {
    case "matches":
      return { accountId: check.accountId, status: "matches", result: { id: "import.balance.matches", values: { entered: money(check.entered) } }, causes: [], note: null };
    case "differs": {
      const causes = causeWords(check.causes);
      return {
        accountId: check.accountId,
        status: "differs",
        result: {
          id: "import.balance.differs",
          values: { difference: money(Math.abs(check.difference) as Money), entered: money(check.entered), calculated: money(check.calculated) },
        },
        causes: causes.length === 0 ? [{ id: "import.cause.none" }] : causes,
        note: { id: "import.balance.flagged" },
      };
    }
    case "notChecked":
      return {
        accountId: check.accountId,
        status: "notChecked",
        result: { id: "import.balance.notChecked" },
        causes: [],
        note: { id: "import.balance.notCheckedNote", values: { account: accountName } },
      };
  }
}
