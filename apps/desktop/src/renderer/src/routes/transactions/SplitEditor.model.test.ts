import { type JobId, type Money, currency, jobId, makeSplit, money } from "@holt/core";
import { testId } from "@holt/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type SplitDraft,
  addRow,
  assignRest,
  checkSplit,
  initialDraft,
  maxSplitRows,
  parseAmountText,
  removeRow,
  setRowJob,
  setRowText,
  splitEvenly,
} from "./SplitEditor.model.ts";

const NOK = currency("NOK");
const food = jobId(testId(1));
const electricity = jobId(testId(2));
const insurance = jobId(testId(3));
const car = jobId(testId(4));
const jobs: readonly JobId[] = Array.from({ length: 14 }, (_, i) => jobId(testId(100 + i)));

/** A draft with these rows, written as [job, text]. */
function draftOf(rows: readonly (readonly [JobId | null, string])[]): SplitDraft {
  return { rows: rows.map(([job, text], key) => ({ key, jobId: job, text })), nextKey: rows.length };
}
const check = (amount: number, rows: readonly (readonly [JobId | null, string])[]) => checkSplit({ amount: money(amount) }, draftOf(rows).rows, NOK);

describe("reading an amount as typed", () => {
  it("reads whole kroner, øre, spaces and thousands", () => {
    expect(parseAmountText("700", NOK)).toBe(70_000);
    expect(parseAmountText("700,50", NOK)).toBe(70_050);
    expect(parseAmountText("700.5", NOK)).toBe(70_050);
    expect(parseAmountText("1 234,50", NOK)).toBe(123_450);
    expect(parseAmountText("1,234", NOK)).toBe(123_400);
    expect(parseAmountText(" 49.90 ", NOK)).toBe(4_990);
  });

  it("reads nothing from text that is not an amount", () => {
    for (const text of ["", "  ", "abc", "12 kr", "1.234", "1e3", "5,,5"]) expect(parseAmountText(text, NOK)).toBeNull();
  });

  it("never reads a comma decimal as a thousand: 1,50 is one krone fifty", () => {
    expect(parseAmountText("1,50", NOK)).toBe(150);
  });
});

describe("what Save lets through", () => {
  it("allows allocations that add up to the whole amount exactly, with the transaction's sign", () => {
    const result = check(-270_300, [
      [insurance, "2000"],
      [electricity, "703"],
    ]);
    expect(result.blockers).toEqual([]);
    expect(result.allocations).toEqual([
      { jobId: insurance, amount: -200_000 },
      { jobId: electricity, amount: -70_300 },
    ]);
  });

  it("gives a refund's allocations a plus sign", () => {
    const result = check(30_000, [[food, "100"], [electricity, "200"]]);
    expect(result.allocations).toEqual([
      { jobId: food, amount: 10_000 },
      { jobId: electricity, amount: 20_000 },
    ]);
  });

  it("blocks Save when the rows are one øre short, and says how much is left", () => {
    const result = check(-270_300, [[insurance, "2000"], [electricity, "702,99"]]);
    expect(result.allocations).toBeNull();
    expect(result.left).toBe(1);
    expect(result.blockers).toEqual(["notAllAssigned"]);
  });

  it("blocks Save when the rows are one øre over, and says how much", () => {
    const result = check(-270_300, [[insurance, "2000"], [electricity, "703,01"]]);
    expect(result.allocations).toBeNull();
    expect(result.left).toBe(-1);
    expect(result.blockers).toEqual(["over"]);
  });

  it("blocks Save for a row with no job, no amount, a zero amount, a negative or garbled amount, or a job used twice", () => {
    expect(check(-1_000, [[null, "10"]]).blockers).toEqual(["noJob"]);
    expect(check(-1_000, [[food, ""]]).blockers).toEqual(["noAmount", "notAllAssigned"]);
    expect(check(-1_000, [[food, "0"], [car, "10"]]).blockers).toContain("zero");
    expect(check(-1_000, [[food, "-10"]]).blockers).toContain("badAmount");
    expect(check(-1_000, [[food, "ten"]]).blockers).toContain("badAmount");
    expect(check(-1_000, [[food, "4"], [food, "6"]]).blockers).toContain("duplicateJob");
    expect(check(-1_000, [[food, "4"], [food, "6"]]).allocations).toBeNull();
  });

  it("blocks Save for more than 12 rows", () => {
    const rows = jobs.slice(0, 13).map((job) => [job, "1"] as const);
    const result = check(-1_300, rows);
    expect(result.blockers).toContain("tooMany");
    expect(result.allocations).toBeNull();
    expect(check(-1_200, rows.slice(0, 12)).allocations).not.toBeNull();
  });

  it("blocks Save for a transaction of nothing", () => {
    expect(check(0, [[food, "1"]]).allocations).toBeNull();
  });

  it("allows a single job for the whole amount", () => {
    expect(check(-5_000, [[food, "50"]]).allocations).toEqual([{ jobId: food, amount: -5_000 }]);
  });
});

