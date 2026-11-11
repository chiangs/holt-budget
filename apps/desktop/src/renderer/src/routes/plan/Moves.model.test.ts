import { type Facts, type FamilyCommand, type MoveId, apply, computeFigures, localDate, month } from "@holt/core";
import { factsBuilder, kr } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { moneyWorld, today } from "./MoneyIn.world.ts";
import { type MoveForm, type MoveRow, type MoveStatusLine, type MovesView, addedMoveWords, markDone, markedDoneWords, matchedTransfers, moveAccounts, moveProblemField, moveProblemWords, moveWords, movesView, planAddMove, proofWords, skip, skippedWords, statusWords, transferWindow, unmovedWords } from "./Moves.model.ts";
import { newMoveId } from "./MoneyIn.ids.ts";
import { NOK } from "@holt/core/testing";

const nov = month("2026-11");
const asOf = { asOf: today };

function viewOf(facts: Facts): MovesView {
  return movesView(facts, computeFigures(facts, today), nov);
}

const toBills = (rows: readonly MoveRow[]) => rows.find((row) => row.toName === "Bills");

describe("the monthly moves", () => {
  const world = moneyWorld();
  const view = viewOf(world.facts);

  it("names each move between two accounts, largest first, as something still to do", () => {
    expect(view.rows.map((row) => [row.fromName, row.toName, row.amount, row.status.kind, row.kind])).toEqual([
      ["Everyday", "Bills", kr(15_000), "toDo", "monthly"],
      ["Everyday", "Deposit", kr(3_000), "toDo", "monthly"],
    ]);
  });

  it("offers no action on a monthly move, because only an import can show it done", () => {
    expect(view.rows.map((row) => [row.canAct, row.moveId])).toEqual([
      [false, null],
      [false, null],
    ]);
  });

  it("says what no move can cover as a plain note", () => {
    expect(view.unmoved).toEqual([{ accountId: world.accounts.everyday, accountName: "Everyday", kind: "surplus", amount: kr(42_000) }]);
    expect(unmovedWords(view.unmoved[0] as NonNullable<(typeof view.unmoved)[0]>)).toEqual({
      id: "plan.moves.unmoved.surplus",
      values: { amount: { money: kr(42_000) }, account: "Everyday" },
    });
    expect(unmovedWords({ accountId: world.accounts.bills, accountName: "Bills", kind: "moveIn", amount: kr(900) })).toEqual({
      id: "plan.moves.unmoved.moveIn",
      values: { amount: { money: kr(900) }, account: "Bills" },
    });
  });

  it("has no rows when the month needs no move", () => {
    const b = factsBuilder({ planStart: "2026-10" });
    b.account({ name: "Everyday", openingBalance: kr(1_000), openingDate: "2026-09-30" });
    b.budgetMonth("2026-11", "open");
    expect(viewOf(b.facts()).rows).toEqual([]);
  });

  it("shows a move done once an import has paired a transfer for the whole amount, with the date it matched", () => {
    const done = moneyWorld(({ b, accounts }) => {
      b.transfer({ from: accounts.everyday, to: accounts.bills, date: "2026-10-21", amount: kr(15_000) });
    });
    const row = toBills(viewOf(done.facts).rows);
    expect(row?.status).toEqual({ kind: "done", proof: { kind: "import", count: 1, last: "2026-10-21" } });
    expect(row?.canAct).toBe(false);
    expect(row && proofWords(row.status)).toEqual({ id: "plan.moves.proof.import", values: { count: 1, date: { day: "2026-10-21" } } });
  });

  it("shows a move partly done while the transfers cover some of it, and still to do when they cover none", () => {
    const part = moneyWorld(({ b, accounts }) => {
      b.transfer({ from: accounts.everyday, to: accounts.bills, date: "2026-10-21", amount: kr(6_000) });
    });
    expect(toBills(viewOf(part.facts).rows)?.status).toEqual({ kind: "partlyDone", done: kr(6_000), of: kr(15_000) });
    expect(statusWords({ kind: "partlyDone", done: kr(6_000), of: kr(15_000) })).toEqual({ id: "plan.moves.status.partlyDone", values: { done: { money: kr(6_000) }, total: { money: kr(15_000) } } });
  });

  it("counts several transfers and names the latest", () => {
    const two = moneyWorld(({ b, accounts }) => {
      b.transfer({ from: accounts.everyday, to: accounts.bills, date: "2026-10-21", amount: kr(9_000) });
      b.transfer({ from: accounts.everyday, to: accounts.bills, date: "2026-10-28", amount: kr(6_000) });
    });
    const row = toBills(viewOf(two.facts).rows);
    expect(row?.status).toEqual({ kind: "done", proof: { kind: "import", count: 2, last: "2026-10-28" } });
  });

  it("agrees with core on which transfers count, day by day around the edges of the window", () => {
    expect(transferWindow(nov)).toEqual({ start: "2026-10-15", end: "2026-11-30" });
    const days = Array.from({ length: 33 }, (_, i) => new Date(Date.UTC(2026, 9, 9 + i)).toISOString().slice(0, 10));
    for (const date of days.filter((d) => d <= "2026-11-10")) {
      const built = moneyWorld(({ b, accounts }) => {
        b.transfer({ from: accounts.everyday, to: accounts.bills, date, amount: kr(15_000) });
      });
      const row = toBills(viewOf(built.facts).rows);
      const counts = date >= "2026-10-15";
      expect(row?.status.kind, date).toBe(counts ? "done" : "toDo");
      const matched = matchedTransfers(built.facts, built.accounts.everyday, built.accounts.bills, nov, today);
      expect(matched !== null, date).toBe(counts);
    }
  });

  it("does not count a transfer in the other direction or between other accounts", () => {
    const wrong = moneyWorld(({ b, accounts }) => {
      b.transfer({ from: accounts.bills, to: accounts.everyday, date: "2026-10-21", amount: kr(15_000) });
      b.transfer({ from: accounts.everyday, to: accounts.deposit, date: "2026-10-21", amount: kr(15_000) });
    });
    expect(toBills(viewOf(wrong.facts).rows)?.status.kind).toBe("toDo");
  });
});

