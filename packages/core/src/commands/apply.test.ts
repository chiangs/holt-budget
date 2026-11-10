import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ChangeLog, emptyChangeLog, redo, undo } from "../change-log.ts";
import { type LocalDate, localDate, month } from "../dates.ts";
import { type Facts, assignmentKey, householdOf, makeSplit } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import { accountId, enteredValueId, groupId, jobId, moveId, transactionId } from "../ids.ts";
import type { Patch } from "../patch.ts";
import { arbitraryHousehold } from "../testing/arbitrary-facts.ts";
import { arbitraryScript } from "../testing/arbitrary-commands.ts";
import { accepted, changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { evenOut, factsBuilder, kr, setAmount, testId } from "../testing/facts-builder.ts";
import { type Command, type CommandKind, apply, commandKinds, commit } from "./apply.ts";
import type { ImportCommand } from "./imports.ts";
import type { RuleCommand } from "./rules.ts";
import { checkFacts } from "./check-facts.ts";

const h = commandHousehold();
const fresh = (n: number) => testId(800_000 + n);
const november = month("2026-11");

/** An accepted case for every command kind this file owns, with what it changes. Imports, rules, plan start and batches have their own test files. The type makes a new kind fail to compile until it has one. */
type OwnedElsewhere = ImportCommand["kind"] | RuleCommand["kind"] | "batch";
type CoveredHere = Exclude<CommandKind, OwnedElsewhere>;
const coveredHere = commandKinds.filter((kind): kind is CoveredHere => !["importFile", "undoImport", "mergeTransactions", "pairTransfers", "addRule", "changeRule", "deleteRule", "setPlanStart", "batch"].includes(kind));

const cases: { readonly [K in CoveredHere]: { readonly command: Extract<Command, { readonly kind: K }>; readonly then: (after: Facts) => void } } = {
  changeHousehold: {
    command: { kind: "changeHousehold", changes: { name: "Home", evenOutStep: kr(100) } },
    then: (after) => expect(householdOf(after)).toMatchObject({ name: "Home", evenOutStep: kr(100), planStart: month("2026-10") }),
  },
  addAccount: {
    command: { kind: "addAccount", account: { id: accountId(fresh(1)), name: "Regninger", kind: "bills", scope: "shared", openingBalance: kr(2_000), openingDate: localDate("2026-09-30") } },
    then: (after) => expect(after.accounts.get(accountId(fresh(1)))?.name).toBe("Regninger"),
  },
  changeAccount: {
    command: { kind: "changeAccount", accountId: h.accounts.everyday, changes: { name: "Brukskonto", kind: "bills" } },
    then: (after) => expect(after.accounts.get(h.accounts.everyday)).toEqual({ ...h.facts.accounts.get(h.accounts.everyday), name: "Brukskonto", kind: "bills" }),
  },
  addGroup: {
    command: { kind: "addGroup", group: { id: groupId(fresh(2)), name: "Saving", order: 1, countsTowardsSavingsRate: true } },
    then: (after) => expect(after.groups.get(groupId(fresh(2)))?.countsTowardsSavingsRate).toBe(true),
  },
  changeGroup: {
    command: { kind: "changeGroup", groupId: h.living, changes: { order: 4 } },
    then: (after) => expect(after.groups.get(h.living)?.order).toBe(4),
  },
  addJob: {
    command: {
      kind: "addJob",
      job: { id: jobId(fresh(3)), name: "Car running costs", groupId: h.living, status: "active", accountId: h.accounts.everyday, essential: true, opening: kr(0), kind: "spend", keepsMoney: true, plan: setAmount(kr(3_200)), seasonality: "irregular" },
    },
    then: (after) => expect(after.jobs.get(jobId(fresh(3)))?.name).toBe("Car running costs"),
  },
  changeJob: {
    command: { kind: "changeJob", jobId: h.jobs.food, changes: { essential: false, ofKind: { kind: "spend", plan: setAmount(kr(6_000)) } } },
    then: (after) => expect(after.jobs.get(h.jobs.food)).toMatchObject({ essential: false, plan: setAmount(kr(6_000)), kind: "spend" }),
  },
  deleteJob: {
    command: { kind: "deleteJob", jobId: h.jobs.unused },
    then: (after) => expect(after.jobs.has(h.jobs.unused)).toBe(false),
  },
  openMonth: {
    command: { kind: "openMonth", month: month("2026-12") },
    then: (after) => {
      expect(after.budgetMonths.get(month("2026-12"))?.state).toBe("open");
      expect(after.assignments.get(assignmentKey(month("2026-12"), h.jobs.food))?.amount).toBe(kr(5_000));
    },
  },
  closeMonth: {
    command: { kind: "closeMonth", month: november },
    then: (after) => expect(after.budgetMonths.get(november)?.state).toBe("closed"),
  },
  reopenMonth: {
    command: { kind: "reopenMonth", month: month("2026-10") },
    then: (after) => expect(after.budgetMonths.get(month("2026-10"))?.state).toBe("reopened"),
  },
  assign: {
    command: { kind: "assign", month: november, jobId: h.jobs.unused, amount: kr(300) },
    then: (after) => expect(after.assignments.get(assignmentKey(november, h.jobs.unused))?.amount).toBe(kr(300)),
  },
  moveAssignment: {
    command: { kind: "moveAssignment", month: november, from: h.jobs.food, to: h.jobs.unused, amount: kr(1_000) },
    then: (after) => {
      expect(after.assignments.get(assignmentKey(november, h.jobs.food))?.amount).toBe(kr(4_000));
      expect(after.assignments.get(assignmentKey(november, h.jobs.unused))?.amount).toBe(kr(1_000));
    },
  },
  addMove: {
    command: { kind: "addMove", move: { id: moveId(fresh(4)), from: h.accounts.savings, to: h.accounts.everyday, amount: kr(4_100), month: november, reason: "Seed Electricity from Buffer" } },
    then: (after) => expect(after.moves.get(moveId(fresh(4)))).toMatchObject({ status: "todo", completedBy: null }),
  },
  setMoveStatus: {
    command: { kind: "setMoveStatus", moveId: h.moves.toDo, status: "done", completedBy: h.transactions.salary },
    then: (after) => expect(after.moves.get(h.moves.toDo)).toMatchObject({ status: "done", completedBy: h.transactions.salary }),
  },
  enterValue: {
    command: { kind: "enterValue", value: { id: enteredValueId(fresh(5)), kind: "reference", subject: "buffer-months", value: 4, unit: "months", asOf: today, source: "entered by you" } },
    then: (after) => expect(after.enteredValues.get(enteredValueId(fresh(5)))?.value).toBe(4),
  },
  recordTransaction: {
    command: { kind: "recordTransaction", transaction: { id: transactionId(fresh(6)), accountId: h.accounts.everyday, bookingDate: today, amount: kr(-129), description: "Kiwi", treatment: { kind: "needsYou" } } },
    then: (after) => expect(after.transactions.get(transactionId(fresh(6)))?.treatment).toEqual({ kind: "needsYou" }),
  },
  setTreatment: {
    command: {
      kind: "setTreatment",
      transactionId: h.transactions.shopping,
      treatment: makeSplit(kr(-450), [
        { jobId: h.jobs.food, amount: kr(-300) },
        { jobId: h.jobs.unused, amount: kr(-150) },
      ]),
    },
    then: (after) => expect(after.transactions.get(h.transactions.shopping)?.treatment.kind).toBe("split"),
  },
  setNote: {
    command: { kind: "setNote", transactionId: h.transactions.shopping, note: "  Birthday present  " },
    then: (after) => expect(after.transactions.get(h.transactions.shopping)?.note).toBe("Birthday present"),
  },
};

describe("apply", () => {
  it.each(coveredHere)("accepts %s", (kind) => {
    const { command, then } = cases[kind];
    const result = apply(h.facts, command, { asOf: today });
    then(accepted(result));
    expect(checkFacts(accepted(result))).toEqual([]);
  });

  it("returns the facts its patch makes, so a saved change and its preview agree", () => {
    for (const kind of coveredHere) {
      const result = apply(h.facts, cases[kind].command, { asOf: today });
      if (!result.ok) throw new Error(`${kind} was refused`);
      expect(result.patch.length).toBeGreaterThan(0);
      for (const change of result.patch) expect((result.facts[change.table] as ReadonlyMap<string, unknown>).get(change.key) ?? null).toEqual(change.after);
    }
  });

  it("an evened-out job always keeps its money, whatever the command says (decision 6)", () => {
    const job = { ...cases.addJob.command.job, keepsMoney: false, plan: evenOut(kr(3_050), "2026-11") } as const;
    expect(accepted(apply(h.facts, { kind: "addJob", job }, { asOf: today })).jobs.get(job.id)).toMatchObject({ keepsMoney: true });
    const changed = apply(h.facts, { kind: "changeJob", jobId: h.jobs.unused, changes: { ofKind: { kind: "spend", plan: evenOut(kr(500), "2026-11"), keepsMoney: false } } }, { asOf: today });
    expect(accepted(changed).jobs.get(h.jobs.unused)).toMatchObject({ keepsMoney: true });
  });

  it("refuses only what a command adds to facts that were already unsound", () => {
    const b = factsBuilder({ planStart: "2026-10" });
    b.account({ name: "Everyday" });
    const food = b.spendJob({ name: "Food", plan: setAmount(kr(5_000)) });
    b.assign("2026-12", food, kr(100));
    const unsound = b.facts();
    expect(checkFacts(unsound).map((v) => v.code)).toEqual(["noBuffer", "assignmentInPlannedMonth"]);
    expect(apply(unsound, { kind: "changeJob", jobId: food, changes: { name: "Food and household" } }, { asOf: today }).ok).toBe(true);
    const job = { ...cases.addJob.command.job, groupId: groupId(fresh(9)) };
    const refused = apply(unsound, { kind: "addJob", job }, { asOf: today });
    expect(!refused.ok && refused.refusal.code === "breaksFacts" && refused.refusal.violations).toEqual([{ code: "missingReference", table: "jobs", key: job.id, field: "groupId" }]);
  });
});

describe("no command adjusts a balance (rule 5)", () => {
  it("no command kind is about adjusting, correcting or reconciling a balance", () => {
    expect(commandKinds.filter((kind) => /adjust|balance|correct|reconcil|writeoff|fix/i.test(kind))).toEqual([]);
  });

  it("no accepted command changes an account's opening balance or an existing transaction's amount, date or account", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        let facts = script.start;
        for (const command of script.commands(() => facts)) {
          const result = apply(facts, command, { asOf: script.asOf });
          if (!result.ok) continue;
          for (const change of result.patch) {
            if (change.table === "accounts" && change.before !== null) {
              expect([change.after?.openingBalance, change.after?.openingDate]).toEqual([change.before.openingBalance, change.before.openingDate]);
            }
            if (change.table === "transactions" && change.before !== null) {
              expect(change.after && [change.after.amount, change.after.bookingDate, change.after.accountId]).toEqual([change.before.amount, change.before.bookingDate, change.before.accountId]);
            }
          }
          facts = result.facts;
        }
      }),
    );
  });
});

