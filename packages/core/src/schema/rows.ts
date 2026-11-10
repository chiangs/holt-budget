/**
 * One schema per kind of row, for the places where data crosses a boundary: a row read from the database,
 * a patch inside a stored change, a command from the page. Core's own logic trusts its types and never
 * calls these. Every object is strict, so a key the type doesn't name is refused, and an optional key
 * stays absent rather than becoming `undefined`.
 */

import { z } from "zod";
import { treatmentFor } from "../commands/transactions.ts";
import type { RowOf, TableName } from "../facts.ts";
import { AccountNumberSchema, CurrencySchema, DateTimeSchema, FiniteSchema, LocalDateSchema, MoneySchema, MonthSchema, atLeastOne, ids, wholeNumber } from "./primitives.ts";

const text = z.string();
const nonNegative = wholeNumber(0);

export const AccountKindSchema = z.enum(["everyday", "bills", "savings", "loan"]);
export const ImportRhythmSchema = z.enum(["weekly", "fortnightly", "monthly"]);
export const JobStatusSchema = z.enum(["active", "paused", "finished", "archived"]);
export const SeasonalitySchema = z.enum(["auto", "seasonal", "irregular"]);

export const SpendPlanSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("setAmount"), amount: MoneySchema }),
  z.strictObject({ mode: z.literal("followBills") }),
  z.strictObject({ mode: z.literal("evenOut"), monthly: MoneySchema, startMonth: MonthSchema }),
]);

export const SaveUpTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("amountByMonth"), amount: MoneySchema, readyBy: MonthSchema }),
  z.strictObject({ kind: z.literal("monthly"), amount: MoneySchema }),
  z.strictObject({ kind: z.literal("bufferMonths"), monthly: MoneySchema }),
]);

const jobFields = {
  id: ids.job,
  name: text,
  groupId: ids.group,
  status: JobStatusSchema,
  accountId: ids.account,
  essential: z.boolean(),
  opening: MoneySchema,
};

const JobSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...jobFields, kind: z.literal("spend"), keepsMoney: z.boolean(), plan: SpendPlanSchema, seasonality: SeasonalitySchema }),
  z.strictObject({ ...jobFields, kind: z.literal("saveUp"), role: z.enum(["buffer", "ordinary"]), target: SaveUpTargetSchema }),
  z.strictObject({ ...jobFields, kind: z.literal("payInto"), monthly: MoneySchema, payInto: ids.account }),
]);

const AllocationSchema = z.strictObject({ jobId: ids.job, amount: MoneySchema });

/** A treatment as a command carries it: a split is plain allocations, and `treatmentFor` checks they add up. */
export const TreatmentInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("needsYou") }),
  z.strictObject({ kind: z.literal("income"), fundsMonth: MonthSchema, source: z.enum(["contribution", "recurring", "other"]) }),
  z.strictObject({ kind: z.literal("transfer"), partner: ids.transaction.nullable() }),
  z.strictObject({ kind: z.literal("split"), allocations: atLeastOne(AllocationSchema, "A split needs at least one allocation.") }),
  z.strictObject({ kind: z.literal("history"), jobId: ids.job.nullable() }),
]);

export const transactionFields = {
  id: ids.transaction,
  accountId: ids.account,
  bookingDate: LocalDateSchema,
  amount: MoneySchema,
  description: text,
  counterparty: text.exactOptional(),
  transactionDate: LocalDateSchema.exactOptional(),
  reference: text.exactOptional(),
  note: text.exactOptional(),
  ruleId: ids.rule.exactOptional(),
};

/** A transaction as `recordTransaction` carries it, before its split has been checked against its amount. */
export const TransactionInputSchema = z.strictObject({ ...transactionFields, treatment: TreatmentInputSchema });

const TransactionSchema = TransactionInputSchema.transform((input, ctx) => {
  const treatment = treatmentFor(input.treatment, input.amount);
  if (treatment === null) {
    ctx.issues.push({ code: "custom", message: "The split's allocations don't add up to the transaction's amount.", input: input.treatment, path: ["treatment", "allocations"] });
    return z.NEVER;
  }
  return { ...input, treatment };
});

const RuleShareSchema = z.strictObject({ jobId: ids.job, weight: wholeNumber(1) });

export const RuleMatchSchema = z.strictObject({
  counterparty: text,
  accountId: ids.account.exactOptional(),
  min: MoneySchema.exactOptional(),
  max: MoneySchema.exactOptional(),
});

export const RuleResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("job"), jobId: ids.job }),
  z.strictObject({ kind: z.literal("split"), shares: atLeastOne(RuleShareSchema, "A rule that splits needs at least one share.") }),
]);

/** Every table's row schema. A new table fails to compile here until it has one. */
export const TableSchemas = {
  household: z.strictObject({ id: ids.household, name: text, currency: CurrencySchema, planStart: MonthSchema, evenOutStep: MoneySchema }),
  accounts: z.strictObject({
    id: ids.account,
    name: text,
    kind: AccountKindSchema,
    scope: z.enum(["shared", "paidInto"]),
    openingBalance: MoneySchema,
    openingDate: LocalDateSchema,
    number: AccountNumberSchema.exactOptional(),
    importRhythm: ImportRhythmSchema.exactOptional(),
  }),
  groups: z.strictObject({ id: ids.group, name: text, order: nonNegative, countsTowardsSavingsRate: z.boolean() }),
  jobs: JobSchema,
  budgetMonths: z.strictObject({ month: MonthSchema, state: z.enum(["open", "closed", "reopened"]) }),
  assignments: z.strictObject({ month: MonthSchema, jobId: ids.job, amount: MoneySchema }),
  transactions: TransactionSchema,
  moves: z.strictObject({
    id: ids.move,
    from: ids.account,
    to: ids.account,
    amount: MoneySchema,
    month: MonthSchema,
    reason: text,
    status: z.enum(["todo", "done", "skipped"]),
    completedBy: ids.transaction.nullable(),
  }),
  enteredValues: z.strictObject({
    id: ids.enteredValue,
    kind: z.enum(["reference", "figure", "asset", "accountBalance", "estimateOverride"]),
    subject: text,
    value: FiniteSchema,
    unit: z.enum(["money", "months", "percent", "count"]),
    asOf: LocalDateSchema,
    source: text,
  }),
  importBatches: z.strictObject({
    id: ids.importBatch,
    fileName: text,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "Not a SHA-256 fingerprint in lower-case hex"),
    format: text,
    importedAt: DateTimeSchema,
    from: LocalDateSchema,
    to: LocalDateSchema,
    rows: nonNegative,
    created: nonNegative,
    matched: nonNegative,
    pending: nonNegative,
    undone: z.boolean(),
  }),
  importRows: z.strictObject({
    id: ids.importRow,
    batchId: ids.importBatch,
    line: wholeNumber(1),
    accountId: ids.account,
    bookingDate: LocalDateSchema,
    interestDate: LocalDateSchema.exactOptional(),
    description: text,
    amount: MoneySchema,
    counterpartAccount: text.exactOptional(),
    counterpartName: text.exactOptional(),
    reference: text.exactOptional(),
    bankType: text.exactOptional(),
    original: z.strictObject({ text, currency: text }).exactOptional(),
    fingerprint: text,
    pending: z.boolean(),
    backs: ids.transaction.nullable(),
  }),
  rules: z.strictObject({ id: ids.rule, match: RuleMatchSchema, result: RuleResultSchema, origin: z.enum(["set", "learned", "accepted"]), priority: wholeNumber() }),
} satisfies { readonly [T in TableName]: z.ZodType<RowOf<T>> };
