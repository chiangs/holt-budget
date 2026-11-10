import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type PickableJob, groupedJobs, jobAt, moveActive, pickableJobs, searchJobs } from "./jobs.ts";
import { buildWorld } from "./test-support.ts";

const names = (jobs: readonly PickableJob[]) => jobs.map((job) => job.name);

describe("pickableJobs", () => {
  const world = buildWorld();
  const jobs = pickableJobs(world.facts);

  it("lists active jobs in group order and then by name, and the buffer is one of them", () => {
    expect(jobs.map((job) => `${job.groupName}: ${job.name}`)).toEqual([
      "Fixed costs: Electricity",
      "Fixed costs: Phones and internet",
      "Living: Coffee",
      "Living: Food and household",
      "Saving: Buffer",
    ]);
  });

  it("never offers a paused, finished or archived job", () => {
    expect(names(jobs)).not.toContain("Union fees");
    expect(names(jobs)).not.toContain("Holidays");
    expect(names(jobs)).not.toContain("Books and games");
  });

  it("names the job by its ID, so picking returns the job shown", () => {
    const coffee = jobs.find((job) => job.name === "Coffee");
    expect(coffee?.id).toBe(world.jobs.coffee);
  });

  it("is the same whatever order the facts hold the jobs in", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...world.facts.jobs.entries()], { minLength: world.facts.jobs.size }), (entries) => {
        const shuffled = { ...world.facts, jobs: new Map(entries) };
        expect(pickableJobs(shuffled)).toEqual(jobs);
      }),
    );
  });
});

describe("searchJobs and groupedJobs", () => {
  const jobs = pickableJobs(buildWorld().facts);

  it("keeps every job for an empty search", () => {
    expect(searchJobs(jobs, "  ")).toEqual(jobs);
  });

  it("matches a name or a group, ignoring case, with every word typed", () => {
    expect(names(searchJobs(jobs, "COFF"))).toEqual(["Coffee"]);
    expect(names(searchJobs(jobs, "living"))).toEqual(["Coffee", "Food and household"]);
    expect(names(searchJobs(jobs, "fixed phones"))).toEqual(["Phones and internet"]);
    expect(searchJobs(jobs, "zebra")).toEqual([]);
  });

  it("gathers neighbouring jobs under their group, in the order the picker shows them", () => {
    const groups = groupedJobs(jobs);
    expect(groups.map((group) => group.name)).toEqual(["Fixed costs", "Living", "Saving"]);
    expect(groups.flatMap((group) => names(group.jobs))).toEqual(names(jobs));
  });

  it("finds the job at an index in that order, and none out of range", () => {
    const groups = groupedJobs(jobs);
    expect(jobAt(groups, 2)?.name).toBe("Coffee");
    expect(jobAt(groups, 4)?.name).toBe("Buffer");
    expect(jobAt(groups, 5)).toBeNull();
    expect(jobAt(groups, -1)).toBeNull();
  });
});

describe("moveActive", () => {
  it("stops at the ends and stays inside the list", () => {
    expect(moveActive(0, -1, 5)).toBe(0);
    expect(moveActive(4, 1, 5)).toBe(4);
    expect(moveActive(1, 1, 5)).toBe(2);
    expect(moveActive(0, 1, 0)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: 1, max: 50 }), (index, step, count) => {
        const next = moveActive(Math.min(index, count - 1), step, count);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(count);
      }),
    );
  });
});
