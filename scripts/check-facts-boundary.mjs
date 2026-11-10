// Fails if code outside apps/desktop/src/main/facts/ imports anything in that folder except its index.ts. The
// folder owns the SQL names, the stored formats and the one writer of the family's facts, so everything else
// goes through the store. Run with `pnpm lint:facts`.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSource, walk } from "./lib/walk.mjs";

export const factsFolder = "apps/desktop/src/main/facts";

const codeFile = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function isPublic(resolved) {
  const target = resolved.replace(codeFile, "");
  return target === factsFolder || target === `${factsFolder}/index`;
}

/** Whether the specifier, written in `file`, reaches a private file of the folder. */
function reachesPrivate(specifier, file) {
  if (specifier.startsWith(".")) {
    const resolved = posix.normalize(posix.join(posix.dirname(file), specifier)).replace(/\/$/, "");
    return (resolved === factsFolder || resolved.startsWith(`${factsFolder}/`)) && !isPublic(resolved);
  }
  return /(^|\/)main\/facts\/(?!index(\.[a-z]+)?$)/.test(specifier);
}

/** Returns [{ line, message }] for each import in `source` (the text of `file`, a path from the repository root) that breaks the boundary. */
export function findFactsBoundaryViolations(source, file) {
  if (file.startsWith(`${factsFolder}/`)) return [];
  const problems = [];
  const check = (node, specifier) => {
    if (typeof specifier === "string" && reachesPrivate(specifier, file)) {
      problems.push({ line: node.loc.start.line, message: `imports "${specifier}", which is private to ${factsFolder}/` });
    }
  };
  walk(parseSource(source, file).program, (node) => {
    if ((node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && node.source) {
      check(node, node.source.value);
    } else if (node.type === "ImportExpression") {
      if (node.source.type === "StringLiteral") check(node, node.source.value);
    } else if (node.type === "CallExpression") {
      const [first] = node.arguments;
      const isRequire = node.callee.type === "Identifier" && node.callee.name === "require";
      if ((isRequire || node.callee.type === "Import") && first?.type === "StringLiteral") check(node, first.value);
    } else if (node.type === "TSImportType" && node.source?.type === "StringLiteral") {
      check(node, node.source.value);
    }
  });
  return problems;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.startsWith("apps/desktop/") && codeFile.test(f) && !f.includes("node_modules/") && existsSync(resolve(root, f)));
  const problems = files.flatMap((file) => findFactsBoundaryViolations(readFileSync(resolve(root, file), "utf8"), file).map((p) => `${file}:${p.line}: ${p.message}`));
  if (problems.length > 0) {
    console.error("Code outside the facts folder reaches into it:\n");
    console.error(problems.join("\n"));
    console.error(`\nImport from ${factsFolder}/index.ts. If the store lacks something, add it to the store's interface.`);
    process.exit(1);
  }
  console.log(`Nothing outside ${factsFolder}/ reaches past its index (${files.length} files checked).`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
