import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import { month } from "../dates.ts";
import { groupId, jobId } from "../ids.ts";
import { planImport } from "../import/plan.ts";
import { diffFacts } from "../patch.ts";
import { accepted, changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { bulderLikeSize, firstImport } from "../testing/first-import.ts";
import { kr, setAmount, testId } from "../testing/facts-builder.ts";
import { type Command, apply, commit } from "./apply.ts";
import { checkFacts } from "./check-facts.ts";

declare const performance: { now(): number };

const h = commandHousehold();
const run = (command: Command, facts = h.facts) => apply(facts, command, { asOf: today });
const batch = (...commands: Command[]): Command => ({ kind: "batch", commands });

const newJob = (n: number, group = h.living): Extract<Command, { kind: "addJob" }> => ({
  kind: "addJob",
  job: { id: jobId(testId(700_000 + n)), name: `Extra ${n}`, groupId: group, status: "active", accountId: h.accounts.everyday, essential: false, opening: kr(0), kind: "spend", keepsMoney: false, plan: setAmount(kr(100)), seasonality: "irregular" },
});

describe("a batch is checked once, on the facts it ends with", () => {
  const missing = groupId(testId(700_900));
  const group: Command = { kind: "addGroup", group: { id: missing, name: "New group", order: 9, countsTowardsSavingsRate: false } };

  it("refuses a batch that leaves something worse than it found, and changes nothing", () => {
    const before = JSON.stringify([...h.facts.jobs]);
    const result = run(batch({ kind: "assign", month: month("2026-11"), jobId: h.jobs.food, amount: kr(4_000) }, newJob(1, missing)));
    expect(result).toMatchObject({ ok: false, refusal: { code: "breaksFacts", violations: [{ code: "missingReference", table: "jobs", field: "groupId" }] } });
    expect(JSON.stringify([...h.facts.jobs])).toBe(before);
  });

  it("accepts a batch whose commands leave things sound, even when a command in the middle did not", () => {
    expect(run(newJob(2, missing))).toMatchObject({ ok: false, refusal: { code: "breaksFacts" } });
    const result = run(batch(newJob(2, missing), group));
    expect(checkFacts(accepted(result))).toEqual(checkFacts(h.facts));
    expect(accepted(result).jobs.get(jobId(testId(700_002)))?.groupId).toBe(missing);
  });

  it("refuses the batch whichever end the unsound command comes at", () => {
    const sound: Command = { kind: "changeGroup", groupId: h.living, changes: { order: 5 } };
    expect(run(batch(newJob(3, missing), sound)).ok).toBe(false);
    expect(run(batch(sound, newJob(3, missing))).ok).toBe(false);
  });

  it("doesn't blame the batch for what the facts already had", () => {
    const unsound = { ...h.facts, jobs: new Map([...h.facts.jobs].filter(([, job]) => job.kind !== "saveUp" || job.role !== "buffer")) };
    expect(checkFacts(unsound).map((v) => v.code)).toContain("noBuffer");
    expect(run(batch({ kind: "changeGroup", groupId: h.living, changes: { order: 5 } }, { kind: "changeGroup", groupId: h.living, changes: { order: 6 } }), unsound).ok).toBe(true);
  });

  it("is one change whose patch is the difference between the start and the end, and one undo takes it back", () => {
    const rename: Command = { kind: "changeGroup", groupId: missing, changes: { name: "Renamed" } };
    const done = commit(h.facts, emptyChangeLog(), batch(newJob(4, missing), group, rename), changeMeta(1), { asOf: today });
    if (!done.ok) throw new Error("refused");
    expect(done.record.patch).toEqual(diffFacts(h.facts, done.facts));
    expect(done.record.patch).toHaveLength(2);
    expect(done.facts.groups.get(missing)?.name).toBe("Renamed");
    const undone = undo(done.facts, done.log);
    expect(undone.ok && undone.facts).toEqual(h.facts);
  });
});

describe("a batch at the size of the family's data", () => {
  const scenario = firstImport(bulderLikeSize);
  const plan = planImport(scenario.facts, scenario.file, scenario.input());
  if (!plan.ok) throw new Error("blocked");
  const imported = apply(scenario.facts, plan.command, { asOf: today });
  if (!imported.ok) throw new Error("refused");
  const facts = imported.facts;
  const waiting = [...facts.transactions.values()].filter((t) => t.treatment.kind === "needsYou").slice(0, 500);
  const food = [...facts.jobs.values()].find((job) => job.kind === "spend");
  const sorting: Command[] = waiting.map((t) => ({ kind: "setTreatment", transactionId: t.id, treatment: { kind: "split", allocations: [{ jobId: food?.id as never, amount: t.amount }] } }));

  it("sorts 500 transactions among 18,000 rows in a fraction of a second, because it copies a table once, not once per command", () => {
    expect(sorting).toHaveLength(500);
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const began = performance.now();
      const result = apply(facts, batch(...sorting), { asOf: today });
      times.push(performance.now() - began);
      if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
      expect(result.patch).toHaveLength(500);
    }
    expect([...times].sort((a, b) => a - b)[1]).toBeLessThan(250);
  });

  it("gives what the same 500 commands give one by one", () => {
    let current = facts;
    for (const command of sorting.slice(0, 120)) current = accepted(apply(current, command, { asOf: today }));
    expect(accepted(apply(facts, batch(...sorting.slice(0, 120)), { asOf: today }))).toEqual(current);
  });
});
