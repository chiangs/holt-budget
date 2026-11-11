/**
 * The change record as it is stored: a command, the patch it made, who made it and when. A patch row is read
 * with the schema of its table, and a change's key must be the key of the row it names, so a stored patch
 * can't point one row at another.
 */

import { z } from "zod";
import type { Command } from "../commands/apply.ts";
import type { ChangeRecord } from "../change-log.ts";
import { type RowOf, type TableName, keyOfRow } from "../facts.ts";
import type { RowChange } from "../patch.ts";
import { CommandSchema } from "./commands.ts";
import { DateTimeSchema, ids } from "./primitives.ts";
import { TableSchemas } from "./rows.ts";

function changeOf<T extends TableName>(table: T, row: z.ZodType<RowOf<T>>): z.ZodType<Extract<RowChange, { table: T }>> {
  return z
    .strictObject({ table: z.literal(table), key: z.string(), before: row.nullable(), after: row.nullable() })
    .transform((change, ctx) => {
      const named = change.after ?? change.before;
      if (named === null) {
        ctx.issues.push({ code: "custom", message: `A change to ${table} needs a row before or a row after.`, input: change });
        return z.NEVER;
      }
      for (const side of ["before", "after"] as const) {
        const row = change[side];
        if (row !== null && keyOfRow(table, row) !== change.key) {
          ctx.issues.push({ code: "custom", message: `The ${side} row in ${table} has a different key from the change's key.`, input: change.key, path: ["key"] });
          return z.NEVER;
        }
      }
      // The registry below ties each table to its own row schema, which the generic signature can't express for the union of changes.
      return { table, key: keyOfRow(table, named), before: change.before, after: change.after } as unknown as Extract<RowChange, { table: T }>;
    });
}

const changeSchemas = {
  household: changeOf("household", TableSchemas.household),
  accounts: changeOf("accounts", TableSchemas.accounts),
  groups: changeOf("groups", TableSchemas.groups),
  jobs: changeOf("jobs", TableSchemas.jobs),
  budgetMonths: changeOf("budgetMonths", TableSchemas.budgetMonths),
  assignments: changeOf("assignments", TableSchemas.assignments),
  transactions: changeOf("transactions", TableSchemas.transactions),
  moves: changeOf("moves", TableSchemas.moves),
  enteredValues: changeOf("enteredValues", TableSchemas.enteredValues),
  importBatches: changeOf("importBatches", TableSchemas.importBatches),
  importRows: changeOf("importRows", TableSchemas.importRows),
  rules: changeOf("rules", TableSchemas.rules),
  people: changeOf("people", TableSchemas.people),
  contributionAgreements: changeOf("contributionAgreements", TableSchemas.contributionAgreements),
  bucketTransfers: changeOf("bucketTransfers", TableSchemas.bucketTransfers),
} satisfies { readonly [T in TableName]: z.ZodType<Extract<RowChange, { table: T }>> };

const rowChange = z.discriminatedUnion("table", Object.values(changeSchemas) as unknown as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]]) as unknown as z.ZodType<RowChange>;

export const PatchSchema: z.ZodType<readonly RowChange[]> = z.array(rowChange);

export const ChangeAuthorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("family") }),
  z.strictObject({ kind: z.literal("proposal"), proposalId: ids.proposal }),
]);

/** A change record read back from storage. */
export type StoredChange = ChangeRecord<Command>;

export const StoredChangeSchema = z.strictObject({
  id: ids.change,
  at: DateTimeSchema,
  by: ChangeAuthorSchema,
  command: CommandSchema,
  patch: PatchSchema,
}) satisfies z.ZodType<StoredChange>;
