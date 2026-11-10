import { describe, expect, it } from "vitest";
import { month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { accepted, commandHousehold, today } from "../testing/command-household.ts";
import { factsBuilder, kr, monthlySaving } from "../testing/facts-builder.ts";
import { ruleOf, withRules } from "../rules/rule-fixtures.ts";
import { type Command, apply } from "./apply.ts";

const h = commandHousehold();
const november = month("2026-11");
const run = (facts: Facts, command: Command) => apply(facts, command, { asOf: today });

describe("deleting a job", () => {
  it("is refused while a rule gives transactions to it, alone or in a split", () => {
    const single = withRules(h.facts, ruleOf({ n: 1, counterparty: "Shop", result: { kind: "job", jobId: h.jobs.unused } }));
    expect(run(single, { kind: "deleteJob", jobId: h.jobs.unused })).toMatchObject({ ok: false, refusal: { code: "jobInUse" } });
    const split = withRules(h.facts, ruleOf({ n: 2, counterparty: "Shop", result: { kind: "split", shares: [{ jobId: h.jobs.food, weight: 1 }, { jobId: h.jobs.unused, weight: 1 }] } }));
    expect(run(split, { kind: "deleteJob", jobId: h.jobs.unused })).toMatchObject({ ok: false, refusal: { code: "jobInUse" } });
    expect(run(h.facts, { kind: "deleteJob", jobId: h.jobs.unused }).ok).toBe(true);
  });

  it("is allowed once its money has moved to another job (domain model, awkward cases)", () => {
    const assigned = accepted(run(h.facts, { kind: "assign", month: november, jobId: h.jobs.unused, amount: kr(500) }));
    expect(run(assigned, { kind: "deleteJob", jobId: h.jobs.unused })).toMatchObject({ ok: false, refusal: { code: "jobInUse" } });
    const moved = accepted(run(assigned, { kind: "moveAssignment", month: november, from: h.jobs.unused, to: h.jobs.food, amount: kr(500) }));
    expect(accepted(run(moved, { kind: "deleteJob", jobId: h.jobs.unused })).jobs.has(h.jobs.unused)).toBe(false);
  });

  it("of a job that keeps its money is refused while its bucket holds money, and allowed once it's empty", () => {
    const b = factsBuilder({ planStart: "2026-11" });
    b.account({ name: "Everyday" });
    b.buffer({ monthly: kr(1_000) });
    const holiday = b.saveUpJob({ name: "Holiday", target: monthlySaving(kr(800)) });
    b.budgetMonth("2026-11", "open");
    b.assign("2026-11", holiday, kr(800));
    const funded = b.facts();
    expect(run(funded, { kind: "deleteJob", jobId: holiday })).toMatchObject({ ok: false, refusal: { code: "bucketHoldsMoney" } });
    const emptied = accepted(run(funded, { kind: "assign", month: november, jobId: holiday, amount: kr(0) }));
    expect(accepted(run(emptied, { kind: "deleteJob", jobId: holiday })).jobs.has(holiday)).toBe(false);
  });

  it("with transactions is refused, and the family can archive it instead", () => {
    expect(run(h.facts, { kind: "deleteJob", jobId: h.jobs.food })).toMatchObject({ ok: false, refusal: { code: "jobInUse" } });
    expect(accepted(run(h.facts, { kind: "changeJob", jobId: h.jobs.food, changes: { status: "archived" } })).jobs.get(h.jobs.food)?.status).toBe("archived");
  });
});

describe("changing a job", () => {
  it("keeps the buffer's target following the plan", () => {
    const result = run(h.facts, { kind: "changeJob", jobId: h.jobs.buffer, changes: { ofKind: { kind: "saveUp", target: monthlySaving(kr(500)) } } });
    expect(!result.ok && result.refusal.code === "breaksFacts" && result.refusal.violations.map((v) => v.code)).toEqual(["bufferTarget"]);
    const monthly = accepted(run(h.facts, { kind: "changeJob", jobId: h.jobs.buffer, changes: { ofKind: { kind: "saveUp", target: { kind: "bufferMonths", monthly: kr(3_000) } } } }));
    expect(monthly.jobs.get(h.jobs.buffer)).toMatchObject({ role: "buffer", target: { kind: "bufferMonths", monthly: kr(3_000) } });
  });

  it("refuses a negative amount in the plan", () => {
    expect(run(h.facts, { kind: "changeJob", jobId: h.jobs.holiday, changes: { ofKind: { kind: "saveUp", target: monthlySaving(kr(-1)) } } })).toMatchObject({ ok: false, refusal: { code: "negativeAmount" } });
  });

  it("changes only the fields it names", () => {
    const after = accepted(run(h.facts, { kind: "changeJob", jobId: h.jobs.holiday, changes: { name: "Summer holiday" } }));
    expect(after.jobs.get(h.jobs.holiday)).toEqual({ ...h.facts.jobs.get(h.jobs.holiday), name: "Summer holiday" });
  });
});
