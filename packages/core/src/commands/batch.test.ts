import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ChangeLog, emptyChangeLog, redo, undo } from "../change-log.ts";
import { month } from "../dates.ts";
import { type Facts, type Rule, type Transaction, assignmentKey } from "../facts.ts";
import { needsYouItems } from "../figures/needs-you.ts";
import { jobId, transactionId } from "../ids.ts";
import { money } from "../money.ts";
import { applyPatch, diffFacts } from "../patch.ts";
import { ruleOf, withRules } from "../rules/rule-fixtures.ts";
import { arbitraryScript, playScript } from "../testing/arbitrary-commands.ts";
import { accepted, changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { factsBuilder, kr, setAmount, testId } from "../testing/facts-builder.ts";
import { type ApplyResult, type Command, apply, commit } from "./apply.ts";
import { checkFacts } from "./check-facts.ts";

const h = commandHousehold();
const november = month("2026-11");
const run = (command: Command, facts: Facts = h.facts): ApplyResult => apply(facts, command, { asOf: today });
const batch = (...commands: Command[]): Command => ({ kind: "batch", commands });
const assign = (jobId: typeof h.jobs.food, amount: number): Command => ({ kind: "assign", month: november, jobId, amount: money(amount) });
const unknownJob = jobId(testId(999_999));

/** Every row of every table as text, so a test sees any change to any row. */
const snapshot = (facts: Facts): string => JSON.stringify(Object.entries(facts).map(([table, rows]) => [table, [...(rows as ReadonlyMap<string, unknown>)]]));

describe("batch", () => {
  describe("when one command is refused", () => {
    const commands = [assign(h.jobs.food, kr(4_000)), assign(h.jobs.unused, kr(300)), assign(unknownJob, kr(100)), assign(h.jobs.holiday, kr(50))];

    it("refuses the whole batch with that command's refusal", () => {
      expect(run(batch(...commands))).toMatchObject({ ok: false, refusal: { code: "jobNotFound" } });
    });

    it("changes nothing, whichever command is the one refused", () => {
      const before = snapshot(h.facts);
      for (let i = 0; i < commands.length; i++) {
        const refused = commands.map((c, j) => (j === i ? assign(unknownJob, kr(1)) : c));
        expect(run(batch(...refused)).ok).toBe(false);
        expect(snapshot(h.facts)).toBe(before);
      }
    });

    it("saves no change record, so there is nothing to undo", () => {
      const log: ChangeLog<Command> = emptyChangeLog();
      const result = commit(h.facts, log, batch(...commands), changeMeta(1), { asOf: today });
      expect(result.ok).toBe(false);
      expect(undo(h.facts, log)).toMatchObject({ ok: false, conflict: { kind: "nothingToUndo" } });
    });

    it("refuses what one command refuses even when an earlier command would have made it unnecessary", () => {
      const result = run(batch(assign(h.jobs.food, kr(0)), { kind: "closeMonth", month: month("2026-12") }));
      expect(result).toMatchObject({ ok: false, refusal: { code: "monthNotOpen" } });
    });
  });

  describe("when every command is accepted", () => {
    const commands = [assign(h.jobs.food, kr(4_000)), assign(h.jobs.unused, kr(300)), { kind: "setNote", transactionId: h.transactions.shopping, note: "Birthday present" } as const];

    it("has a patch equal to the difference between the start and the end", () => {
      const result = run(batch(...commands));
      if (!result.ok) throw new Error("refused");
      expect(result.patch).toEqual(diffFacts(h.facts, result.facts));
      expect(applyPatch(h.facts, result.patch)).toEqual(result.facts);
    });

    it("folds two changes to one row into one, from the first before to the last after", () => {
      const result = run(batch(assign(h.jobs.food, kr(4_000)), assign(h.jobs.food, kr(3_000))));
      if (!result.ok) throw new Error("refused");
      expect(result.patch).toHaveLength(1);
      expect(result.patch[0]).toMatchObject({ table: "assignments", before: { amount: kr(5_000) }, after: { amount: kr(3_000) } });
    });

    it("has an empty patch when its commands put everything back", () => {
      const result = run(batch(assign(h.jobs.food, kr(1_000)), assign(h.jobs.food, kr(5_000))));
      expect(result.ok && result.patch).toEqual([]);
    });

    it("checks each command against the facts the one before left", () => {
      const id = transactionId(testId(810_000));
      const record: Command = { kind: "recordTransaction", transaction: { id, accountId: h.accounts.everyday, bookingDate: today, amount: kr(-90), description: "Kiosk", treatment: { kind: "needsYou" } } };
      const sort: Command = { kind: "setTreatment", transactionId: id, treatment: { kind: "split", allocations: [{ jobId: h.jobs.food, amount: kr(-90) }] } };
      expect(accepted(run(batch(record, sort))).transactions.get(id)?.treatment.kind).toBe("split");
      expect(run(batch(sort, record))).toMatchObject({ ok: false, refusal: { code: "transactionNotFound" } });
    });

    it("refuses a second command that repeats an ID the first used", () => {
      const rule = ruleOf({ n: 1, counterparty: "Kiwi", result: { kind: "job", jobId: h.jobs.food } });
      expect(run(batch({ kind: "addRule", rule }, { kind: "addRule", rule }))).toMatchObject({ ok: false, refusal: { code: "idTaken" } });
    });

    it("is as strict as the same commands one by one", () => {
      const overdraw: Command[] = [assign(h.jobs.food, kr(0)), { kind: "moveAssignment", month: november, from: h.jobs.food, to: h.jobs.unused, amount: kr(1) }];
      const oneByOne = (() => {
        let facts = h.facts;
        for (const command of overdraw) {
          const result = run(command, facts);
          if (!result.ok) return result.refusal.code;
          facts = result.facts;
        }
        return "accepted";
      })();
      const together = run(batch(...overdraw));
      expect(together.ok ? "accepted" : together.refusal.code).toBe(oneByOne);
      expect(oneByOne).toBe("moveExceedsAssignment");
    });

    it("keeps the household sound", () => {
      expect(checkFacts(accepted(run(batch(...commands))))).toEqual([]);
    });
  });

  describe("as one change", () => {
    const commands = [assign(h.jobs.food, kr(4_000)), assign(h.jobs.unused, kr(300)), { kind: "changeGroup", groupId: h.living, changes: { order: 4 } } as const];

    it("leaves one change record holding the batch and its patch", () => {
      const result = commit(h.facts, emptyChangeLog(), batch(...commands), changeMeta(1), { asOf: today });
      if (!result.ok) throw new Error("refused");
      expect(result.log.done).toHaveLength(1);
      expect(result.record.command).toEqual(batch(...commands));
      expect(result.record.patch).toEqual(diffFacts(h.facts, result.facts));
    });

    it("is taken back by one undo, and put back by one redo", () => {
      const done = commit(h.facts, emptyChangeLog(), batch(...commands), changeMeta(1), { asOf: today });
      if (!done.ok) throw new Error("refused");
      const undone = undo(done.facts, done.log);
      if (!undone.ok) throw new Error("undo refused");
      expect(undone.facts).toEqual(h.facts);
      expect(undone.log.done).toHaveLength(0);
      const redone = redo(undone.facts, undone.log);
      expect(redone.ok && redone.facts).toEqual(done.facts);
    });
  });

  describe("of 21 setTreatment commands", () => {
    const b = factsBuilder({ planStart: "2026-10" });
    const everyday = b.account({ name: "Everyday" });
    b.buffer({ monthly: kr(1_000) });
    const food = b.spendJob({ name: "Food", plan: setAmount(kr(5_000)) });
    const waiting = Array.from({ length: 21 }, (_, i) => b.needsYou({ accountId: everyday, date: `2026-10-${String(i + 1).padStart(2, "0")}`, amount: kr(-(i + 1) * 10) }));
    const start = b.facts();
    const commands = waiting.map((id, i): Command => ({ kind: "setTreatment", transactionId: id, treatment: { kind: "split", allocations: [{ jobId: food, amount: kr(-(i + 1) * 10) }] } }));

    it("sorts all 21 in one change", () => {
      const done = commit(start, emptyChangeLog(), batch(...commands), changeMeta(1), { asOf: today });
      if (!done.ok) throw new Error("refused");
      expect([...done.facts.transactions.values()].every((t) => t.treatment.kind === "split")).toBe(true);
      expect(done.log.done).toHaveLength(1);
      expect(done.record.patch).toHaveLength(21);
    });

    it("is taken back by one undo", () => {
      const done = commit(start, emptyChangeLog(), batch(...commands), changeMeta(1), { asOf: today });
      if (!done.ok) throw new Error("refused");
      const undone = undo(done.facts, done.log);
      expect(undone.ok && undone.facts).toEqual(start);
      expect([...(undone.ok ? undone.facts : start).transactions.values()].every((t) => t.treatment.kind === "needsYou")).toBe(true);
    });

    it("sorts none when the last of the 21 does not add up", () => {
      const wrong = [...commands.slice(0, 20), { ...commands[20], treatment: { kind: "split", allocations: [{ jobId: food, amount: kr(-1) }] } } as Command];
      expect(run(batch(...wrong), start)).toMatchObject({ ok: false, refusal: { code: "splitDoesNotAddUp" } });
    });
  });

  describe("nested", () => {
    it("applies a batch inside a batch as part of the same change", () => {
      const nested = batch(assign(h.jobs.food, kr(4_000)), batch(assign(h.jobs.unused, kr(300)), batch(assign(h.jobs.holiday, kr(200)))));
      const result = run(nested);
      if (!result.ok) throw new Error("refused");
      const assigned = (job: typeof h.jobs.food) => result.facts.assignments.get(assignmentKey(november, job))?.amount;
      expect([assigned(h.jobs.food), assigned(h.jobs.unused), assigned(h.jobs.holiday)]).toEqual([kr(4_000), kr(300), kr(200)]);
      expect(result.patch).toEqual(diffFacts(h.facts, result.facts));
      const done = commit(h.facts, emptyChangeLog(), nested, changeMeta(1), { asOf: today });
      expect(done.ok && done.log.done).toHaveLength(1);
    });

    it("refuses the outer batch when an inner one is refused", () => {
      const result = run(batch(assign(h.jobs.food, kr(4_000)), batch(assign(h.jobs.unused, kr(300)), assign(unknownJob, kr(1)))));
      expect(result).toMatchObject({ ok: false, refusal: { code: "jobNotFound" } });
    });

    it("gives the same facts as the same commands flat", () => {
      const flat = run(batch(assign(h.jobs.food, kr(4_000)), assign(h.jobs.unused, kr(300))));
      const nested = run(batch(batch(assign(h.jobs.food, kr(4_000))), batch(batch(assign(h.jobs.unused, kr(300))))));
      expect(nested.ok && flat.ok && nested.facts).toEqual(flat.ok && flat.facts);
    });
  });

  describe("when empty", () => {
    it("is accepted and changes nothing", () => {
      const result = run(batch());
      expect(result.ok && result.facts).toEqual(h.facts);
      expect(result.ok && result.patch).toEqual([]);
    });

    it("is still recorded as a change that undo takes back", () => {
      const done = commit(h.facts, emptyChangeLog(), batch(), changeMeta(1), { asOf: today });
      if (!done.ok) throw new Error("refused");
      expect(done.log.done).toHaveLength(1);
      const undone = undo(done.facts, done.log);
      expect(undone.ok && undone.facts).toEqual(h.facts);
    });

    it("can sit inside another batch", () => {
      expect(run(batch(batch(), assign(h.jobs.food, kr(4_000)), batch())).ok).toBe(true);
    });
  });

  describe("on generated scripts", () => {
    it("gives the facts the same commands give one by one, with a patch that is the difference", () => {
      fc.assert(
        fc.property(arbitraryScript(), (script) => {
          const played = playScript(script);
          const result = apply(script.start, batch(...played.accepted.map((a) => a.command)), { asOf: script.asOf });
          if (!result.ok) throw new Error(`refused: ${result.refusal.message}`);
          expect(result.facts).toEqual(played.accepted.at(-1)?.facts ?? script.start);
          expect(result.patch).toEqual(diffFacts(script.start, result.facts));
          expect(checkFacts(result.facts)).toEqual(checkFacts(script.start));
        }),
      );
    });

    it("is refused when any command in it is refused, and leaves the facts alone", () => {
      fc.assert(
        fc.property(arbitraryScript({ minSteps: 3 }), fc.nat(), (script, where) => {
          const played = playScript(script);
          const commands = played.accepted.map((a) => a.command);
          const at = commands.length === 0 ? 0 : where % (commands.length + 1);
          const refused: Command = { kind: "setTreatment", transactionId: transactionId(testId(999_998)), treatment: { kind: "needsYou" } };
          const before = snapshot(script.start);
          const result = apply(script.start, batch(...commands.slice(0, at), refused, ...commands.slice(at)), { asOf: script.asOf });
          expect(result).toMatchObject({ ok: false, refusal: { code: "transactionNotFound" } });
          expect(snapshot(script.start)).toBe(before);
        }),
      );
    });

    it("is restored exactly by one undo, and put back exactly by one redo", () => {
      fc.assert(
        fc.property(arbitraryScript(), (script) => {
          const commands = playScript(script).accepted.map((a) => a.command);
          const done = commit(script.start, emptyChangeLog(), batch(...commands), changeMeta(1), { asOf: script.asOf });
          if (!done.ok) throw new Error("refused");
          expect(done.log.done).toHaveLength(1);
          const undone = undo(done.facts, done.log);
          if (!undone.ok) throw new Error(`undo refused: ${undone.conflict.kind}`);
          expect(undone.facts).toEqual(script.start);
          const redone = redo(undone.facts, undone.log);
          expect(redone.ok && redone.facts).toEqual(done.facts);
        }),
      );
    });
  });
});

describe("accepting every suggestion", () => {
  const names = ["Kiwi", "kiwi", " KIWI ", "Rema 1000", "Vy", "Coop Extra", "coop extra"];

  interface Entry {
    readonly month: "2026-10" | "2026-11";
    readonly day: number;
    readonly amount: number;
    readonly counterparty: string | null;
    readonly sorted: readonly { readonly job: number; readonly weight: number }[];
  }

  interface RuleEntry {
    readonly counterparty: string;
    readonly priority: number;
    readonly job: number;
    readonly shares: readonly { readonly job: number; readonly weight: number }[];
    readonly accountPick: number | null;
  }

  const entry: fc.Arbitrary<Entry> = fc.record({
    month: fc.constantFrom("2026-10" as const, "2026-11" as const),
    day: fc.integer({ min: 1, max: 28 }),
    amount: fc.integer({ min: -90_000, max: 20_000 }),
    counterparty: fc.option(fc.constantFrom(...names), { nil: null }),
    sorted: fc.oneof({ weight: 3, arbitrary: fc.constant([]) }, fc.array(fc.record({ job: fc.nat(), weight: fc.integer({ min: 1, max: 5 }) }), { minLength: 1, maxLength: 3 })),
  });
  const ruleEntry: fc.Arbitrary<RuleEntry> = fc.record({
    counterparty: fc.constantFrom(...names),
    priority: fc.integer({ min: 0, max: 2 }),
    job: fc.nat(),
    shares: fc.array(fc.record({ job: fc.nat(), weight: fc.integer({ min: 1, max: 4 }) }), { maxLength: 3 }),
    accountPick: fc.option(fc.nat(), { nil: null }),
  });

  /** October and November 2026, a plan from October, some transactions sorted and some waiting, and rules made after they arrived. */
  function sorting(entries: readonly Entry[], ruleEntries: readonly RuleEntry[]): Facts {
    const b = factsBuilder({ planStart: "2026-10" });
    const accounts = [b.account({ name: "Everyday" }), b.account({ name: "Bills", kind: "bills" })];
    b.buffer({ monthly: kr(1_000) });
    const jobs = [b.spendJob({ name: "Food", plan: setAmount(kr(5_000)) }), b.spendJob({ name: "Eating out", plan: setAmount(kr(500)) }), b.spendJob({ name: "Car", plan: setAmount(kr(800)) })];
    const pick = <T>(list: readonly T[], n: number): T => list[n % list.length] as T;
    const ids = entries.map((e, i) => {
      const accountId = pick(accounts, i);
      const date = `${e.month}-${String(e.day).padStart(2, "0")}`;
      const amount = money(e.amount);
      if (e.sorted.length === 0) return b.needsYou({ accountId, date, amount });
      const weights = e.sorted.reduce((sum, s) => sum + s.weight, 0);
      const parts = e.sorted.map((s, j) => (j === 0 ? 0 : Math.trunc((e.amount * s.weight) / weights)));
      parts[0] = e.amount - parts.reduce((sum, p) => sum + p, 0);
      return b.split({ accountId, date, allocations: e.sorted.map((s, j): [typeof jobs[number], ReturnType<typeof money>] => [pick(jobs, s.job), money(parts[j] ?? 0)]) });
    });
    const withNames = b.facts();
    const transactions = new Map<Transaction["id"], Transaction>(
      [...withNames.transactions].map(([id, t]) => {
        const named = entries[ids.indexOf(id)]?.counterparty;
        return [id, named === null || named === undefined ? t : { ...t, counterparty: named }];
      }),
    );
    const rules: Rule[] = ruleEntries.map((r, i) => {
      const [first, ...rest] = r.shares.map((s) => ({ jobId: pick(jobs, s.job), weight: s.weight }));
      return ruleOf({
        n: i + 1,
        counterparty: r.counterparty,
        priority: r.priority,
        ...(r.accountPick === null ? {} : { accountId: pick(accounts, r.accountPick) }),
        result: first === undefined ? { kind: "job", jobId: pick(jobs, r.job) } : { kind: "split", shares: [first, ...rest] },
      });
    });
    return withRules({ ...withNames, transactions }, ...rules);
  }

  const households = fc.tuple(fc.array(entry, { maxLength: 18 }), fc.array(ruleEntry, { maxLength: 3 })).map(([entries, rules]) => sorting(entries, rules));
  const seen = { rule: 0, sameAsLast: 0, none: 0, accepted: 0 };

  const suggestions = (facts: Facts): Command[] => needsYouItems(facts).flatMap((item) => (item.suggestion === null ? [] : [item.suggestion.command]));

  function oneByOne(facts: Facts, commands: readonly Command[]): Facts {
    let current = facts;
    for (const command of commands) current = accepted(run(command, current));
    return current;
  }

  it("gives the facts accepting them one by one gives, in any order", () => {
    fc.assert(
      fc.property(households, (facts) => {
        expect(checkFacts(facts)).toEqual([]);
        const items = needsYouItems(facts);
        for (const item of items) seen[item.suggestion?.kind === "rule" ? "rule" : item.suggestion?.kind === "sameAsLast" ? "sameAsLast" : "none"] += 1;
        const commands = suggestions(facts);
        const together = accepted(run(batch(...commands), facts));
        const sequential = oneByOne(facts, commands);
        expect(together).toEqual(sequential);
        expect(oneByOne(facts, [...commands].reverse())).toEqual(sequential);
        expect(checkFacts(together)).toEqual([]);
        seen.accepted += commands.length;
      }),
    );
    expect(seen.rule).toBeGreaterThan(0);
    expect(seen.sameAsLast).toBeGreaterThan(0);
    expect(seen.none).toBeGreaterThan(0);
  });

  it("sorts exactly the transactions that had a suggestion, in one change that one undo takes back", () => {
    fc.assert(
      fc.property(households, (facts) => {
        const items = needsYouItems(facts);
        const commands = suggestions(facts);
        const done = commit(facts, emptyChangeLog(), batch(...commands), changeMeta(1), { asOf: today });
        if (!done.ok) throw new Error(`refused: ${done.refusal.message}`);
        expect(done.log.done).toHaveLength(1);
        expect(needsYouItems(done.facts).map((i) => i.transaction.id)).toEqual(items.filter((i) => i.suggestion === null).map((i) => i.transaction.id));
        const undone = undo(done.facts, done.log);
        expect(undone.ok && undone.facts).toEqual(facts);
      }),
    );
  });
});
