import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareVersions, nextVersion, parseBacklog, stateFromBacklog, versionProblems } from "./version-state.mjs";

const backlog = (source: string) => stateFromBacklog(source);

const alpha1 = { stage: "alpha" as const, total: 7, completedCount: 1, v1Declared: false, milestones: [] };
const alpha6 = { ...alpha1, completedCount: 6 };
const beta = { stage: "beta" as const, total: 7, completedCount: 7, v1Declared: false, milestones: [] };
const v1 = { stage: "v1" as const, total: 7, completedCount: 7, v1Declared: true, milestones: [] };

describe("the real backlog", () => {
  it("is alpha with three milestones complete, and Milestone 1 still open on the icon", () => {
    const source = readFileSync(new URL("../BACKLOG.md", import.meta.url), "utf8");
    const state = backlog(source);
    expect(state.total).toBe(7);
    expect(state.completedCount).toBe(3); // M0, M2, M3
    expect(state.stage).toBe("alpha");
    expect(state.milestones[0].complete).toBe(true);
    expect(state.milestones[1].complete).toBe(false);
    expect(state.milestones[1].open.join(" ")).toContain("icon");
    expect(state.milestones[2].complete).toBe(true);
    expect(state.milestones[3].complete).toBe(true);
    expect(state.milestones[4].complete).toBe(false);
  });
});

describe("reading the plan", () => {
  const two = (a: string, b: string) => `## Milestone 0: First\n- [${a}] **One.** Done thing\n\n## Milestone 1: Second\n- [${b}] **Two.** Open thing\n`;
  const v1box = (tick: string) => `\n## v1 (when Stephen says it is ready)\n- [${tick}] **v1.0.0.** Declared\n`;

  it("counts a milestone complete only when every box is ticked", () => {
    expect(backlog(two("x", "x")).stage).toBe("beta");
    expect(backlog(two("x", " ")).stage).toBe("alpha");
    expect(backlog(two(" ", " ")).completedCount).toBe(0);
  });

  it("makes v1 only when its box is ticked", () => {
    expect(backlog(two("x", "x") + v1box(" ")).stage).toBe("beta");
    expect(backlog(two("x", "x") + v1box("x")).stage).toBe("v1");
    expect(backlog(two("x", " ") + v1box("x")).stage).toBe("alpha");
  });

  it("ignores boxes outside the milestone and v1 sections", () => {
    const withOther = `## To decide\n- [ ] **Updater.** Later\n\n${two("x", "x")}`;
    expect(backlog(withOther).stage).toBe("beta");
    const parsed = parseBacklog(withOther);
    expect(parsed.milestones).toHaveLength(2);
    expect(parsed.v1.items).toHaveLength(0);
  });
});

describe("the version the plan allows", () => {
  it("alpha: 0.M.0-alpha.N, where M is the milestones complete", () => {
    expect(versionProblems("0.1.0-alpha.1", alpha1)).toEqual([]);
    expect(versionProblems("0.6.0-alpha.9", alpha6)).toEqual([]);
    expect(versionProblems("0.0.0", alpha1)).not.toEqual([]);
    expect(versionProblems("0.2.0-alpha.1", alpha1)).not.toEqual([]); // one milestone complete, not two
    expect(versionProblems("0.1.0", alpha1)).not.toEqual([]);
    expect(versionProblems("0.1.0-beta.1", alpha1)).not.toEqual([]);
    expect(versionProblems("1.0.0", alpha1)).not.toEqual([]);
    expect(versionProblems("0.1.0-alpha.0", alpha1)).not.toEqual([]);
  });

  it("beta: 0.7.0-beta.N while every milestone is done", () => {
    expect(versionProblems("0.7.0-beta.1", beta)).toEqual([]);
    expect(versionProblems("0.6.0-alpha.5", beta)).not.toEqual([]);
    expect(versionProblems("1.0.0", beta)).not.toEqual([]);
  });

  it("v1: 1.0.0 or later, no prerelease", () => {
    expect(versionProblems("1.0.0", v1)).toEqual([]);
    expect(versionProblems("1.2.3", v1)).toEqual([]);
    expect(versionProblems("0.7.0-beta.4", v1)).not.toEqual([]);
    expect(versionProblems("2.0.0-beta.1", v1)).not.toEqual([]);
  });
});

describe("the next version", () => {
  it("starts at 0.1.0-alpha.1 from the placeholder", () => {
    expect(nextVersion("0.0.0", alpha1)).toEqual({ version: "0.1.0-alpha.1" });
  });

  it("counts builds within the same milestone", () => {
    expect(nextVersion("0.1.0-alpha.1", alpha1)).toEqual({ version: "0.1.0-alpha.2" });
    expect(nextVersion("0.1.0-alpha.12", alpha1)).toEqual({ version: "0.1.0-alpha.13" });
  });

  it("starts a new build number when a milestone completes", () => {
    expect(nextVersion("0.1.0-alpha.3", alpha6)).toEqual({ version: "0.6.0-alpha.1" });
  });

  it("moves from beta to 1.0.0 when Stephen declares it", () => {
    expect(nextVersion("0.7.0-beta.2", v1)).toEqual({ version: "1.0.0" });
  });

  it("refuses to lower a version", () => {
    expect(nextVersion("0.6.0-alpha.1", alpha1).error).toMatch(/never lowered/);
    expect(nextVersion("0.7.0-beta.1", alpha1).error).toMatch(/never lowered/);
    expect(nextVersion("1.0.0", beta).error).toMatch(/never lowered/);
  });

  it("leaves releases after 1.0.0 to be chosen by hand", () => {
    expect(nextVersion("1.0.0", v1).error).toMatch(/by hand/);
    expect(nextVersion("1.1.0", v1).error).toMatch(/by hand/);
  });

  it("does not guess after a version the plan does not set", () => {
    expect(nextVersion("1.0.0-beta.1", v1).error).toMatch(/by hand/);
  });
});

describe("ordering versions", () => {
  it("the way semver does", () => {
    expect(compareVersions("0.1.0-alpha.2", "0.1.0-alpha.10")).toBe(-1);
    expect(compareVersions("0.1.0-alpha.3", "0.2.0-alpha.1")).toBe(-1);
    expect(compareVersions("0.7.0-beta.1", "0.7.0")).toBe(-1);
    expect(compareVersions("0.7.0-beta.1", "0.6.0-alpha.9")).toBe(1);
    expect(compareVersions("1.0.0", "0.7.0-beta.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
  });
});
