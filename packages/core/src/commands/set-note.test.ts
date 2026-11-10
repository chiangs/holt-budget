import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { emptyChangeLog, undo } from "../change-log.ts";
import type { Facts } from "../facts.ts";
import { transactionId } from "../ids.ts";
import { withRules, withTransaction, ruleOf } from "../rules/rule-fixtures.ts";
import { accepted, changeMeta, commandHousehold, today } from "../testing/command-household.ts";
import { testId } from "../testing/facts-builder.ts";
import { type ApplyResult, apply, commit } from "./apply.ts";

const h = commandHousehold();
const id = h.transactions.shopping;
const setNote = (facts: Facts, note: string, transaction = id): ApplyResult => apply(facts, { kind: "setNote", transactionId: transaction, note }, { asOf: today });
const noteOf = (facts: Facts): string | undefined => facts.transactions.get(id)?.note;
const withNote = withTransaction(h.facts, id, { note: "Birthday present" });

describe("setNote", () => {
  it("stores the note without the whitespace around it", () => {
    expect(noteOf(accepted(setNote(h.facts, "  Birthday present \n")))).toBe("Birthday present");
  });

  it("keeps the whitespace inside a note", () => {
    expect(noteOf(accepted(setNote(h.facts, " two  words\nand a line ")))).toBe("two  words\nand a line");
  });

  it("replaces an earlier note", () => {
    expect(noteOf(accepted(setNote(withNote, "Returned")))).toBe("Returned");
  });

  it("removes the note when it is empty or only whitespace, leaving no field behind", () => {
    for (const empty of ["", "   ", "\t\n"]) {
      const after = accepted(setNote(withNote, empty)).transactions.get(id);
      expect(after && Object.hasOwn(after, "note")).toBe(false);
    }
  });

  it("changes nothing when there is no note to remove, or the note is already that", () => {
    const none = setNote(h.facts, "  ");
    expect(none.ok && none.patch).toEqual([]);
    const same = setNote(withNote, " Birthday present ");
    expect(same.ok && same.patch).toEqual([]);
  });

  it("changes only the note, whatever else the transaction carries", () => {
    const rule = ruleOf({ n: 1, counterparty: "Kiwi", result: { kind: "job", jobId: h.jobs.food } });
    const rich = withTransaction(withRules(h.facts, rule), id, { counterparty: "Kiwi", reference: "1234", ruleId: rule.id, transactionDate: today });
    const before = rich.transactions.get(id);
    const { note: _ignored, ...rest } = accepted(setNote(rich, "Noted")).transactions.get(id) ?? {};
    expect(rest).toEqual(before);
    const { note: _removed, ...kept } = accepted(setNote(accepted(setNote(rich, "Noted")), "")).transactions.get(id) ?? {};
    expect(kept).toEqual(before);
  });

  it("refuses a transaction the app can't find", () => {
    expect(setNote(h.facts, "x", transactionId(testId(999_999)))).toMatchObject({ ok: false, refusal: { code: "transactionNotFound" } });
  });

  it("is one change that undo takes back, whether it adds, replaces or removes a note", () => {
    for (const [start, note] of [[h.facts, "New"], [withNote, "Different"], [withNote, ""]] as const) {
      const done = commit(start, emptyChangeLog(), { kind: "setNote", transactionId: id, note }, changeMeta(1), { asOf: today });
      if (!done.ok) throw new Error("refused");
      const undone = undo(done.facts, done.log);
      expect(undone.ok && undone.facts).toEqual(start);
    }
  });

  it("gives the same note for any text, trimmed, and an empty text always removes it", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (text) => {
        const note = noteOf(accepted(setNote(h.facts, text)));
        if (text.trim() === "") expect(note).toBeUndefined();
        else expect(note).toBe(text.trim());
      }),
    );
  });
});
