import { type Facts, type Job, type JobId, apply, computeFigures, month } from "@holt/core";
import { kr } from "@holt/core/testing";
import { describe, expect, it } from "vitest";
import { bannerOf, quickAddCommand, quickAddJobs } from "./PlanBanner.model.ts";
import { planMonthOf } from "./PlanMonth.model.ts";
import { assignedInNovember, buildWorld, today } from "./PlanTestWorld.ts";

function bannerFor(world: ReturnType<typeof buildWorld>) {
  const shown = planMonthOf(world.facts, world.figures);
  if (shown === null) throw new Error("No month");
  return bannerOf(world.facts, world.figures, shown);
}

function withJob(facts: Facts, id: JobId, change: Partial<Job>): Facts {
  const job = facts.jobs.get(id);
  if (job === undefined) throw new Error("No job");
  return { ...facts, jobs: new Map(facts.jobs).set(id, { ...job, ...change } as Job) };
}

describe("the banner", () => {
  it("says how much has no job yet, and offers the buffer and the save-up job furthest from its target", () => {
    const world = buildWorld({ income: assignedInNovember + 228 });
    const banner = bannerFor(world);
    expect(banner.kind).toBe("unassigned");
    if (banner.kind !== "unassigned") return;
    expect(banner.amount).toBe(kr(228));
    expect(banner.quickAdds.map((add) => add.name)).toEqual(["Buffer", "Confirmation"]);
    expect(banner.quickAdds.map((add) => add.assignTo)).toEqual([kr(2_000 + 228), kr(1_500 + 228)]);
  });

  it("gives the whole unassigned amount to the job and leaves nothing unassigned", () => {
    const world = buildWorld({ income: assignedInNovember + 228 });
    const banner = bannerFor(world);
    if (banner.kind !== "unassigned") throw new Error("Expected unassigned money");
    for (const add of banner.quickAdds) {
      const result = apply(world.facts, quickAddCommand(month("2026-11"), add), { asOf: today });
      if (!result.ok) throw new Error(result.refusal.message);
      const after = computeFigures(result.facts, today).months.get(month("2026-11"));
      expect(after?.unassigned).toEqual({ kind: "unassigned", amount: 0 });
      expect(after?.jobs.get(add.jobId)?.assigned.amount).toBe(add.assignTo);
    }
  });

  it("offers a job only while it is active and its bucket is short of its target", () => {
    const world = buildWorld({ income: assignedInNovember + 228 });
    const paused = withJob(world.facts, world.jobs.confirmation, { status: "paused" });
    expect(quickAddJobs(paused, computeFigures(paused, today)).map((job) => job.name)).toEqual(["Buffer", "Holidays"]);

    const reached = withJob(world.facts, world.jobs.confirmation, { opening: kr(38_000) });
    expect(quickAddJobs(reached, computeFigures(reached, today)).map((job) => job.name)).toEqual(["Buffer", "Holidays"]);
  });

  it("never offers a save-up job that has no target to reach, or more than two jobs", () => {
    const world = buildWorld({ income: assignedInNovember + 228 });
    const names = quickAddJobs(world.facts, world.figures).map((job) => job.name);
    expect(names).toHaveLength(2);
    expect(names).not.toContain("Christmas");
    expect(names).not.toContain("Build savings");
  });

  it("says every unit has a job when nothing is left", () => {
    expect(bannerFor(buildWorld({ income: assignedInNovember }))).toEqual({ kind: "none" });
  });

  it("says how much is over-assigned, not unassigned", () => {
    expect(bannerFor(buildWorld({ income: assignedInNovember - 8_150 }))).toEqual({ kind: "overAssigned", amount: kr(8_150) });
  });

  it("says the month isn't open, and which month the family can open next", () => {
    expect(bannerFor(buildWorld({ november: "planned" }))).toEqual({ kind: "notOpen", month: "2026-11", toOpen: "2026-11" });
    const behind = buildWorld({ planStart: "2026-09", november: "planned", openEarlier: false });
    expect(bannerFor(behind)).toEqual({ kind: "notOpen", month: "2026-11", toOpen: "2026-09" });
  });

  it("says a closed month is closed", () => {
    expect(bannerFor(buildWorld({ november: "closed" }))).toEqual({ kind: "closed", month: "2026-11" });
  });
});
