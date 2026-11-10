import { describe, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { Command, CommandKind } from "../commands/apply.ts";
import type { ChangeAuthor, ChangeRecord } from "../change-log.ts";
import type { RowOf, TableName, Transaction } from "../facts.ts";
import type { TreatmentInput } from "../commands/transactions.ts";
import { commandSchemas } from "./commands.ts";
import { ChangeAuthorSchema, StoredChangeSchema } from "./patch.ts";
import { TableSchemas, TransactionInputSchema } from "./rows.ts";

/** The type without `readonly`, since Zod's output is mutable and the core types are not. Brands and primitives stay as they are. */
type Mutable<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : { -readonly [K in keyof T]: Mutable<T[K]> };

type Output<S extends z.ZodType> = Mutable<z.output<S>>;

type SingleKind = Exclude<CommandKind, "batch">;

describe("each schema produces exactly the core type", () => {
  it("for the row of every table", () => {
    expectTypeOf<{ [T in TableName]: Output<(typeof TableSchemas)[T]> }>().toEqualTypeOf<{ [T in TableName]: Mutable<RowOf<T>> }>();
  });

  it("for a transaction as a command carries it, with its split as plain allocations", () => {
    expectTypeOf<Output<typeof TransactionInputSchema>>().toEqualTypeOf<Mutable<Omit<Transaction, "treatment"> & { readonly treatment: TreatmentInput }>>();
  });

  it("for every kind of command except a batch", () => {
    expectTypeOf<{ [K in SingleKind]: Output<(typeof commandSchemas)[K]> }>().toEqualTypeOf<{ [K in SingleKind]: Mutable<Extract<Command, { kind: K }>> }>();
  });

  it("for a batch, which the schema limits to two levels, so every batch it reads is a core batch", () => {
    expectTypeOf<z.output<(typeof commandSchemas)["batch"]>>().toExtend<Extract<Command, { kind: "batch" }>>();
  });

  it("for who made a change and for a stored change", () => {
    expectTypeOf<Output<typeof ChangeAuthorSchema>>().toEqualTypeOf<Mutable<ChangeAuthor>>();
    expectTypeOf<Output<typeof StoredChangeSchema>>().toEqualTypeOf<Mutable<ChangeRecord<Command>>>();
  });
});