describe("the one-off moves", () => {
  const withMove = (status: "todo" | "done" | "skipped" = "todo", reason = "Cover the dentist") =>
    moneyWorld(({ b, accounts }) => {
      b.move({ from: accounts.deposit, to: accounts.everyday, amount: kr(2_500), month: "2026-11", status, reason });
    });

  const oneOff = (facts: Facts) => viewOf(facts).rows.find((row) => row.kind === "oneOff");

  it("lists a move still to do with the reason the family gave, and lets the family mark it done or skip it", () => {
    const row = oneOff(withMove().facts);
    expect(row).toMatchObject({ fromName: "Deposit", toName: "Everyday", amount: kr(2_500), reason: "Cover the dentist", canAct: true, status: { kind: "toDo" } });
  });

  it("lists the monthly moves first and the one-off moves after them", () => {
    expect(viewOf(withMove().facts).rows.map((row) => row.kind)).toEqual(["monthly", "monthly", "oneOff"]);
  });

  it("leaves out a move for another month", () => {
    const other = moneyWorld(({ b, accounts }) => {
      b.move({ from: accounts.deposit, to: accounts.everyday, amount: kr(2_500), month: "2026-12" });
    });
    expect(oneOff(other.facts)).toBeUndefined();
  });

  it("says a move the family marked done was marked by them, and offers nothing more", () => {
    const row = oneOff(withMove("done").facts);
    expect(row?.status).toEqual({ kind: "done", proof: { kind: "byYou" } });
    expect(row?.canAct).toBe(false);
    expect(row && proofWords(row.status)).toEqual({ id: "plan.moves.proof.byYou" });
  });

  it("says a skipped move is skipped, and not done", () => {
    const row = oneOff(withMove("skipped").facts);
    expect(row?.status).toEqual({ kind: "skipped" });
    expect(row?.canAct).toBe(false);
    expect(row && proofWords(row.status)).toBeNull();
  });

  it("shows a move an import completed as matched to that transfer, with its date", () => {
    const world = moneyWorld(({ b, accounts }) => {
      b.move({ from: accounts.deposit, to: accounts.everyday, amount: kr(2_500), month: "2026-11", reason: "" });
      b.transfer({ from: accounts.deposit, to: accounts.everyday, date: "2026-11-04", amount: kr(2_500) });
    });
    const move = [...world.facts.moves.values()][0];
    const out = [...world.facts.transactions.values()].find((t) => t.treatment.kind === "transfer" && t.amount < 0 && t.bookingDate === "2026-11-04");
    const done = apply(world.facts, { kind: "setMoveStatus", moveId: move?.id as MoveId, status: "done", completedBy: out?.id ?? null }, asOf);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const row = oneOff(done.facts);
    expect(row?.status).toEqual({ kind: "done", proof: { kind: "import", count: 1, last: "2026-11-04" } });
    expect(row?.reason).toBeNull();
  });

  describe("Mark as done and Skip", () => {
    const first = (facts: Facts): MoveRow => {
      const row = oneOff(facts);
      if (row === undefined) throw new Error("no one-off move");
      return row;
    };
    const run = (facts: Facts, command: FamilyCommand) => {
      const result = apply(facts, command, asOf);
      if (!result.ok) throw new Error(result.refusal.code);
      return result.facts;
    };

    it("marks the move done by the family, with no transfer to point to", () => {
      const world = withMove();
      const row = first(world.facts);
      expect(row.moveId && markDone(row.moveId)).toEqual({ kind: "setMoveStatus", moveId: row.moveId, status: "done", completedBy: null });
      const after = first(run(world.facts, markDone(row.moveId as MoveId)));
      expect(after.status).toEqual({ kind: "done", proof: { kind: "byYou" } });
    });

    it("skips the move, which leaves it skipped and not done", () => {
      const world = withMove();
      const row = first(world.facts);
      const after = first(run(world.facts, skip(row.moveId as MoveId)));
      expect(after.status).toEqual({ kind: "skipped" });
    });

    it("offers the buttons exactly when core would accept them", () => {
      fc.assert(
        fc.property(fc.constantFrom("todo", "done", "skipped"), (status) => {
          const world = withMove(status);
          const row = first(world.facts);
          const id = row.moveId as MoveId;
          for (const command of [markDone(id), skip(id)]) expect(apply(world.facts, command, asOf).ok).toBe(row.canAct);
        }),
      );
    });

    it("says what happened in words that name the amount and the account", () => {
      const row = first(withMove().facts);
      expect(markedDoneWords(row)).toEqual({ id: "plan.moves.done.markedDone", values: { amount: { money: kr(2_500) }, to: "Everyday" } });
      expect(skippedWords(row)).toEqual({ id: "plan.moves.done.skipped", values: { amount: { money: kr(2_500) }, to: "Everyday" } });
    });
  });
});

