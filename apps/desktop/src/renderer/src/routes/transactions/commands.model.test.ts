import { describe, expect, it } from "vitest";
import { type Facts, type FamilyCommand, type TransactionId, apply, month, moveId } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import { defaultFundsMonth, fundsMonthChoices, markIncome, markTransfer, saveNote, sortToJob, splitAcross } from "./commands.model.ts";
import { buildWorld, today } from "./test-support.ts";

const world = buildWorld();

function applied(facts: Facts, command: FamilyCommand): Facts {
  const result = apply(facts, command, { asOf: today });
  if (!result.ok) throw new Error(`Refused: ${result.refusal.message}`);
  return result.facts;
}
const txOf = (facts: Facts, id: TransactionId) => {
  const found = facts.transactions.get(id);
  if (found === undefined) throw new Error(`No transaction ${id}`);
  return found;
};

describe("sorting to a job", () => {
  it("gives money out to the job as a cost of the whole amount", () => {
    const after = applied(world.facts, sortToJob(txOf(world.facts, world.tx.viaplay), world.jobs.phones));
    expect(txOf(after, world.tx.viaplay).treatment).toMatchObject({ kind: "split", allocations: [{ jobId: world.jobs.phones, amount: kr(-449) }] });
  });

  it("gives money in to the job as a refund: a split of the positive amount, not income", () => {
    const after = applied(world.facts, sortToJob(txOf(world.facts, world.tx.coffeeRefund), world.jobs.coffee));
    const { treatment } = txOf(after, world.tx.coffeeRefund);
    expect(treatment).toMatchObject({ kind: "split", allocations: [{ jobId: world.jobs.coffee, amount: kr(250) }] });
    expect(treatment.kind).not.toBe("income");
  });

  it("splits across several jobs when the amounts add up, and core refuses when they don't", () => {
    const tx = txOf(world.facts, world.tx.lyse);
    const ok = applied(world.facts, splitAcross(tx, [{ jobId: world.jobs.electricity, amount: kr(-2_000) }, { jobId: world.jobs.phones, amount: kr(-1_100) }]));
    expect(txOf(ok, tx.id).treatment.kind).toBe("split");
    const bad = apply(world.facts, splitAcross(tx, [{ jobId: world.jobs.electricity, amount: kr(-2_000) }]), { asOf: today });
    expect(bad).toMatchObject({ ok: false, refusal: { code: "splitDoesNotAddUp" } });
  });
});

describe("marking a transfer", () => {
  it("pairs the two sides when the family chooses a partner", () => {
    const out = txOf(world.facts, world.tx.moveOut);
    const after = applied(world.facts, markTransfer(world.facts, out, world.tx.moveIn));
    expect(txOf(after, world.tx.moveOut).treatment).toEqual({ kind: "transfer", partner: world.tx.moveIn });
    expect(txOf(after, world.tx.moveIn).treatment).toEqual({ kind: "transfer", partner: world.tx.moveOut });
  });

  it("waits for the other side when the family says it isn't imported yet", () => {
    const after = applied(world.facts, markTransfer(world.facts, txOf(world.facts, world.tx.moveOut), null));
    expect(txOf(after, world.tx.moveOut).treatment).toEqual({ kind: "transfer", partner: null });
    expect(txOf(after, world.tx.moveIn).treatment).toEqual({ kind: "needsYou" });
  });

  it("completes the move at the bank the pair matches, whichever side the family started from", () => {
    const todo = { id: moveId(testId(8_000)), from: world.accounts.everyday, to: world.accounts.savings, amount: kr(5_000), month: month("2026-11"), reason: "Savings", status: "todo", completedBy: null } as const;
    const facts: Facts = { ...world.facts, moves: new Map([[todo.id, todo]]) };
    for (const [start, partner] of [[world.tx.moveOut, world.tx.moveIn], [world.tx.moveIn, world.tx.moveOut]] as const) {
      const after = applied(facts, markTransfer(facts, txOf(facts, start), partner));
      expect(after.moves.get(todo.id)).toMatchObject({ status: "done", completedBy: world.tx.moveOut });
    }
  });

  it("leaves a move for other accounts or another amount alone", () => {
    const other = { id: moveId(testId(8_001)), from: world.accounts.everyday, to: world.accounts.savings, amount: kr(4_000), month: month("2026-11"), reason: "Other", status: "todo", completedBy: null } as const;
    const facts: Facts = { ...world.facts, moves: new Map([[other.id, other]]) };
    const after = applied(facts, markTransfer(facts, txOf(facts, world.tx.moveOut), world.tx.moveIn));
    expect(after.moves.get(other.id)?.status).toBe("todo");
  });
});

describe("marking money in as income", () => {
  const salary = () => txOf(world.facts, world.tx.salary);

  it("funds the month after it arrived unless the family chooses another", () => {
    expect(defaultFundsMonth(salary().bookingDate)).toBe("2026-12");
    expect(fundsMonthChoices(salary().bookingDate)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(fundsMonthChoices(salary().bookingDate)).toContain(defaultFundsMonth(salary().bookingDate));
  });

  it("stores the month and the source the family chose", () => {
    const after = applied(world.facts, markIncome(salary(), month("2026-11"), "recurring"));
    expect(txOf(after, world.tx.salary).treatment).toEqual({ kind: "income", fundsMonth: "2026-11", source: "recurring" });
  });
});

describe("notes", () => {
  it("saves a note, and an empty one removes it", () => {
    const tx = txOf(world.facts, world.tx.viaplay);
    const noted = applied(world.facts, saveNote(tx, "Cancel in spring"));
    expect(txOf(noted, tx.id).note).toBe("Cancel in spring");
    const cleared = applied(noted, saveNote(txOf(noted, tx.id), ""));
    expect(txOf(cleared, tx.id).note).toBeUndefined();
  });
});
