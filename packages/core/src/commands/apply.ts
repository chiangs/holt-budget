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
import { type Patch, applyPatch } from "../patch.ts";
import { type AccountAndGroupCommand, accountAndGroupHandlers } from "./accounts-and-groups.ts";
import { addedViolations } from "./check-facts.ts";
import { type EnteredValueCommand, enteredValueHandlers } from "./entered-values.ts";
import { type HouseholdCommand, householdHandlers } from "./household.ts";
import { type JobCommand, jobHandlers } from "./jobs.ts";
import { type MonthCommand, monthHandlers } from "./months.ts";
import { type MoveCommand, moveHandlers } from "./moves.ts";
import { type Outcome, type Refusal, breaksFacts } from "./refusal.ts";
import { type TransactionCommand, transactionHandlers } from "./transactions.ts";

export type Command =
  | HouseholdCommand
  | AccountAndGroupCommand
  | JobCommand
  | MonthCommand
  | MoveCommand
  | EnteredValueCommand
  | TransactionCommand;

export type CommandKind = Command["kind"];

export interface ApplyContext {
  /** Today, from the caller. Opening a month and deleting a job read the figures as of this day. */
  readonly asOf: LocalDate;
}

/** One handler per command kind, each given the command of its own kind. */
export type Handlers<C extends { readonly kind: string }> = {
  readonly [K in C["kind"]]: (facts: Facts, command: Extract<C, { readonly kind: K }>, context: ApplyContext) => Outcome;
};

const handlers: Handlers<Command> = {
  ...householdHandlers,
  ...accountAndGroupHandlers,
  ...jobHandlers,
  ...monthHandlers,
  ...moveHandlers,
  ...enteredValueHandlers,
  ...transactionHandlers,
};

export const commandKinds = Object.keys(handlers) as readonly CommandKind[];

export type ApplyResult = { readonly ok: true; readonly facts: Facts; readonly patch: Patch } | { readonly ok: false; readonly refusal: Refusal };

export function apply(facts: Facts, command: Command, context: ApplyContext): ApplyResult {
  // TypeScript can't relate a command to the handler its kind picks out, which `Handlers` guarantees.
  const handler = handlers[command.kind] as (facts: Facts, command: Command, context: ApplyContext) => Outcome;
  const outcome = handler(facts, command, context);
  if (!outcome.ok) return outcome;
  const after = applyPatch(facts, outcome.patch);
  const [first, ...rest] = addedViolations(facts, after);
  if (first !== undefined) return { ok: false, refusal: breaksFacts([first, ...rest]) };
  return { ok: true, facts: after, patch: outcome.patch };
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
