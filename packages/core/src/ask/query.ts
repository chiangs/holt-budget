/**
 * The query language Ask turns a question into (spike S5). The assistant writes a reply in this shape;
 * the app checks it with these schemas, works out every figure in core, and only then asks the assistant
 * for words. The reply names no figures of its own: amounts in a filter are thresholds the family asked about.
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "yyyy-mm-dd");
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "yyyy-mm");
const names = z.array(z.string().min(1)).min(1);

/** Which dates a query covers. Relative periods are resolved against today's date by the evaluator, not by the model. */
export const Period = z.discriminatedUnion("type", [
  z.object({ type: z.literal("month"), month: isoMonth }),
  z.object({ type: z.literal("year"), year: z.number().int().min(2000).max(2100) }),
  z.object({ type: z.literal("range"), from: isoDate, to: isoDate }),
  z.object({ type: z.literal("this-month") }),
  z.object({ type: z.literal("last-month") }),
  z.object({ type: z.literal("this-year") }),
  /** The given number of whole months before the current one: on 9 November, 3 means August to October. */
  z.object({ type: z.literal("last-months"), count: z.number().int().min(1).max(36) }),
]);
export type Period = z.infer<typeof Period>;

export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;

export const Filter = z.object({
  period: Period,
  /** Account names as the family calls them. Leave out for all shared accounts. */
  accounts: names.optional(),
  /** Job names. */
  jobs: names.optional(),
  /** Any of these, matched without regard to case within the counterparty's name or its account number. */
  counterparties: names.optional(),
  /** Any of these, matched without regard to case within the bank's description. */
  text: names.optional(),
  direction: z.enum(["in", "out"]).optional(),
  /** The size of each transaction in whole major units (kroner), whichever way the money went. */
  amount: z
    .object({ atLeast: z.number().int().min(0).optional(), atMost: z.number().int().min(0).optional() })
    .optional(),
  weekdays: z.array(Weekday).min(1).optional(),
  /** Moves between the household's own accounts. Spending and income questions leave them out. */
  transfers: z.enum(["exclude", "include", "only"]),
  /** True for purchases abroad only: those with an original foreign amount. */
  foreign: z.boolean().optional(),
});
export type Filter = z.infer<typeof Filter>;

export const TransactionQuery = z.object({
  kind: z.literal("transactions"),
  filter: Filter,
  /** "monthly-average" divides the total by the number of months in the period. */
  measure: z.enum(["sum", "count", "average", "monthly-average", "list"]),
  groupBy: z.enum(["month", "counterparty", "job", "account", "currency"]).optional(),
  /** Keep only this many groups (or transactions, for a list), largest first. */
  top: z.number().int().min(1).max(50).optional(),
});
export type TransactionQuery = z.infer<typeof TransactionQuery>;

const figureMonth = z.union([z.literal("this-month"), z.literal("last-month"), isoMonth]);

/** A figure core works out from the plan. Core evaluates these from Milestone 2. */
export const FigureQuery = z.discriminatedUnion("figure", [
  z.object({ kind: z.literal("figure"), figure: z.literal("job"), job: z.string().min(1), month: figureMonth, measure: z.enum(["assigned", "spent", "left"]) }),
  /** Every job that has spent more than it was assigned in the month. */
  z.object({ kind: z.literal("figure"), figure: z.literal("jobs-over"), month: figureMonth }),
  z.object({ kind: z.literal("figure"), figure: z.literal("month"), month: figureMonth, measure: z.enum(["money-available", "unassigned", "over-assigned"]) }),
  z.object({ kind: z.literal("figure"), figure: z.literal("bucket"), job: z.string().min(1), measure: z.enum(["balance", "estimate"]) }),
  /** An account's balance: imported, or entered by hand for a loan (spike S4). */
  z.object({ kind: z.literal("figure"), figure: z.literal("account-balance"), account: z.string().min(1) }),
]);
export type FigureQuery = z.infer<typeof FigureQuery>;

/** The question belongs to a screen that answers it better, such as Recurring costs for subscriptions. */
export const Elsewhere = z.object({
  kind: z.literal("elsewhere"),
  screen: z.enum(["plan", "transactions", "recurring-costs", "monthly-review", "insurance", "settings"]),
});
export type Elsewhere = z.infer<typeof Elsewhere>;

/** Holt can't answer it: advice (Holt suggests, never advises), something outside the household's data, or unclear. */
export const Cannot = z.object({ kind: z.literal("cannot"), reason: z.enum(["advice", "outside-holt", "unclear"]) });
export type Cannot = z.infer<typeof Cannot>;

export const Step = z.discriminatedUnion("kind", [TransactionQuery, FigureQuery, Elsewhere, Cannot]);
export type Step = z.infer<typeof Step>;

/** The assistant's whole reply: one step, or two or three that the app shows side by side (compare October with September). */
export const AskReply = z.object({ steps: z.array(Step).min(1).max(3) });
export type AskReply = z.infer<typeof AskReply>;
