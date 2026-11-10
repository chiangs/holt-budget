import { type Facts, apply, localDate, planImport } from "@holt/core";
import { kr } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { importRows, whenWords } from "./ImportsList.model.ts";
import { commitPlan, english, importHousehold, importInput, numbers, statement, today } from "./ImportTestKit.ts";

const h = importHousehold();
const shop = (date: string, description: string, amount = kr(-120)) => ({ account: numbers.everyday, date, amount, description, counterparty: description });

function importedTwice() {
  const before = h.facts();
  const firstPlan = planImport(before, statement([shop("2026-11-02", "Kiwi"), shop("2026-11-03", "Rema"), { ...shop("2026-11-04", "Rema"), pending: true }]), {
    ...importInput("first", 10_000),
    fileName: "first.csv",
    importedAt: "2026-11-05T09:00:00Z",
  });
  const one = commitPlan(before, firstPlan);
  const secondPlan = planImport(one, statement([shop("2026-11-03", "Rema"), shop("2026-11-07", "Coop")]), {
    ...importInput("second", 20_000),
    fileName: "second.csv",
    importedAt: "2026-11-08T09:00:00Z",
  });
  return { one, both: commitPlan(one, secondPlan), first: firstPlan, second: secondPlan };
}

describe("the Imports tab's rows", () => {
  it("lists the newest import first, with what each did", () => {
    const { both } = importedTwice();
    const rows = importRows(both, today);
    expect(rows.map((r) => [r.fileName, r.created, r.matched, r.pending, r.undone])).toEqual([
      ["second.csv", 1, 1, 0, false],
      ["first.csv", 2, 0, 1, false],
    ]);
    expect(rows[0]).toMatchObject({ from: "2026-11-03", to: "2026-11-07", accounts: ["Everyday"] });
    expect(english(rows[0]!.bank)).toBe("Another bank");
  });

  it("counts the transactions an import brought that still wait for a job", () => {
    const { both } = importedTwice();
    expect(importRows(both, today).map((r) => r.needsYou)).toEqual([1, 2]);
  });

  it("shows an undone import plainly, with no count of what it left waiting", () => {
    const { both, first } = importedTwice();
    if (!first.ok) throw new Error("expected a plan");
    const undone = apply(both, { kind: "undoImport", batchId: first.preview.batchId }, { asOf: today });
    if (!undone.ok) throw new Error("expected the undo to apply");
    const rows = importRows(undone.facts, today);
    expect(rows.map((r) => [r.fileName, r.undone, r.needsYou])).toEqual([
      ["second.csv", false, 1],
      ["first.csv", true, null],
    ]);
  });

  it("is empty before anything is imported", () => {
    expect(importRows(h.facts() satisfies Facts, today)).toEqual([]);
  });
});

describe("when it was imported", () => {
  const now = localDate("2026-11-10");
  const said = (importedAt: string) => english(whenWords(importedAt, now).words);
  const at = (date: string) => new Date(`${date}T12:00:00`).toISOString();

  it("counts days back from today, in words", () => {
    expect(said(at("2026-11-10"))).toBe("Added today");
    expect(said(at("2026-11-09"))).toBe("Added yesterday");
    expect(said(at("2026-11-07"))).toBe("Added 3 days ago");
  });

  it("gives the date once it is more than a month back", () => {
    expect(said(at("2026-10-11"))).toBe("Added 30 days ago");
    expect(said(at("2026-10-09"))).toBe("Added on 9 Oct 2026");
  });

  it("never says a day in the future", () => {
    expect(said(at("2026-11-12"))).toBe("Added today");
  });
});
