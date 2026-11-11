/**
 * One schema per command kind, and the two ways to read a command from outside. `CommandSchema` is for the
 * main process's own records and accepts every kind. `FamilyCommandSchema` is for the page and refuses
 * `importFile`, also inside a batch, because only the main process holds a file and a page that could send
 * rows could write any transaction it liked.
 */

import { z } from "zod";
import type { BatchCommand, Command, CommandKind } from "../commands/apply.ts";
import { AccountNumberSchema, CurrencySchema, MoneySchema, MonthSchema, ids, wholeNumber } from "./primitives.ts";
import {
  AccountKindSchema,
  ImportRhythmSchema,
  JobStatusSchema,
  RuleMatchSchema,
  RuleResultSchema,
  SaveUpTargetSchema,
  SeasonalitySchema,
  SpendPlanSchema,
  TableSchemas,
  TransactionInputSchema,
  TreatmentInputSchema,
} from "./rows.ts";

/**
 * What the page may send in one batch, counting each command and each pair in a `pairTransfers` as one, so
 * the work a page can ask of the app in one `holt:run` has a bound. The app's own records are not the
 * page's: a first import of thousands of rows is one change, so `maxStoredBatchCommands` leaves room for it.
 */
export const maxBatchCommands = 500;
/** What a stored change may hold, counted the same way. It stops a runaway loop, not a first import. */
export const maxStoredBatchCommands = 100_000;
/** Levels of batch inside batch. The schema below is built with exactly this many (see `nestedBatch`). */
export const maxBatchDepth = 2;

const text = z.string();

const householdChanges = z.strictObject({
  name: text.exactOptional(),
  currency: CurrencySchema.exactOptional(),
  planStart: MonthSchema.exactOptional(),
  evenOutStep: MoneySchema.exactOptional(),
});

const accountChanges = z.strictObject({
  name: text.exactOptional(),
  kind: AccountKindSchema.exactOptional(),
  number: AccountNumberSchema.nullable().exactOptional(),
  importRhythm: ImportRhythmSchema.exactOptional(),
});

const groupChanges = z.strictObject({ name: text.exactOptional(), order: wholeNumber(0).exactOptional(), countsTowardsSavingsRate: z.boolean().exactOptional() });

const kindChanges = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("spend"), plan: SpendPlanSchema.exactOptional(), keepsMoney: z.boolean().exactOptional(), seasonality: SeasonalitySchema.exactOptional() }),
  z.strictObject({ kind: z.literal("saveUp"), target: SaveUpTargetSchema.exactOptional() }),
  z.strictObject({ kind: z.literal("payInto"), monthly: MoneySchema.exactOptional(), payInto: ids.account.exactOptional() }),
]);

const jobChanges = z.strictObject({
  name: text.exactOptional(),
  groupId: ids.group.exactOptional(),
  essential: z.boolean().exactOptional(),
  status: JobStatusSchema.exactOptional(),
  ofKind: kindChanges.exactOptional(),
});

const personChanges = z.strictObject({ name: text.exactOptional(), birthMonth: MonthSchema.nullable().exactOptional() });

const agreementChanges = z.strictObject({
  amount: MoneySchema.exactOptional(),
  day: wholeNumber().exactOptional(),
  accountId: ids.account.exactOptional(),
  to: MonthSchema.nullable().exactOptional(),
});

const ruleChanges = z.strictObject({ match: RuleMatchSchema.exactOptional(), result: RuleResultSchema.exactOptional(), priority: wholeNumber().exactOptional() });

const transferPair = z.strictObject({ a: ids.transaction, b: ids.transaction, completesMove: ids.move.exactOptional() });

const newMove = z.strictObject({ id: ids.move, from: ids.account, to: ids.account, amount: MoneySchema, month: MonthSchema, reason: text });

type Single = Exclude<Command, BatchCommand>;
type SingleKind = Single["kind"];

