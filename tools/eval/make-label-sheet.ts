// Spike S3: writes the sheet the family labels with jobs, from the real exports in private/fixtures/.
// Every row of October 2026 that isn't a move between the household's own accounts, plus a fixed sample of
// about ten such rows from each earlier month of 2026, to make about 200. The job column starts empty, so the
// labels are the family's own and nothing here guesses them.
// Run: node tools/eval/make-label-sheet.ts   (writes private/labels/s3-labels.csv)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ParsedRow, recogniseFormat } from "@holt/importers";

const root = join(import.meta.dirname, "..", "..");
const fixtures = join(root, "private", "fixtures");
const out = join(root, "private", "labels", "s3-labels.csv");
const target = 200;

if (!existsSync(fixtures)) {
  console.error("There are no exports in private/fixtures/.");
  process.exit(1);
}
if (existsSync(out)) {
  console.error(`${out} already exists. Move it first, so no labels are overwritten.`);
  process.exit(1);
}

const rows: (ParsedRow & { file: string })[] = [];
for (const name of readdirSync(fixtures).filter((f) => f.toLowerCase().endsWith(".csv"))) {
  const text = readFileSync(join(fixtures, name), "utf8");
  const format = recogniseFormat(text);
  if (format) for (const row of format.parse(text).rows) rows.push({ ...row, file: name });
}
const own = new Set<string>(rows.map((r) => r.account));
const accountNames = new Map(rows.filter((r) => r.accountName).map((r) => [r.account, r.accountName!.trim()]));
const needsJob = rows.filter((r) => !(r.counterpartAccount !== undefined && own.has(r.counterpartAccount)) && r.amount !== 0);

const october = needsJob.filter((r) => r.bookingDate.startsWith("2026-10"));
const earlier = needsJob.filter((r) => r.bookingDate >= "2026-01" && r.bookingDate < "2026-10");
// The same sample every run: every nth row of each month, spread through the month. October is always whole.
const perMonth = Math.floor((target - october.length) / 9);
const sample = Array.from({ length: 9 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`).flatMap((month) => {
  const inMonth = earlier.filter((r) => r.bookingDate.startsWith(month));
  const step = Math.max(1, Math.floor(inMonth.length / perMonth));
  return inMonth.filter((_, i) => i % step === 0).slice(0, perMonth);
});
const chosen = [...october, ...sample].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));

const kroner = (ore: number) => `${ore < 0 ? "-" : ""}${Math.floor(Math.abs(ore) / 100)},${String(Math.abs(ore) % 100).padStart(2, "0")}`;
const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
const header = ["id", "date", "account", "amount_kr", "counterparty", "description", "bank_type", "job", "note"];
const lines = chosen.map((r) =>
  [
    `${r.file}:${r.line}`,
    r.bookingDate,
    accountNames.get(r.account) ?? r.account,
    kroner(r.amount),
    r.counterpartName ?? r.counterpartAccount ?? "",
    r.description,
    r.bankType ?? "",
    "",
    "",
  ].map(cell).join(";"),
);
mkdirSync(join(root, "private", "labels"), { recursive: true });
// A byte-order mark and semicolons, so LibreOffice and Excel open it with Norwegian characters intact.
writeFileSync(out, "﻿" + header.join(";") + "\n" + lines.join("\n") + "\n");
console.log(`Wrote ${chosen.length} rows (${october.length} from October, ${chosen.length - october.length} from January to September) to ${out}`);
