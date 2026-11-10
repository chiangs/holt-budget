import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Allocation, keyOfRow, makeSplit } from "./facts.ts";
import { jobId } from "./ids.ts";
import { MoneyError, money } from "./money.ts";

const job = (n: number) => jobId(`00000000-0000-7000-8000-${String(n).padStart(12, "0")}`);
const allocation = fc.record({ jobId: fc.integer({ min: 1, max: 5 }).map(job), amount: fc.integer({ min: -10_000_000, max: 10_000_000 }).map(money) });

describe("rule 3: a split adds up to its transaction", () => {
  it("can be built from any allocations that sum to the amount, and keeps them in order", () => {
    fc.assert(
      fc.property(fc.array(allocation, { minLength: 1, maxLength: 8 }), (allocations: Allocation[]) => {
        const total = money(allocations.reduce((sum, a) => sum + a.amount, 0));
        const split = makeSplit(total, allocations);
        expect(split.kind).toBe("split");
        expect([...split.allocations]).toEqual(allocations);
      }),
    );
  });

  it("is refused when the allocations are one unit over or under the amount", () => {
    fc.assert(
      fc.property(fc.array(allocation, { minLength: 1, maxLength: 8 }), fc.constantFrom(-1, 1), (allocations: Allocation[], off) => {
        const total = allocations.reduce((sum, a) => sum + a.amount, 0);
        expect(() => makeSplit(money(total + off), allocations)).toThrow(MoneyError);
      }),
    );
  });

  it("is refused when it has no allocations, even for a zero amount", () => {
    expect(() => makeSplit(money(0), [])).toThrow(MoneyError);
  });

  it("allows a refund: money coming in against a job", () => {
    const split = makeSplit(money(45_000), [{ jobId: job(1), amount: money(45_000) }]);
    expect(split.allocations[0].amount).toBe(45_000);
  });
});

describe("row keys", () => {
  it("name an assignment by its month and job, and a budget month by its month", () => {
    expect(keyOfRow("budgetMonths", { month: "2026-11" as never, state: "open" })).toBe("2026-11");
    expect(keyOfRow("assignments", { month: "2026-11" as never, jobId: job(7), amount: money(1) })).toBe(`2026-11/${job(7)}`);
  });
});
