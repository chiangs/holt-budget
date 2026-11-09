// Fails if the main process or the preload can reach the network in any way except the one
// loopback-only function (technical-decisions.md §3). Run with `pnpm lint:network`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findNetworkUse } from "./lib/find-network-use.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scopes = ["apps/desktop/src/main/", "apps/desktop/src/preload/"];
const allowedFiles = new Set(["apps/desktop/src/main/network/loopback-fetch.ts"]);
const isTest = /\.test\.tsx?$/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f) && scopes.some((s) => f.startsWith(s)) && !allowedFiles.has(f) && !isTest.test(f));

const problems = files.flatMap((file) =>
  findNetworkUse(readFileSync(resolve(root, file), "utf8"), file).map((p) => `${file}:${p.line}: ${p.message}`),
);

if (problems.length > 0) {
  console.error("Network access outside the one loopback-only function:\n");
  console.error(problems.join("\n"));
  console.error("\nAll main-process HTTP goes through apps/desktop/src/main/network/loopback-fetch.ts.");
  process.exit(1);
}
console.log(`No network access outside the loopback-only function (${files.length} files checked).`);
