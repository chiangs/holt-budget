// The household's real transactions for the eval scripts, with the family's jobs where Holt can know them:
// a row's own label, or else "same as last time" (Milestone 3): the job the family gave the same payee,
// when every labelled row for that payee agrees. Nothing here guesses a job.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { QueryableTransaction } from "@holt/core";
import { readCsv, recogniseFormat } from "@holt/importers";

export const root = join(import.meta.dirname, "..", "..");
export const privateFolder = join(root, "private");

export interface HouseholdTransaction extends QueryableTransaction {
  /** How the job was found, when there is one. */
  readonly jobFrom?: "label" | "same payee";
}

/** Every label in private/labels/*.csv, by transaction id. Files ending in .before-*.csv are backups and ignored. */
export function readLabels(): Map<string, string> {
  const folder = join(privateFolder, "labels");
  const labels = new Map<string, string>();
  if (!existsSync(folder)) return labels;
  for (const name of readdirSync(folder).filter((f) => f.endsWith(".csv") && !f.includes(".before-"))) {
    const [header, ...records] = readCsv(readFileSync(join(folder, name), "utf8"), ";");
    const id = header?.fields.indexOf("id") ?? -1;
    const job = header?.fields.indexOf("job") ?? -1;
    for (const { fields } of records) {
      const value = fields[job]?.trim();
      if (value) labels.set(fields[id]!, value);
    }
  }
  return labels;
}

export function householdTransactions(): HouseholdTransaction[] {
  const fixtures = join(privateFolder, "fixtures");
  const rows = readdirSync(fixtures)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .flatMap((name) => {
      const text = readFileSync(join(fixtures, name), "utf8");
      return (recogniseFormat(text)?.parse(text).rows ?? []).map((r) => ({ ...r, id: `${name}:${r.line}` }));
    });
  const own = new Set<string>(rows.map((r) => r.account));
  const labels = readLabels();
  // Names for accounts whose exports don't name them (SpareBank 1), from the household's private config.
  const configFile = join(privateFolder, "review-config.json");
  const accountNames: Record<string, string> = existsSync(configFile)
    ? ((JSON.parse(readFileSync(configFile, "utf8")) as { accountNames?: Record<string, string> }).accountNames ?? {})
    : {};
  // Bulder gives a bill's payee as an account number and puts the payee's name in the description.
  const payee = (r: (typeof rows)[number]) => (r.counterpartName ?? r.description).trim();

  const jobsByPayee = new Map<string, Set<string>>();
  for (const r of rows) {
    const label = labels.get(r.id);
    if (label) jobsByPayee.set(payee(r), (jobsByPayee.get(payee(r)) ?? new Set()).add(label));
  }

  return rows.map((r): HouseholdTransaction => {
    const label = labels.get(r.id);
    const known = jobsByPayee.get(payee(r));
    const samePayee = known?.size === 1 ? [...known][0] : undefined;
    const job = label ?? samePayee;
    return {
      id: r.id,
      account: (r.accountName ?? accountNames[r.account] ?? r.account).trim(),
      bookingDate: r.bookingDate,
      amount: r.amount,
      counterparty: payee(r),
      ...(r.counterpartAccount ? { counterpartyAccount: r.counterpartAccount } : {}),
      description: r.description,
      transfer: r.counterpartAccount !== undefined && own.has(r.counterpartAccount),
      ...(r.original ? { originalCurrency: r.original.currency } : {}),
      ...(job ? { job, jobFrom: label ? "label" : "same payee" } : {}),
    };
  });
}
