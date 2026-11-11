// The version follows the plan, not taste.
//
// BACKLOG.md is the source of truth: a milestone is complete when every box
// under it is ticked. While any milestone is open the app is alpha; when all
// the milestones are done it is beta; when Stephen ticks the v1 item it is
// 1.0.0. `check-version.mjs` fails on any version the plan does not allow,
// and `bump-version.mjs` sets the next one. Decision 0049.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The boxes under each `## Milestone N:` section, and the boxes under `## v1`. */
export function parseBacklog(source) {
  const milestones = [];
  const v1 = { items: [] };
  let section = null;
  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1];
      const milestone = title.match(/^Milestone (\d+):/);
      const isV1 = title === "v1" || title.startsWith("v1 "); // the "v1" box, not "v1.x (…)"
      section = milestone ? { kind: "milestone", n: Number(milestone[1]), items: [] } : isV1 ? { kind: "v1" } : null;
      if (section?.kind === "milestone") milestones.push(section);
      continue;
    }
    const box = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (!box || !section) continue;
    const item = { done: box[1] !== " ", text: box[2].trim() };
    if (section.kind === "v1") v1.items.push(item);
    else section.items.push(item);
  }
  milestones.sort((a, b) => a.n - b.n);
  return { milestones, v1 };
}

/** What the plan says right now: the stage, how many milestones are complete, and what is still open. */
export function stateFromBacklog(source) {
  const { milestones, v1 } = parseBacklog(source);
  const done = (m) => m.items.length > 0 && m.items.every((i) => i.done);
  const completedCount = milestones.filter(done).length;
  const v1Declared = v1.items.length > 0 && v1.items.every((i) => i.done) && completedCount === milestones.length && milestones.length > 0;
  const stage = v1Declared ? "v1" : completedCount === milestones.length && milestones.length > 0 ? "beta" : "alpha";
  const openOf = (m) => m.items.filter((i) => !i.done).map((i) => i.text);
  return {
    stage,
    total: milestones.length,
    completedCount,
    v1Declared,
    milestones: milestones.map((m) => ({ n: m.n, complete: done(m), open: openOf(m) })),
  };
}

export function readBacklog(rootOverride = root) {
  return readFileSync(join(rootOverride, "BACKLOG.md"), "utf8");
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** A version the plan can reason about; null when it is not one. */
export function parseVersion(text) {
  const v = String(text).trim();
  const m = v.match(SEMVER);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ? m[4].split(".").filter(Boolean) : [], text: v };
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // no prerelease sorts after one
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const [x, y] = [a[i], b[i]];
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) { if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1; }
    else if (xn) return -1;
    else if (yn) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

/** -1, 0 or 1, the way semver orders versions. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a version: ${a} ${b}`);
  for (const key of ["major", "minor", "patch"]) if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** Where a version sits in the plan: alpha builds, then beta, then 1.0.0 or later. */
function position(version) {
  const v = parseVersion(version);
  if (!v) return null;
  if (v.prerelease.length === 2 && v.prerelease[0] === "alpha" && /^\d+$/.test(v.prerelease[1])) return [0, v.minor];
  if (v.prerelease.length === 2 && v.prerelease[0] === "beta" && /^\d+$/.test(v.prerelease[1])) return [1, v.minor];
  if (v.prerelease.length === 0 && v.major >= 1) return [2, v.minor];
  if (v.major === 0 && v.minor === 0 && v.patch === 0 && v.prerelease.length === 0) return [-1, 0];
  return null; // a shape the plan does not set
}

/** The family the plan allows right now, like `0.1.0-alpha`. */
export function familyOf(state) {
  if (state.stage === "alpha") return `0.${state.completedCount}.0-alpha`;
  if (state.stage === "beta") return `0.${state.total}.0-beta`;
  return null;
}

/** The problems with a version under the current state of the plan. Empty means the plan allows it. */
export function versionProblems(version, state) {
  const v = parseVersion(version);
  if (!v) return [`"${version}" is not a version (major.minor.patch, with -alpha.N or -beta.N while pre-v1).`];
  const problems = [];
  const build = (pre) => (v.prerelease.length === 2 && v.prerelease[0] === pre && /^\d+$/.test(v.prerelease[1]) ? Number(v.prerelease[1]) : null);

  if (state.stage === "alpha") {
    const n = build("alpha");
    if (n === null) problems.push(`Holt is alpha (${state.completedCount} of ${state.total} milestones complete), so the version must be 0.${state.completedCount}.0-alpha.N.`);
    else if (v.major !== 0 || v.minor !== state.completedCount || v.patch !== 0) problems.push(`the minor is the number of complete milestones (${state.completedCount}), so the version must be 0.${state.completedCount}.0-alpha.N`);
    else if (n < 1) problems.push(`N counts builds, so it starts at 1`);
  } else if (state.stage === "beta") {
    const n = build("beta");
    if (n === null) problems.push(`every milestone is complete and Holt is beta, so the version must be 0.${state.total}.0-beta.N (until Stephen declares v1).`);
    else if (v.major !== 0 || v.minor !== state.total || v.patch !== 0) problems.push(`the version must be 0.${state.total}.0-beta.N while beta`);
    else if (n < 1) problems.push(`N counts builds, so it starts at 1`);
  } else {
    if (v.prerelease.length > 0 || v.major < 1) problems.push(`Stephen has declared v1, so the version is 1.0.0 or later, with no prerelease tag.`);
  }
  return problems;
}

/** The next version the plan allows from the current one, or the reason it does not. */
export function nextVersion(current, state) {
  const here = position(current);
  if (state.stage === "v1") {
    if (here?.[0] === -1 || (here?.[0] === 1 && here[1] === state.total)) return { version: "1.0.0" };
    if (here?.[0] === 2) return { error: "Holt is past 1.0.0. Later releases are ordinary semver, and you choose them by hand." };
    return { error: `Stephen has declared v1, but the version is ${current}. Set 1.0.0 by hand, or correct the version first.` };
  }
  const family = familyOf(state);
  const want = state.stage === "alpha" ? [0, state.completedCount] : [1, state.total];
  if (here === null) {
    if (current === "0.0.0") return { version: `${family}.1` }; // the first version, set by the bump
    return { error: `"${current}" is not a version the plan sets, so it does not say what comes next. Choose the next one by hand.` };
  }
  if (here[0] === want[0] && here[1] === want[1]) {
    const n = parseVersion(current).prerelease[1];
    return { version: `${family}.${Number(n) + 1}` };
  }
  if (here[0] < want[0] || (here[0] === want[0] && here[1] < want[1])) return { version: `${family}.1` };
  return { error: `the plan has moved back (it now allows ${family}.N), but the version is ${current}. A version is never lowered: re-check BACKLOG.md, or choose the version by hand.` };
}
