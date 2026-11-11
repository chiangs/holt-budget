import { type AccountId, type Facts, type Figures, type ImportBatch, type ImportRow, computeFigures, importBatchId, importRowId, localDate, month, transactionId } from "@holt/core";
import { kr, testId } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { dataReachesTo, planBadge, planMonthOf } from "./PlanMonth.model.ts";
import { assignedInNovember, buildWorld, today } from "./PlanTestWorld.ts";

function viewOf(facts: Facts, figures: Figures) {
  return planMonthOf(facts, figures);
}

describe("the month Plan shows", () => {
  it("is the current month, and an open or reopened month takes assignments", () => {
    for (const state of ["open", "reopened"] as const) {
      const world = buildWorld({ november: state });
      const shown = viewOf(world.facts, world.figures);
      expect(shown?.month).toBe("2026-11");
      expect(shown?.access).toBe("editable");
    }
  });

  it("is only projected until the month is opened, and takes no change once it is closed", () => {
    const planned = buildWorld({ november: "planned" });
    expect(viewOf(planned.facts, planned.figures)?.access).toBe("projection");
    const closed = buildWorld({ november: "closed" });
    expect(viewOf(closed.facts, closed.figures)?.access).toBe("closed");
  });

  it("is the plan start while the plan hasn't started", () => {
    const world = buildWorld({ planStart: "2026-12", november: "planned", openEarlier: false });
    const early = computeFigures(world.facts, today);
    expect(viewOf(world.facts, early)?.month).toBe(month("2026-12"));
  });
});

describe("the sidebar badge", () => {
  it("says how much has no job", () => {
    const world = buildWorld({ income: assignedInNovember + 228 });
    expect(planBadge(world.facts, world.figures)).toEqual({ kind: "unassigned", amount: kr(228) });
  });

  it("says how much is over-assigned", () => {
    const world = buildWorld({ income: assignedInNovember - 500 });
    expect(planBadge(world.facts, world.figures)).toEqual({ kind: "overAssigned", amount: kr(500) });
  });

  it("says nothing when every unit has a job, or when the month can't be assigned", () => {
    const even = buildWorld({ income: assignedInNovember });
    expect(planBadge(even.facts, even.figures)).toBeNull();
    const planned = buildWorld({ november: "planned", income: assignedInNovember + 228 });
    expect(planBadge(planned.facts, planned.figures)).toBeNull();
    const closed = buildWorld({ november: "closed", income: assignedInNovember + 228 });
    expect(planBadge(closed.facts, closed.figures)).toBeNull();
  });
});

function withImports(world: ReturnType<typeof buildWorld>, covers: readonly (readonly [AccountId, string | null])[]): Facts {
  const batch: ImportBatch = {
    id: importBatchId(testId(7_000)),
    fileName: "file.csv",
    fingerprint: "fingerprint",
    format: "bulder-csv",
    importedAt: "2026-11-07T12:00:00.000Z",
    from: localDate("2026-10-01"),
    to: localDate("2026-11-03"),
    rows: covers.length,
    created: covers.length,
    matched: 0,
    pending: 0,
    undone: false,
  };
  const rows: ImportRow[] = covers.flatMap(([accountId, date], n) =>
    date === null
      ? []
      : [
          {
            id: importRowId(testId(7_100 + n)),
            batchId: batch.id,
            line: n + 2,
            accountId,
            bookingDate: localDate(date),
            description: "row",
            amount: kr(-1),
            fingerprint: `row-${n}`,
            pending: false,
            backs: transactionId(testId(7_900 + n)),
          },
        ],
  );
  return { ...world.facts, importBatches: new Map([[batch.id, batch]]), importRows: new Map(rows.map((r) => [r.id, r])) };
}

describe("how far the data reaches", () => {
  const world = buildWorld();

  it("is the earliest date any shared account's imports reach", () => {
    const facts = withImports(world, [
      [world.accounts.everyday, "2026-11-08"],
      [world.accounts.savings, "2026-11-03"],
    ]);
    expect(dataReachesTo(computeFigures(facts, today))).toBe("2026-11-03");
  });

  it("is unknown while a shared account has nothing imported", () => {
    const facts = withImports(world, [
      [world.accounts.everyday, "2026-11-08"],
      [world.accounts.savings, null],
    ]);
    expect(dataReachesTo(computeFigures(facts, today))).toBeNull();
    expect(dataReachesTo(world.figures)).toBeNull();
  });
});
