import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ChangeLog, emptyChangeLog, redo, undo } from "./change-log.ts";
import { type Command, commit } from "./commands/apply.ts";
import { month } from "./dates.ts";
import { assignmentKey } from "./facts.ts";
import { proposalId } from "./ids.ts";
import { type DecideResult, type Proposal, type ProposalStatus, accept, commitProposal, expire, isStale, lastChange, reject, suggest } from "./proposal.ts";
import { accepted as acceptedFacts, changeMeta, commandHousehold, today } from "./testing/command-household.ts";
import { kr, testId } from "./testing/facts-builder.ts";

const h = commandHousehold();
const november = month("2026-11");
const command: Command = { kind: "assign", month: november, jobId: h.jobs.unused, amount: kr(250) };

function proposalBasedOn(log: ChangeLog<Command>): Proposal {
  return suggest<Command>({
    id: proposalId(testId(400_000)),
    command,
    evidence: { transactions: [h.transactions.shopping], filter: null },
    origin: { kind: "assistant", model: "test-model" },
    basedOn: lastChange(log),
  });
}

function decided(result: DecideResult<Command>): Proposal {
  if (!result.ok) throw new Error(result.refusal.message);
  return result.proposal;
}

const decisions = { accept, reject, expire } as const;
type Decision = keyof typeof decisions;
const statusAfter: Record<Decision, ProposalStatus> = { accept: "accepted", reject: "rejected", expire: "expired" };

describe("a proposal's status (rule 8)", () => {
  it("starts as suggested and changes once, to accepted, rejected or expired", () => {
    const at = "2026-11-09T12:00:00Z";
    expect(proposalBasedOn(emptyChangeLog()).state).toEqual({ status: "suggested" });
    expect(decided(accept(proposalBasedOn(emptyChangeLog()), at)).state).toEqual({ status: "accepted", decidedAt: at });
    expect(decided(reject(proposalBasedOn(emptyChangeLog()), at)).state).toEqual({ status: "rejected", decidedAt: at });
    expect(decided(expire(proposalBasedOn(emptyChangeLog()), at)).state).toEqual({ status: "expired", decidedAt: at });
  });

  it("never changes again once decided", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<Decision>("accept", "reject", "expire"), { minLength: 1, maxLength: 5 }), (sequence) => {
        let proposal = proposalBasedOn(emptyChangeLog());
        sequence.forEach((decision, i) => {
          const result = decisions[decision](proposal, `2026-11-09T12:0${i}:00Z`);
          expect(result.ok).toBe(i === 0);
          if (result.ok) proposal = result.proposal;
          else expect(result.refusal.code).toBe("proposalNotSuggested");
        });
        expect(proposal.state).toEqual({ status: statusAfter[sequence[0]!], decidedAt: "2026-11-09T12:00:00Z" });
      }),
    );
  });
});

describe("only an accepted, current proposal changes data (rule 8)", () => {
  it("refuses to commit a proposal in any status but accepted", () => {
    const statuses: Record<Exclude<ProposalStatus, "accepted">, Proposal> = {
      suggested: proposalBasedOn(emptyChangeLog()),
      rejected: decided(reject(proposalBasedOn(emptyChangeLog()), "2026-11-09T12:00:00Z")),
      expired: decided(expire(proposalBasedOn(emptyChangeLog()), "2026-11-09T12:00:00Z")),
    };
    for (const proposal of Object.values(statuses)) {
      expect(commitProposal(h.facts, emptyChangeLog(), proposal, changeMeta(1), { asOf: today })).toMatchObject({ ok: false, refusal: { code: "proposalNotAccepted" } });
    }
  });

  it("commits an accepted proposal's command, recorded as the proposal's change", () => {
    const proposal = decided(accept(proposalBasedOn(emptyChangeLog()), "2026-11-09T12:00:00Z"));
    const result = commitProposal(h.facts, emptyChangeLog(), proposal, changeMeta(1), { asOf: today });
    expect(acceptedFacts(result).assignments.get(assignmentKey(november, h.jobs.unused))?.amount).toBe(kr(250));
    expect(result.ok && result.record).toMatchObject({ id: changeMeta(1).id, by: { kind: "proposal", proposalId: proposal.id }, command });
  });

  it("refuses a stale proposal: the data changed after it was worked out", () => {
    const proposal = decided(accept(proposalBasedOn(emptyChangeLog()), "2026-11-09T12:00:00Z"));
    const later = commit(h.facts, emptyChangeLog(), { kind: "changeGroup", groupId: h.living, changes: { name: "Daily life" } }, changeMeta(1), { asOf: today });
    if (!later.ok) throw new Error("refused");
    expect(commitProposal(later.facts, later.log, proposal, changeMeta(2), { asOf: today })).toMatchObject({ ok: false, refusal: { code: "proposalStale" } });
  });

  it("is stale when a change is made or undone after it was worked out, and current again when the log is back where it was", () => {
    const first = commit(h.facts, emptyChangeLog(), { kind: "changeGroup", groupId: h.living, changes: { name: "Daily life" } }, changeMeta(1), { asOf: today });
    if (!first.ok) throw new Error("refused");
    const proposal = proposalBasedOn(first.log);
    expect(isStale(proposal, first.log)).toBe(false);
    const second = commit(first.facts, first.log, { kind: "changeGroup", groupId: h.living, changes: { order: 2 } }, changeMeta(2), { asOf: today });
    if (!second.ok) throw new Error("refused");
    expect(isStale(proposal, second.log)).toBe(true);
    const back = undo(second.facts, second.log);
    if (!back.ok) throw new Error("undo refused");
    expect(isStale(proposal, back.log)).toBe(false);
    const further = undo(back.facts, back.log);
    if (!further.ok) throw new Error("undo refused");
    expect(isStale(proposal, further.log)).toBe(true);
    const again = redo(further.facts, further.log);
    expect(again.ok && isStale(proposal, again.log)).toBe(false);
  });
});
