// Fails if a colour literal appears outside the design tokens.
// Allowed: design/design-system/tokens.json and the CSS generated from it.
// Everything else must use var(--token), currentColor or inherit.
// Run with `pnpm lint:colours`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const allowedFiles = new Set([
  "design/design-system/tokens.json",
  "packages/ui/src/tokens.css",
  // The app icon (a copy of design/icon/holt-small.svg); the icon is the same in every theme.
  "apps/desktop/src/renderer/public/holt-small.svg",
]);
// Design reference material, not app code: the icon masters, mockups and component previews.
const allowedPrefixes = ["design/icon/", "design/mockups/", "design/design-system/components/", "docs/"];
const extensions = /\.(css|html|svg|ts|tsx|js|jsx|mjs|cjs)$/;

const named = "red|green|blue|black|white|gray|grey|orange|yellow|purple|pink|brown|teal|cyan|navy|maroon|olive|lime|aqua|silver|gold";
const patterns = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(\s*[\d.%-]/,
  // A named colour used as a value for a colour property (CSS or SVG attribute).
  new RegExp(`(?:color|background|fill|stroke|border[\\w-]*|outline[\\w-]*)\\s*[:=]\\s*["']?(?:${named})\\b`, "i"),
];

const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => extensions.test(f) && !allowedFiles.has(f) && !allowedPrefixes.some((p) => f.startsWith(p)));

const problems = [];
for (const file of files) {
  readFileSync(resolve(root, file), "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (patterns.some((p) => p.test(line))) problems.push(`${file}:${i + 1}: ${line.trim()}`);
    });
}

if (problems.length > 0) {
  console.error("Colour literals found outside the design tokens:\n");
  console.error(problems.join("\n"));
  console.error("\nUse var(--token), currentColor or inherit. Add a token in design/design-system/tokens.json if a role is missing.");
  process.exit(1);
}
console.log(`No colour literals outside the tokens (${files.length} files checked).`);