describe("adding a one-off move", () => {
  const world = moneyWorld();
  const [everyday, bills, deposit] = [world.accounts.everyday, world.accounts.bills, world.accounts.deposit];
  const accounts = [everyday, bills, deposit];
  const context = { month: nov, currency: NOK, accounts, newMoveId: () => newMoveId() };
  const form = { from: deposit, to: everyday, amountText: "2500", reason: "  Cover the dentist  " };

  it("makes a move for this month, with the reason trimmed, that core accepts", () => {
    const plan = planAddMove(form, context);
    expect(plan.kind).toBe("add");
    if (plan.kind !== "add") return;
    expect(plan.command).toMatchObject({ kind: "addMove", move: { from: deposit, to: everyday, amount: kr(2_500), month: nov, reason: "Cover the dentist" } });
    const added = apply(world.facts, plan.command, asOf);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(viewOf(added.facts).rows.at(-1)).toMatchObject({ kind: "oneOff", toName: "Everyday", status: { kind: "toDo" }, canAct: true });
    expect(addedMoveWords(plan, { from: "Deposit", to: "Everyday" })).toEqual({ id: "plan.moves.done.added", values: { amount: { money: kr(2_500) }, from: "Deposit", to: "Everyday" } });
  });

  it("says what is missing, one thing at a time, and points at the field", () => {
    const problem = (change: Partial<MoveForm>) => {
      const plan = planAddMove({ ...form, ...change }, context);
      return plan.kind === "problem" ? plan.problem : plan.kind;
    };
    expect(problem({ from: null })).toBe("chooseFrom");
    expect(problem({ to: null })).toBe("chooseTo");
    expect(problem({ to: deposit })).toBe("sameAccount");
    expect(problem({ amountText: "" })).toBe("notAnAmount");
    expect(problem({ amountText: "abc" })).toBe("notAnAmount");
    expect(problem({ amountText: "-5" })).toBe("negative");
    expect(problem({ amountText: "0" })).toBe("notAbove");
    expect(moveProblemField("chooseFrom")).toBe("from");
    expect(moveProblemField("chooseTo")).toBe("to");
    expect(moveProblemField("sameAccount")).toBe("to");
    expect(moveProblemField("notAbove")).toBe("amount");
    expect(moveProblemWords("sameAccount")).toEqual({ id: "plan.moves.problem.sameAccount" });
  });

  it("refuses an account that is not the household's", () => {
    const plan = planAddMove({ ...form, from: "elsewhere" as never }, context);
    expect(plan).toEqual({ kind: "problem", problem: "chooseFrom" });
  });

  it("never gives core a move it refuses: any two accounts and any amount the model accepts are applied", () => {
    fc.assert(
      fc.property(fc.constantFrom(...accounts), fc.constantFrom(...accounts), fc.integer({ min: -5, max: 100_000 }), fc.string({ maxLength: 12 }), (from, to, amount, reason) => {
        const plan = planAddMove({ from, to, amountText: String(amount), reason }, context);
        if (plan.kind === "problem") return;
        expect(apply(world.facts, plan.command, asOf).ok).toBe(true);
      }),
    );
  });

  it("offers the shared accounts first, then the ones the household pays into", () => {
    const mixed = moneyWorld(({ b }) => {
      b.account({ name: "Eldest's savings", scope: "paidInto" });
    });
    expect(moveAccounts(mixed.facts).map((account) => account.name)).toEqual(["Everyday", "Bills", "Deposit", "Eldest's savings"]);
  });
});