/** Every row of every table, in order, as text. Rows are plain data, so this sees any change to them. */
const snapshot = (facts: Facts): string => JSON.stringify(Object.entries(facts).map(([table, rows]) => [table, [...(rows as ReadonlyMap<string, unknown>)]]));

describe("apply on generated households", () => {
  it("leaves sound facts sound after every accepted command", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        let facts = script.start;
        for (const command of script.commands(() => facts)) {
          const result = apply(facts, command, { asOf: script.asOf });
          if (!result.ok) continue;
          expect(checkFacts(result.facts)).toEqual([]);
          facts = result.facts;
        }
      }),
    );
  });

  it("never changes the facts it is given, accepted or refused", () => {
    fc.assert(
      fc.property(fc.oneof(arbitraryScript().map((s) => ({ script: s, facts: s.start })), fc.record({ script: arbitraryScript(), facts: arbitraryHousehold().map((a) => a.facts) })), ({ script, facts: start }) => {
        let facts = start;
        for (const command of script.commands(() => facts)) {
          const before = snapshot(facts);
          const result = apply(facts, command, { asOf: script.asOf });
          expect(snapshot(facts)).toBe(before);
          if (result.ok) facts = result.facts;
        }
      }),
    );
  });

  it("never changes or removes an entered value: a new value adds a row (rule 10)", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        let facts = script.start;
        for (const command of script.commands(() => facts)) {
          const result = apply(facts, command, { asOf: script.asOf });
          if (!result.ok) continue;
          for (const change of result.patch) if (change.table === "enteredValues") expect(change.before).toBeNull();
          facts = result.facts;
        }
      }),
    );
  });

  it("never changes an assignment the command doesn't name, so nothing covers an overspend by itself (decisions 3 and 13)", () => {
    const named = (command: Command, key: string): boolean => {
      switch (command.kind) {
        case "assign":
          return key === assignmentKey(command.month, command.jobId);
        case "moveAssignment":
          return key === assignmentKey(command.month, command.from) || key === assignmentKey(command.month, command.to);
        case "openMonth":
          return key.startsWith(`${command.month}/`);
        default:
          return false;
      }
    };
    let assignmentsChanged = 0;
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        let facts = script.start;
        for (const command of script.commands(() => facts)) {
          const result = apply(facts, command, { asOf: script.asOf });
          if (!result.ok) continue;
          for (const change of result.patch) {
            if (change.table !== "assignments") continue;
            assignmentsChanged += 1;
            expect({ kind: command.kind, named: named(command, change.key) }).toEqual({ kind: command.kind, named: true });
          }
          facts = result.facts;
        }
      }),
    );
    expect(assignmentsChanged).toBeGreaterThan(0);
  });
});

