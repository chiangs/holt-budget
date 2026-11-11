// Set the next version from the plan, not by choice. It works the stage and
// the milestone count out of BACKLOG.md, updates apps/desktop/package.json,
// and prints the tag for the commit. It never lowers a version. `pnpm version:bump`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nextVersion, readBacklog, stateFromBacklog } from "./version-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const state = stateFromBacklog(readBacklog(root));
const file = join(root, "apps/desktop/package.json");
const text = readFileSync(file, "utf8");
const current = JSON.parse(text).version;

const next = nextVersion(current, state);
if (next.error) {
  console.error(next.error);
  process.exit(1);
}

const updated = text.replace(/("version":\s*)"[^"]*"/, `$1"${next.version}"`);
if (updated === text) {
  console.error(`could not find the version in ${file}`);
  process.exit(1);
}
writeFileSync(file, updated);

console.log(`Set ${next.version} in apps/desktop/package.json (plan: ${state.stage}, ${state.completedCount} of ${state.total} milestones complete).`);
console.log(`When the change is committed: git tag v${next.version}`);