/** Every command kind except `batch`, which wraps these. */
const singles = {
  changeHousehold: z.strictObject({ kind: z.literal("changeHousehold"), changes: householdChanges }),
  addAccount: z.strictObject({ kind: z.literal("addAccount"), account: TableSchemas.accounts }),
  changeAccount: z.strictObject({ kind: z.literal("changeAccount"), accountId: ids.account, changes: accountChanges }),
  addGroup: z.strictObject({ kind: z.literal("addGroup"), group: TableSchemas.groups }),
  changeGroup: z.strictObject({ kind: z.literal("changeGroup"), groupId: ids.group, changes: groupChanges }),
  addJob: z.strictObject({ kind: z.literal("addJob"), job: TableSchemas.jobs }),
  changeJob: z.strictObject({ kind: z.literal("changeJob"), jobId: ids.job, changes: jobChanges }),
  deleteJob: z.strictObject({ kind: z.literal("deleteJob"), jobId: ids.job }),
  openMonth: z.strictObject({ kind: z.literal("openMonth"), month: MonthSchema }),
  closeMonth: z.strictObject({ kind: z.literal("closeMonth"), month: MonthSchema }),
  reopenMonth: z.strictObject({ kind: z.literal("reopenMonth"), month: MonthSchema }),
  assign: z.strictObject({ kind: z.literal("assign"), month: MonthSchema, jobId: ids.job, amount: MoneySchema }),
  moveAssignment: z.strictObject({ kind: z.literal("moveAssignment"), month: MonthSchema, from: ids.job, to: ids.job, amount: MoneySchema }),
  addMove: z.strictObject({ kind: z.literal("addMove"), move: newMove }),
  setMoveStatus: z.discriminatedUnion("status", [
    z.strictObject({ kind: z.literal("setMoveStatus"), moveId: ids.move, status: z.literal("done"), completedBy: ids.transaction.nullable() }),
    z.strictObject({ kind: z.literal("setMoveStatus"), moveId: ids.move, status: z.literal("skipped") }),
  ]),
  enterValue: z.strictObject({ kind: z.literal("enterValue"), value: TableSchemas.enteredValues }),
  recordTransaction: z.strictObject({ kind: z.literal("recordTransaction"), transaction: TransactionInputSchema }),
  setTreatment: z.strictObject({ kind: z.literal("setTreatment"), transactionId: ids.transaction, treatment: TreatmentInputSchema, ruleId: ids.rule.exactOptional() }),
  setNote: z.strictObject({ kind: z.literal("setNote"), transactionId: ids.transaction, note: text }),
  importFile: z.strictObject({
    kind: z.literal("importFile"),
    batch: TableSchemas.importBatches,
    rows: z.array(TableSchemas.importRows),
    transactions: z.array(TableSchemas.transactions),
  }),
  undoImport: z.strictObject({ kind: z.literal("undoImport"), batchId: ids.importBatch }),
  mergeTransactions: z.strictObject({ kind: z.literal("mergeTransactions"), keep: ids.transaction, drop: ids.transaction }),
  pairTransfers: z.strictObject({ kind: z.literal("pairTransfers"), pairs: z.array(transferPair) }),
  addRule: z.strictObject({ kind: z.literal("addRule"), rule: TableSchemas.rules }),
  changeRule: z.strictObject({ kind: z.literal("changeRule"), ruleId: ids.rule, changes: ruleChanges }),
  deleteRule: z.strictObject({ kind: z.literal("deleteRule"), ruleId: ids.rule }),
  setPlanStart: z.strictObject({ kind: z.literal("setPlanStart"), planStart: MonthSchema }),
  addPerson: z.strictObject({ kind: z.literal("addPerson"), person: TableSchemas.people }),
  changePerson: z.strictObject({ kind: z.literal("changePerson"), personId: ids.person, changes: personChanges }),
  deletePerson: z.strictObject({ kind: z.literal("deletePerson"), personId: ids.person }),
  addAgreement: z.strictObject({ kind: z.literal("addAgreement"), agreement: TableSchemas.contributionAgreements }),
  changeAgreement: z.strictObject({ kind: z.literal("changeAgreement"), agreementId: ids.agreement, changes: agreementChanges }),
  moveBucket: z.strictObject({ kind: z.literal("moveBucket"), transfer: TableSchemas.bucketTransfers }),
} satisfies { readonly [K in SingleKind]: z.ZodType<Extract<Command, { kind: K }>> };

interface Batch<C> {
  readonly kind: "batch";
  readonly commands: readonly C[];
}

type Kinded = { readonly kind: string };

function describeKind(kind: unknown, { batchAllowed, importAllowed }: { batchAllowed: boolean; importAllowed: boolean }): string {
  if (kind === "batch" && !batchAllowed) return `A batch can hold other batches only ${maxBatchDepth} levels deep.`;
  if (kind === "importFile" && !importAllowed) return "The page can't send importFile. Only the app builds an import.";
  return typeof kind === "string" ? `Unknown command kind "${kind.slice(0, 40)}".` : "A command needs a kind.";
}

