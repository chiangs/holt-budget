// How the bake-off decides whether an Ask reply is right: two replies are the same when they give the family
// the same figures and the same transactions, however the query is written (decision 0044).
import {
  type AskContext,
  type QueryableTransaction,
  type Step,
  type TransactionResult,
  evaluateTransactionQuery,
  resolvePeriod,
} from "@holt/core";

const absolute = (v: TransactionResult["value"]) => (v.kind === "money" ? Math.abs(v.amount) : v.count);
const lower = (s: string | undefined) => s?.toLocaleLowerCase("nb") ?? "";

interface Seen {
  kind: string;
  /** The total, a figure's request, or a screen. */
  key: string;
  /** Groups largest first when the query keeps only the top ones; by key otherwise. */
  groups: string[];
  ranked: boolean;
  /** The transactions a list shows, as a set. */
  listed: string;
}

function seen(step: Step, rows: readonly QueryableTransaction[], context: AskContext): Seen {
  if (step.kind === "transactions") {
    const r = evaluateTransactionQuery(step, rows, context);
    return {
      kind: "t",
      key: String(absolute(r.value)),
      groups: (r.groups ?? []).map((g) => `${lower(g.key)}=${absolute(g.value)}`),
      ranked: step.groupBy !== undefined && step.top !== undefined,
      listed: step.measure === "list" && step.groupBy === undefined ? r.matched.map((t) => t.id).sort().join(",") : "",
    };
  }
  if (step.kind === "figure") {
    const month =
      "month" in step ? (step.month === "this-month" || step.month === "last-month" ? resolvePeriod({ type: step.month }, context.today).from.slice(0, 7) : step.month) : "";
    const key = [step.figure, "measure" in step ? step.measure : "", lower("job" in step ? step.job : ""), lower("account" in step ? step.account : ""), month].join("|");
    return { kind: "f", key, groups: [], ranked: false, listed: "" };
  }
  return { kind: step.kind, key: step.kind === "elsewhere" ? step.screen : "", groups: [], ranked: false, listed: "" };
}

function sameStep(a: Seen, b: Seen): boolean {
  if (a.kind !== b.kind || a.listed !== b.listed) return false;
  // Two "largest first" answers agree wherever their ranks overlap, whatever top each chose; the totals then differ, so skip them.
  if (a.ranked && b.ranked) {
    const shared = Math.min(a.groups.length, b.groups.length);
    return shared > 0 && a.groups.slice(0, shared).every((g, i) => g === b.groups[i]);
  }
  return a.key === b.key && a.groups.join(";") === b.groups.join(";");
}

/** True when the reply matches the expected reply, step for step in any order. */
export function sameReply(got: readonly Step[], expected: readonly Step[], rows: readonly QueryableTransaction[], context: AskContext): boolean {
  if (got.length !== expected.length) return false;
  const left = expected.map((s) => seen(s, rows, context));
  return got.every((s) => {
    const mine = seen(s, rows, context);
    const i = left.findIndex((e) => sameStep(mine, e));
    if (i === -1) return false;
    left.splice(i, 1);
    return true;
  });
}