describe("the rows", () => {
  it("starts from two empty rows, or from the allocations it is given, plus an empty row for a single job", () => {
    expect(initialDraft(undefined, NOK, ".").rows).toHaveLength(2);
    const one = initialDraft([{ jobId: food, amount: money(-12_345) }], NOK, ",");
    expect(one.rows.map((r) => [r.jobId, r.text])).toEqual([[food, "123,45"], [null, ""]]);
    const two = initialDraft([{ jobId: food, amount: money(-100) }, { jobId: car, amount: money(-200) }], NOK, ".");
    expect(two.rows.map((r) => r.text)).toEqual(["1", "2"]);
  });

  it("adds rows up to 12 and removes rows down to 1", () => {
    let draft = initialDraft(undefined, NOK, ".");
    for (let i = 0; i < 20; i += 1) draft = addRow(draft);
    expect(draft.rows).toHaveLength(maxSplitRows);
    expect(new Set(draft.rows.map((r) => r.key)).size).toBe(maxSplitRows);
    for (let i = 0; i < 20; i += 1) draft = removeRow(draft, draft.rows[0]!.key);
    expect(draft.rows).toHaveLength(1);
  });
});

describe("Assign the rest", () => {
  it("puts everything the other rows leave into the row, down to the øre", () => {
    const transaction = { amount: money(-270_351) };
    const draft = draftOf([[insurance, "2000"], [electricity, ""]]);
    expect(assignRest(draft, 1, transaction, NOK, ".").rows[1]!.text).toBe("703.51");
    expect(assignRest(draft, 1, transaction, NOK, ",").rows[1]!.text).toBe("703,51");
  });

  it("counts the other rows only, so pressing it on a filled row corrects that row", () => {
    const transaction = { amount: money(-10_000) };
    const draft = draftOf([[food, "30"], [car, "5"]]);
    expect(assignRest(draft, 1, transaction, NOK, ".").rows[1]!.text).toBe("70");
  });

  it("makes the split save when the other rows are right", () => {
    const transaction = { amount: money(-270_351) };
    const draft = assignRest(draftOf([[insurance, "2000"], [electricity, ""]]), 1, transaction, NOK, ".");
    expect(checkSplit(transaction, draft.rows, NOK).allocations).not.toBeNull();
  });

  it("does nothing when the other rows already use all of it", () => {
    const transaction = { amount: money(-1_000) };
    const draft = draftOf([[food, "10"], [car, ""]]);
    expect(assignRest(draft, 1, transaction, NOK, ".")).toBe(draft);
  });
});

describe("Split evenly", () => {
  it("gives the extra øre to the first rows, so the pieces add up exactly", () => {
    const draft = splitEvenly(draftOf([[food, ""], [car, ""], [insurance, ""]]), { amount: money(-10_000) }, NOK, ".");
    expect(draft.rows.map((r) => r.text)).toEqual(["33.34", "33.33", "33.33"]);
    const two = splitEvenly(draftOf([[food, ""], [car, ""], [insurance, ""]]), { amount: money(-11) }, NOK, ".");
    expect(two.rows.map((r) => r.text)).toEqual(["0.04", "0.04", "0.03"]);
  });

  it("always adds up to the whole amount, and no piece is more than one øre from another (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000_000 }), fc.integer({ min: 1, max: maxSplitRows }), fc.boolean(), (total, rowCount, negative) => {
        const amount = money(negative ? -total : total);
        const draft = splitEvenly(draftOf(jobs.slice(0, rowCount).map((job) => [job, ""] as const)), { amount }, NOK, ".");
        const pieces = draft.rows.map((row) => parseAmountText(row.text, NOK)!);
        expect(pieces.reduce((sum, piece) => sum + piece, 0)).toBe(total);
        expect(Math.max(...pieces) - Math.min(...pieces)).toBeLessThanOrEqual(1);
        expect(pieces).toEqual([...pieces].sort((a, b) => b - a));
      }),
    );
  });
});

