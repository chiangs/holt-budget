import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import { month } from "../dates.ts";
import type { Facts } from "../facts.ts";
import { personId } from "../ids.ts";
import { accepted, changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { testId } from "../testing/facts-builder.ts";
import { type Command, apply, commit } from "./apply.ts";

const h = commandHousehold();
const run = (command: Command, facts: Facts = h.facts) => apply(facts, command, { asOf: today });
const sam = personId(testId(820_001));

describe("adding a person", () => {
  it("stores an adult, and a child with a birth month, as given", () => {
    const adult = accepted(run({ kind: "addPerson", person: { id: sam, name: "Sam", kind: "adult" } }));
    expect(adult.people.get(sam)).toEqual({ id: sam, name: "Sam", kind: "adult" });
    const child = accepted(run({ kind: "addPerson", person: { id: sam, name: "Sam", kind: "child", birthMonth: month("2020-08") } }));
    expect(child.people.get(sam)).toEqual({ id: sam, name: "Sam", kind: "child", birthMonth: month("2020-08") });
  });

  it("is refused for a name with nothing in it, and for an ID that is taken", () => {
    expect(run({ kind: "addPerson", person: { id: sam, name: "   ", kind: "adult" } })).toMatchObject({ ok: false, refusal: { code: "nameMissing" } });
    expect(run({ kind: "addPerson", person: { id: h.people.alex, name: "Another", kind: "adult" } })).toMatchObject({ ok: false, refusal: { code: "idTaken" } });
  });
});

describe("changing a person", () => {
  it("changes the name and keeps the kind", () => {
    const after = accepted(run({ kind: "changePerson", personId: h.people.alex, changes: { name: "Alex Nord" } }));
    expect(after.people.get(h.people.alex)).toEqual({ ...h.facts.people.get(h.people.alex), name: "Alex Nord" });
  });

  it("sets a birth month, changes it, and removes it with null", () => {
    const set = accepted(run({ kind: "changePerson", personId: h.people.alex, changes: { birthMonth: month("1988-02") } }));
    expect(set.people.get(h.people.alex)?.birthMonth).toBe("1988-02");
    const changed = accepted(run({ kind: "changePerson", personId: h.people.mia, changes: { birthMonth: month("2018-05") } }));
    expect(changed.people.get(h.people.mia)?.birthMonth).toBe("2018-05");
    const removed = accepted(run({ kind: "changePerson", personId: h.people.mia, changes: { birthMonth: null } }));
    expect(Object.hasOwn(removed.people.get(h.people.mia) ?? {}, "birthMonth")).toBe(false);
  });

  it("is refused for someone who isn't there and for a name with nothing in it", () => {
    expect(run({ kind: "changePerson", personId: sam, changes: { name: "Sam" } })).toMatchObject({ ok: false, refusal: { code: "personNotFound" } });
    expect(run({ kind: "changePerson", personId: h.people.alex, changes: { name: "" } })).toMatchObject({ ok: false, refusal: { code: "nameMissing" } });
  });
});

describe("deleting a person", () => {
  it("removes someone no agreement names", () => {
    expect(accepted(run({ kind: "deletePerson", personId: h.people.mia })).people.has(h.people.mia)).toBe(false);
  });

  it("is refused while a contribution agreement names them, even after the agreement has ended", () => {
    expect(run({ kind: "deletePerson", personId: h.people.alex })).toMatchObject({ ok: false, refusal: { code: "personInUse" } });
    const ended = accepted(run({ kind: "changeAgreement", agreementId: h.agreements.contribution, changes: { to: month("2026-11") } }));
    expect(run({ kind: "deletePerson", personId: h.people.alex }, ended)).toMatchObject({ ok: false, refusal: { code: "personInUse" } });
  });

  it("is refused for someone who isn't there", () => {
    expect(run({ kind: "deletePerson", personId: sam })).toMatchObject({ ok: false, refusal: { code: "personNotFound" } });
  });

  it("can be undone, which brings the person back exactly", () => {
    const deleted = commit(h.facts, emptyChangeLog(), { kind: "deletePerson", personId: h.people.mia }, changeMeta(1), { asOf: today });
    if (!deleted.ok) throw new Error("refused");
    const undone = undo(deleted.facts, deleted.log);
    expect(undone.ok && undone.facts).toEqual(h.facts);
  });
});