describe("the words", () => {
  const lines: Record<MoveStatusLine["kind"], MoveStatusLine> = {
    toDo: { kind: "toDo" },
    partlyDone: { kind: "partlyDone", done: kr(1), of: kr(2) },
    done: { kind: "done", proof: { kind: "import", count: 1, last: localDate("2026-10-21") } },
    skipped: { kind: "skipped" },
  };

  it("has its own status for each state, so a done move never reads as to do and a skipped one never as done", () => {
    expect(Object.fromEntries(Object.entries(lines).map(([kind, line]) => [kind, statusWords(line).id]))).toEqual({
      toDo: "plan.moves.status.toDo",
      partlyDone: "plan.moves.status.partlyDone",
      done: "plan.moves.status.done",
      skipped: "plan.moves.status.skipped",
    });
  });

  it("says the move as one plain sentence", () => {
    expect(moveWords({ amount: kr(12_000), fromName: "Felles brukskonto", toName: "Regninger" })).toEqual({
      id: "plan.moves.move",
      values: { amount: { money: kr(12_000) }, from: "Felles brukskonto", to: "Regninger" },
    });
  });

  it("points at the import that showed it done, and says so plainly when it has no date", () => {
    expect(proofWords({ kind: "done", proof: { kind: "import", count: 3, last: null } })).toEqual({ id: "plan.moves.proof.importNoDate" });
    expect(proofWords({ kind: "done", proof: { kind: "import", count: 3, last: localDate("2026-10-28") } })).toEqual({ id: "plan.moves.proof.import", values: { count: 3, date: { day: "2026-10-28" } } });
    expect(proofWords(lines.toDo)).toBeNull();
    expect(proofWords(lines.partlyDone)).toBeNull();
  });
});