describe("everything can be undone (rule 9)", () => {
  const figuresIn = (facts: Facts, asOf: LocalDate) => computeFigures(facts, asOf);

  it("undo all then redo all gives the same facts and figures at every step", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        const figuresOf = (facts: Facts) => figuresIn(facts, script.asOf);
        let facts = script.start;
        let log: ChangeLog<Command> = emptyChangeLog();
        const steps = [{ facts, figures: figuresOf(facts) }];
        let n = 0;
        for (const command of script.commands(() => facts)) {
          const result = commit(facts, log, command, changeMeta(++n), { asOf: script.asOf });
          if (!result.ok) continue;
          facts = result.facts;
          log = result.log;
          steps.push({ facts, figures: figuresOf(facts) });
        }
        for (let i = steps.length - 2; i >= 0; i--) {
          const undone = undo(facts, log);
          if (!undone.ok) throw new Error(`undo refused: ${undone.conflict.kind}`);
          ({ facts, log } = undone);
          expect(facts).toEqual(steps[i]?.facts);
          expect(figuresOf(facts)).toEqual(steps[i]?.figures);
        }
        expect(undo(facts, log).ok).toBe(false);
        for (let i = 1; i < steps.length; i++) {
          const redone = redo(facts, log);
          if (!redone.ok) throw new Error(`redo refused: ${redone.conflict.kind}`);
          ({ facts, log } = redone);
          expect(facts).toEqual(steps[i]?.facts);
          expect(figuresOf(facts)).toEqual(steps[i]?.figures);
        }
      }),
    );
  }, 20_000);

  it("undoing one command restores exactly the rows it touched, and nothing else", () => {
    const rowsOf = (facts: Facts, patch: Patch) => patch.map((c) => (facts[c.table] as ReadonlyMap<string, unknown>).get(c.key) ?? null);
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        let facts = script.start;
        let log: ChangeLog<Command> = emptyChangeLog();
        let n = 0;
        for (const command of script.commands(() => facts)) {
          const result = commit(facts, log, command, changeMeta(++n), { asOf: script.asOf });
          if (!result.ok) continue;
          const undone = undo(result.facts, result.log);
          if (!undone.ok) throw new Error("undo refused");
          expect(rowsOf(undone.facts, result.record.patch)).toEqual(result.record.patch.map((c) => c.before));
          expect(undone.facts).toEqual(facts);
          ({ facts, log } = result);
        }
      }),
    );
  });

  it("commit records who made the change and the command, with its patch", () => {
    const result = commit(h.facts, emptyChangeLog(), cases.assign.command, changeMeta(1), { asOf: today });
    if (!result.ok) throw new Error("refused");
    expect(result.log.done).toEqual([{ ...changeMeta(1), command: cases.assign.command, patch: [{ table: "assignments", key: assignmentKey(november, h.jobs.unused), before: null, after: { month: november, jobId: h.jobs.unused, amount: kr(300) } }] }]);
    expect(commit(h.facts, result.log, { kind: "deleteJob", jobId: h.jobs.buffer }, changeMeta(2), { asOf: today })).toMatchObject({ ok: false, refusal: { code: "bufferCannotBeDeleted" } });
  });
});
