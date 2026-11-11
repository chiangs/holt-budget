// CI gate for the versioning policy (decision 0049).
// The app's version must be the one the plan in BACKLOG.md allows, the private
// packages keep their 0.0.0 placeholder, and the version is after every tag
// already made. `pnpm version:check`.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, familyOf, parseVersion, readBacklog, stateFromBacklog, versionProblems } from "./version-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const state = stateFromBacklog(readBacklog(root));
const app = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8"));
problems.push(...versionProblems(app.version, state));

for (const dir of ["packages/core", "packages/importers", "packages/ui"]) {
  const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  if (pkg.version !== "0.0.0") problems.push(`${dir}/package.json is ${pkg.version}; the private packages keep 0.0.0, because only the app ships a version.`);
}

// A version is never reused: it must be after the newest tag already made.
if (parseVersion(app.version)) {
  const git = spawnSync("git", ["-C", root, "tag", "--list", "v*"], { encoding: "utf8" });
  const tags = git.status === 0 ? git.stdout.split("\n").map((t) => t.trim()).filter(Boolean) : [];
  if (tags.length > 0) {
    const newest = tags.reduce((a, b) => (compareVersions(a.slice(1), b.slice(1)) >= 0 ? a : b));
    if (compareVersions(app.version, newest.slice(1)) <= 0) problems.push(`${app.version} is not after the newest tag ${newest}. Bump it with pnpm version:bump.`);
  }
}

if (problems.length === 0) {
  console.log(`Version ${app.version} matches the plan (${state.stage}: ${state.completedCount} of ${state.total} milestones complete).`);
} else {
  const allowed = familyOf(state);
  console.error(`The version is ${app.version}, but the plan allows ${allowed ? `${allowed}.N` : "1.0.0 or later"}.`);
  console.error(`Stage: ${state.stage} — ${state.completedCount} of ${state.total} milestones complete in BACKLOG.md.`);
  for (const m of state.milestones) if (!m.complete) {
    console.error(`Milestone ${m.n} is still open:`);
    for (const t of m.open.slice(0, 3)) console.error(`  - ${t}`);
  }
  if (state.stage === "beta") console.error("All the milestones are complete; beta runs until Stephen declares v1.");
  for (const p of problems) console.error(`- ${p}`);
  console.error("Finish the open boxes, or set the version with pnpm version:bump (then tag the commit, like v0.1.0-alpha.1).");
  process.exitCode = 1;
}
