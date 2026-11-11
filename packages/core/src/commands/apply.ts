/**
 * Every change is a command (domain model, "Changes are commands"). `apply` is the one step that turns a
 * command into a patch and new facts, or a refusal. Previews call it and throw the result away, proposals
 * hold a command until the family accepts it, and saved changes go through `commit`, which records the
 * patch so undo can restore every row. It is pure: no clock, no IDs made here, and the input is never changed.
 */

import { type ChangeAuthor, type ChangeLog, type ChangeRecord, record } from "../change-log.ts";
import type { LocalDate } from "../dates.ts";
import type { Facts } from "../facts.ts";
import type { ChangeId } from "../ids.ts";
import { type Patch, PatchConflict, type PatchBuilder, diffFacts, patchBuilder } from "../patch.ts";
import { type AccountAndGroupCommand, accountAndGroupHandlers } from "./accounts-and-groups.ts";
import { type BucketTransferCommand, bucketTransferHandlers } from "./bucket-transfers.ts";
import { addedViolations } from "./check-facts.ts";
import { type ContributionCommand, contributionHandlers } from "./contributions.ts";
import { type EnteredValueCommand, enteredValueHandlers } from "./entered-values.ts";
import { type HouseholdCommand, householdHandlers } from "./household.ts";
import { type ImportCommand, importHandlers } from "./imports.ts";
import { type JobCommand, jobHandlers } from "./jobs.ts";
import { type MonthCommand, monthHandlers } from "./months.ts";
import { type MoveCommand, moveHandlers } from "./moves.ts";
import { type PersonCommand, personHandlers } from "./people.ts";
import { type Outcome, type Refusal, breaksFacts } from "./refusal.ts";
import { type RuleCommand, ruleHandlers } from "./rules.ts";
import { type TransactionCommand, transactionHandlers } from "./transactions.ts";

/** Several commands as one change with one undo, such as "accept all 21". One refusal refuses the whole batch and changes nothing. */
export interface BatchCommand {
  readonly kind: "batch";
  readonly commands: readonly Command[];
}

type SingleCommand =
  | HouseholdCommand
  | AccountAndGroupCommand
  | JobCommand
  | MonthCommand
  | MoveCommand
  | EnteredValueCommand
  | TransactionCommand
  | ImportCommand
  | RuleCommand
  | PersonCommand
  | ContributionCommand
  | BucketTransferCommand;

export type Command = SingleCommand | BatchCommand;

export type CommandKind = Command["kind"];

export interface ApplyContext {
  /** Today, from the caller. Opening a month and deleting a job read the figures as of this day. */
  readonly asOf: LocalDate;
}

/** One handler per command kind, each given the command of its own kind. */
export type Handlers<C extends { readonly kind: string }> = {
  readonly [K in C["kind"]]: (facts: Facts, command: Extract<C, { readonly kind: K }>, context: ApplyContext) => Outcome;
};

const handlers: Handlers<SingleCommand> = {
  ...householdHandlers,
  ...accountAndGroupHandlers,
  ...jobHandlers,
  ...monthHandlers,
  ...moveHandlers,
  ...enteredValueHandlers,
  ...transactionHandlers,
  ...importHandlers,
  ...ruleHandlers,
  ...personHandlers,
  ...contributionHandlers,
  ...bucketTransferHandlers,
};

export const commandKinds = [...Object.keys(handlers), "batch"] as readonly CommandKind[];

export type ApplyResult = { readonly ok: true; readonly facts: Facts; readonly patch: Patch } | { readonly ok: false; readonly refusal: Refusal };

export function apply(facts: Facts, command: Command, context: ApplyContext): ApplyResult {
  const builder = patchBuilder(facts);
  const outcome = perform(builder, command, context);
  if (!outcome.ok) return outcome;
  const after = builder.facts();
  const [first, ...rest] = addedViolations(facts, after);
  if (first !== undefined) return { ok: false, refusal: breaksFacts([first, ...rest]) };
  return { ok: true, facts: after, patch: command.kind === "batch" ? diffFacts(facts, after) : outcome.patch };
}

/**
 * Runs a command's handler against the facts the commands before it left and applies its patch to the
 * builder. A batch runs its commands in order, so each sees what the one before did, and the whole batch is
 * checked once, by `apply`, against the facts it started from.
 */
function perform(builder: PatchBuilder, command: Command, context: ApplyContext): Outcome {
  if (command.kind === "batch") {
    for (const inner of command.commands) {
      const result = perform(builder, inner, context);
      if (!result.ok) return result;
    }
    return { ok: true, patch: [] };
  }
  // TypeScript can't relate a command to the handler its kind picks out, which `Handlers` guarantees.
  const handler = handlers[command.kind] as (facts: Facts, command: Command, context: ApplyContext) => Outcome;
  const outcome = handler(builder.facts(), command, context);
  if (!outcome.ok) return outcome;
  const mismatches = builder.apply(outcome.patch);
  if (mismatches.length > 0) throw new PatchConflict(mismatches);
  return outcome;
}

export interface ChangeMeta {
  readonly id: ChangeId;
  /** ISO datetime, from the caller. */
  readonly at: string;
  readonly by: ChangeAuthor;
}

export type CommitResult =
  | { readonly ok: true; readonly facts: Facts; readonly log: ChangeLog<Command>; readonly record: ChangeRecord<Command> }
  | { readonly ok: false; readonly refusal: Refusal };

/** Apply a command and record it, so it can be undone. */
export function commit(facts: Facts, log: ChangeLog<Command>, command: Command, meta: ChangeMeta, context: ApplyContext): CommitResult {
  const result = apply(facts, command, context);
  if (!result.ok) return result;
  const entry: ChangeRecord<Command> = { ...meta, command, patch: result.patch };
  return { ok: true, facts: result.facts, log: record(log, entry), record: entry };
}
