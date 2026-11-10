/**
 * Proposals (domain model, "Proposal"; rule 8). Whatever the assistant or the app's own detection suggests is
 * a proposal: the exact command it would apply, its evidence, where it came from, and the last change it was
 * worked out from. A proposal never changes the facts by itself. Accepting it only changes its status; the one
 * way from a proposal to a change is `commitProposal`, which needs an accepted proposal whose data hasn't moved.
 */

import type { Filter } from "./ask/query.ts";
import type { ChangeLog } from "./change-log.ts";
import { type ApplyContext, type Command, type CommitResult, commit } from "./commands/apply.ts";
import { type Refusal, refusal } from "./commands/refusal.ts";
import type { Facts } from "./facts.ts";
import type { ChangeId, Id, ProposalId, TransactionId } from "./ids.ts";

/** Who suggested it: the assistant (and which local model), or the app's own detection (and which). */
export type ProposalOrigin = { readonly kind: "assistant"; readonly model: string } | { readonly kind: "app"; readonly source: string };

export interface Evidence {
  readonly transactions: readonly TransactionId[];
  /** The filter that found them, when there was one. */
  readonly filter: Filter | null;
}

export type ProposalStatus = "suggested" | "accepted" | "rejected" | "expired";

export type ProposalState =
  | { readonly status: "suggested" }
  /** `decidedAt` is an ISO datetime from the caller: when the family decided, or when the app expired it. */
  | { readonly status: Exclude<ProposalStatus, "suggested">; readonly decidedAt: string };

export interface Proposal<C = Command> {
  readonly id: ProposalId;
  readonly command: C;
  readonly evidence: Evidence;
  readonly origin: ProposalOrigin;
  /** The last change in the log when the proposal was worked out, or null for an empty log. */
  readonly basedOn: ChangeId | null;
  readonly state: ProposalState;
}

/** The only moves a proposal's status can make. Every decision is final. */
const transitions: { readonly [S in ProposalStatus]: readonly Exclude<ProposalStatus, "suggested">[] } = {
  suggested: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
};

export function suggest<C>(fields: Omit<Proposal<C>, "state">): Proposal<C> {
  return { ...fields, state: { status: "suggested" } };
}

export type DecideResult<C> = { readonly ok: true; readonly proposal: Proposal<C> } | { readonly ok: false; readonly refusal: Refusal };

function decide<C>(proposal: Proposal<C>, status: Exclude<ProposalStatus, "suggested">, at: string): DecideResult<C> {
  if (!transitions[proposal.state.status].includes(status)) return { ok: false, refusal: refusal("proposalNotSuggested") };
  return { ok: true, proposal: { ...proposal, state: { status, decidedAt: at } } };
}

export function accept<C>(proposal: Proposal<C>, at: string): DecideResult<C> {
  return decide(proposal, "accepted", at);
}

export function reject<C>(proposal: Proposal<C>, at: string): DecideResult<C> {
  return decide(proposal, "rejected", at);
}

export function expire<C>(proposal: Proposal<C>, at: string): DecideResult<C> {
  return decide(proposal, "expired", at);
}

/** The last change the log holds, which a new proposal records as `basedOn`. */
export function lastChange(log: ChangeLog<unknown>): ChangeId | null {
  return log.done.at(-1)?.id ?? null;
}

/** Stale when the data has changed (or a change was undone) since the proposal was worked out. */
export function isStale(proposal: Proposal<unknown>, log: ChangeLog<unknown>): boolean {
  return lastChange(log) !== proposal.basedOn;
}

/** Apply and record an accepted, current proposal's command, with the proposal as its author (rule 8). */
export function commitProposal(
  facts: Facts,
  log: ChangeLog<Command>,
  proposal: Proposal<Command>,
  meta: { readonly id: ChangeId; readonly at: string },
  context: ApplyContext,
): CommitResult {
  if (proposal.state.status !== "accepted") return { ok: false, refusal: refusal("proposalNotAccepted") };
  if (isStale(proposal, log)) return { ok: false, refusal: refusal("proposalStale") };
  return commit(facts, log, proposal.command, { ...meta, by: { kind: "proposal", proposalId: proposal.id } }, context);
}
