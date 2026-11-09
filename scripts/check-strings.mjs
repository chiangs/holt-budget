// Fails if visible text is written directly in the renderer's JSX instead of coming from the
// message files (CLAUDE.md, writing conventions). Run with `pnpm lint:strings`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findHardcodedStrings } from "./lib/find-hardcoded-strings.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scope = "apps/desktop/src/renderer/src/";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.startsWith(scope) && /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));

const problems = files.flatMap((file) =>
  findHardcodedStrings(readFileSync(resolve(root, file), "utf8"), file).map((p) => `${file}:${p.line}: "${p.text}"`),
);

if (problems.length > 0) {
  console.error("Visible text written directly in JSX:\n");
  console.error(problems.join("\n"));
  console.error("\nPut the text in the en-GB message file and render it through the message layer.");
  process.exit(1);
}
console.log(`No hard-coded interface text (${files.length} files checked).`);