describe("whatever the family does, a split they can save is a split core accepts (property)", () => {
  type Step =
    | { readonly kind: "add" }
    | { readonly kind: "remove"; readonly at: number }
    | { readonly kind: "job"; readonly at: number; readonly job: number | null }
    | { readonly kind: "text"; readonly at: number; readonly text: string }
    | { readonly kind: "rest"; readonly at: number }
    | { readonly kind: "evenly" };

  const texts = fc.oneof(
    fc.integer({ min: 0, max: 99_999 }).map((n) => (n / 100).toFixed(2)),
    fc.integer({ min: 0, max: 2_000 }).map(String),
    fc.constantFrom("", "0", "-5", "abc", "1,5", "1 000", "12.345", "7,"),
  );
  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.constant<Step>({ kind: "add" }),
    fc.record({ kind: fc.constant("remove" as const), at: fc.nat(13) }),
    fc.record({ kind: fc.constant("job" as const), at: fc.nat(13), job: fc.option(fc.nat(13), { nil: null }) }),
    fc.record({ kind: fc.constant("text" as const), at: fc.nat(13), text: texts }),
    fc.record({ kind: fc.constant("rest" as const), at: fc.nat(13) }),
    fc.constant<Step>({ kind: "evenly" }),
  );

  const amount = fc.integer({ min: -500_000, max: 500_000 }).filter((n) => n !== 0).map((n): Money => money(n));

  it("holds after every step", () => {
    fc.assert(
      fc.property(amount, fc.array(step, { maxLength: 40 }), (total, steps) => {
        const transaction = { amount: total };
        let draft = initialDraft(undefined, NOK, ".");
        for (const s of steps) {
          const row = draft.rows[s.kind === "add" || s.kind === "evenly" ? 0 : s.at % draft.rows.length];
          if (s.kind === "add") draft = addRow(draft);
          else if (s.kind === "evenly") draft = splitEvenly(draft, transaction, NOK, ".");
          else if (row !== undefined && s.kind === "remove") draft = removeRow(draft, row.key);
          else if (row !== undefined && s.kind === "job") draft = setRowJob(draft, row.key, s.job === null ? null : jobs[s.job % jobs.length]!);
          else if (row !== undefined && s.kind === "text") draft = setRowText(draft, row.key, s.text);
          else if (row !== undefined && s.kind === "rest") draft = assignRest(draft, row.key, transaction, NOK, ".");

          const result = checkSplit(transaction, draft.rows, NOK);
          expect(draft.rows.length).toBeLessThanOrEqual(maxSplitRows);
          if (result.allocations === null) {
            expect(result.blockers.length).toBeGreaterThan(0);
            continue;
          }
          expect(result.blockers).toEqual([]);
          expect(() => makeSplit(total, result.allocations!)).not.toThrow();
          expect(result.allocations.every((a) => a.amount !== 0 && Math.sign(a.amount) === Math.sign(total))).toBe(true);
          expect(new Set(result.allocations.map((a) => a.jobId)).size).toBe(result.allocations.length);
          expect(result.allocations.length).toBeLessThanOrEqual(maxSplitRows);
        }
      }),
      { numRuns: 600 },
    );
  });

  it("lets Save through whenever every row has its own job and the rows were shared out evenly", () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 1, max: maxSplitRows }), (total, rowCount) => {
        fc.pre(Math.abs(total) >= rowCount);
        const draft = splitEvenly(draftOf(jobs.slice(0, rowCount).map((job) => [job, ""] as const)), { amount: total }, NOK, ".");
        expect(checkSplit({ amount: total }, draft.rows, NOK).allocations).not.toBeNull();
      }),
    );
  });
});
