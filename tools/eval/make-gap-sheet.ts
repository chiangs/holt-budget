// Spike S3: writes a labelling sheet with only the rows that still have no job in the given months: no label of
// their own, and no labelled payee to follow. Filling it in makes those months complete for per-job figures.
// Run: node tools/eval/make-gap-sheet.ts 2026-08 2026-09   (writes private/labels/gaps-2026-08-2026-09.csv)
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { householdTransactions, privateFolder } from "./household-data.ts";

const months = process.argv.slice(2);
if (months.length === 0 || months.some((m) => !/^\d{4}-\d{2}$/.test(m))) {
  console.error("Usage: make-gap-sheet.ts yyyy-mm [yyyy-mm…]");
  process.exit(1);
}
const out = join(privateFolder, "labels", `gaps-${months.join("-")}.csv`);
if (existsSync(out)) {
  console.error(`${out} already exists. Move it first, so no labels are overwritten.`);
  process.exit(1);
}

const gaps = householdTransactions().filter(
  (t) => months.some((m) => t.bookingDate.startsWith(m)) && !t.transfer && t.amount !== 0 && t.job === undefined,
);
const kroner = (ore: number) => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)},${String(Math.abs(ore) % 100).padStart(2, "0")}`;
const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
const header = ["id", "date", "account", "amount_kr", "counterparty", "description", "job", "note"];
const lines = gaps.map((t) =>
  [t.id, t.bookingDate, t.account, kroner(t.amount), t.counterparty, t.description, "", ""].map(cell).join(";"),
);
writeFileSync(out, "﻿" + header.join(";") + "\n" + lines.join("\n") + "\n");
console.log(`Wrote ${gaps.length} rows without a job to ${out}`);
