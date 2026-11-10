/**
 * Each kind of object has its own branded ID, so a job's ID cannot be passed where an account's belongs.
 * IDs are UUIDv7 text. Core never makes one, because making an ID needs a clock and randomness, and core
 * does no I/O: the main process makes them and a command carries them in, which keeps `apply` deterministic.
 */

declare const idBrand: unique symbol;

export type Id<Kind extends string> = string & { readonly [idBrand]: Kind };

export class IdError extends Error {
  override name = "IdError";
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function idOf<Kind extends string>(kind: Kind): (value: string) => Id<Kind> {
  return (value) => {
    if (!uuid.test(value)) throw new IdError(`Not a ${kind} ID: "${value}"`);
    return value as Id<Kind>;
  };
}

export type HouseholdId = Id<"household">;
export type AccountId = Id<"account">;
export type GroupId = Id<"group">;
export type JobId = Id<"job">;
export type TransactionId = Id<"transaction">;
export type MoveId = Id<"move">;
export type EnteredValueId = Id<"enteredValue">;
export type ChangeId = Id<"change">;
export type ProposalId = Id<"proposal">;
export type ImportBatchId = Id<"importBatch">;
export type ImportRowId = Id<"importRow">;
export type RuleId = Id<"rule">;

export const householdId = idOf("household");
export const accountId = idOf("account");
export const groupId = idOf("group");
export const jobId = idOf("job");
export const transactionId = idOf("transaction");
export const moveId = idOf("move");
export const enteredValueId = idOf("enteredValue");
export const changeId = idOf("change");
export const proposalId = idOf("proposal");
export const importBatchId = idOf("importBatch");
export const importRowId = idOf("importRow");
export const ruleId = idOf("rule");