/** Picks the schema by `kind` and names the problem in plain words when the kind is not one this level accepts. */
function byKind<C extends Kinded>(members: readonly z.ZodType<C>[], allowed: { batchAllowed: boolean; importAllowed: boolean }): z.ZodType<C> {
  // Zod types the options as a non-empty tuple of discriminable schemas and returns a union of their outputs. Every member here is an object schema with a literal kind.
  const options = members as unknown as readonly [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]];
  const union = z.discriminatedUnion("kind", options, {
    error: (issue) => (issue.code === "invalid_union" ? describeKind((issue.input as { kind?: unknown } | undefined)?.kind, allowed) : undefined),
  });
  return union as unknown as z.ZodType<C>;
}

/** What one command counts for against a batch's limit: one, or one for each pair in a `pairTransfers`. Reads the length of the list inside, never its items. */
function weightOf(item: unknown): number {
  if (typeof item !== "object" || item === null) return 1;
  const { kind, pairs } = item as { kind?: unknown; pairs?: unknown };
  return kind === "pairTransfers" && Array.isArray(pairs) ? Math.max(1, pairs.length) : 1;
}

/** The commands in a batch's list, counting each batch inside it as one command plus the commands it holds. */
function commandsIn(items: readonly unknown[]): number {
  let count = 0;
  for (const item of items) {
    count += weightOf(item);
    if (typeof item !== "object" || item === null || (item as { kind?: unknown }).kind !== "batch") continue;
    const inner = (item as { commands?: unknown }).commands;
    if (Array.isArray(inner)) for (const innerItem of inner) count += weightOf(innerItem);
  }
  return count;
}

function batchOf<C extends Kinded>(item: z.ZodType<C>, max: number): z.ZodType<Batch<C>> {
  const bounded = z.array(z.unknown()).superRefine((items, ctx) => {
    const count = commandsIn(items);
    if (count > max) {
      ctx.addIssue({ code: "custom", message: `A batch can hold at most ${max} commands, counting those in batches inside it and each pair in a pairTransfers. This one holds ${count}.` });
    }
  });
  return z.strictObject({ kind: z.literal("batch"), commands: bounded.pipe(z.array(item)) });
}

/** A batch that holds commands and batches, where a batch inside it holds commands only: two levels. */
function nestedBatch<S extends Kinded>(members: readonly z.ZodType<S>[], importAllowed: boolean, max: number): z.ZodType<Batch<S | Batch<S>>> {
  const innermost = batchOf(byKind(members, { batchAllowed: false, importAllowed }), max);
  return batchOf(byKind<S | Batch<S>>([...members, innermost], { batchAllowed: true, importAllowed }), max);
}

/** Every kind of command, each checked by its own schema. */
export const commandSchemas = {
  ...singles,
  batch: nestedBatch<Single>(Object.values(singles), true, maxStoredBatchCommands),
} satisfies { readonly [K in CommandKind]: z.ZodType<Extract<Command, { kind: K }>> };

export const CommandSchema: z.ZodType<Command> = byKind<Command>(Object.values(commandSchemas), { batchAllowed: true, importAllowed: true });

type FamilySingle = Exclude<Single, { readonly kind: "importFile" }>;

/** What the page may send: no `importFile`, not even inside a batch. */
export type FamilyCommand = FamilySingle | { readonly kind: "batch"; readonly commands: readonly FamilyCommand[] };

export type FamilyCommandKind = FamilyCommand["kind"];

const { importFile: _onlyTheAppImports, ...storedFamilySingles } = singles;

/** The page's `pairTransfers` holds as many pairs as a page's batch holds commands. */
const familySingles = {
  ...storedFamilySingles,
  pairTransfers: z.strictObject({
    kind: z.literal("pairTransfers"),
    pairs: z.array(transferPair).max(maxBatchCommands, `A pairTransfers can hold at most ${maxBatchCommands} pairs.`),
  }),
};

export const FamilyCommandSchema: z.ZodType<FamilyCommand> = byKind<FamilyCommand>(
  [...Object.values(familySingles), nestedBatch<FamilySingle>(Object.values(familySingles), false, maxBatchCommands)],
  { batchAllowed: true, importAllowed: false },
);

export const familyCommandKinds: readonly FamilyCommandKind[] = [...Object.keys(familySingles), "batch"] as FamilyCommandKind[];
