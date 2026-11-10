// Writes synthetic bank exports in each bank's exact format to fixtures/synthetic/.
// Every name, account number and amount is invented; nothing here comes from a real export.
// Run: pnpm --filter @holt/importers synthetic
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syntheticFixtureOptions, syntheticOfx, syntheticStatements } from "../src/synthetic.ts";

const out = join(import.meta.dirname, "..", "fixtures", "synthetic");
const files = [...syntheticStatements(syntheticFixtureOptions).files, ...syntheticOfx(syntheticFixtureOptions)];

mkdirSync(out, { recursive: true });
for (const file of files) writeFileSync(join(out, file.name), file.text);
console.log(`Wrote ${files.length} synthetic files to ${out}`);
