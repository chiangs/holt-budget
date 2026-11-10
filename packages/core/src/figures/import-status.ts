/**
 * Whether each account is up to date (domain model, "Account"; decision 0047). An account's data covers to
 * the latest booked row of a live import, and it is due once more than one import rhythm has passed since.
 * A rhythm is exactly 7 days, 14 days or one calendar month. A shared account is the only kind that is
 * imported, so paid-into accounts have no status and are never due.
 */

import { type LocalDate, addMonths, daysBetween, monthOf } from "../dates.ts";
import type { Facts, ImportRhythm } from "../facts.ts";
import type { AccountId, ImportBatchId } from "../ids.ts";

export type ImportState = "upToDate" | "due" | "notImported";

export interface LastImport {
  readonly batchId: ImportBatchId;
  /** ISO datetime, as stored on the batch. */
  readonly importedAt: string;
}

export interface ImportStatus {
  readonly accountId: AccountId;
  /** The latest live batch that holds a row for the account, or null when none does. */
  readonly lastImport: LastImport | null;
  /** The latest booking date among the account's rows in live batches, pending rows left out. Null until a booked row exists. */
  readonly coversTo: LocalDate | null;
  readonly state: ImportState;
  /** The date of the latest balance the family typed from their bank for this account (an entered value), or null when they never did. Null means the account has not been checked against the bank. */
  readonly checkedOn: LocalDate | null;
}

export interface ImportStatusFigures {
  readonly accounts: ReadonlyMap<AccountId, ImportStatus>;
  /** How many accounts are due, for the badge on Transactions. */
  readonly due: number;
}

function isDue(rhythm: ImportRhythm, coversTo: LocalDate, asOf: LocalDate): boolean {
  switch (rhythm) {
    case "weekly":
      return daysBetween(coversTo, asOf) > 7;
    case "fortnightly":
      return daysBetween(coversTo, asOf) > 14;
    case "monthly":
      // A day the next month lacks (31 January plus a month) sorts after its last real day and before the first of the month after, so it acts as the last day.
      return asOf > `${addMonths(monthOf(coversTo), 1)}-${coversTo.slice(8)}`;
  }
}

export function importStatuses(facts: Facts, asOf: LocalDate): ImportStatusFigures {
  const lastImport = new Map<AccountId, { readonly batchId: ImportBatchId; readonly importedAt: string }>();
  const coversTo = new Map<AccountId, LocalDate>();
  for (const row of facts.importRows.values()) {
    const batch = facts.importBatches.get(row.batchId);
    if (batch === undefined || batch.undone) continue;
    const seen = lastImport.get(row.accountId);
    if (seen === undefined || batch.importedAt > seen.importedAt || (batch.importedAt === seen.importedAt && batch.id > seen.batchId)) {
      lastImport.set(row.accountId, { batchId: batch.id, importedAt: batch.importedAt });
    }
    const covered = coversTo.get(row.accountId);
    if (!row.pending && (covered === undefined || row.bookingDate > covered)) coversTo.set(row.accountId, row.bookingDate);
  }

  const checkedOn = new Map<string, LocalDate>();
  for (const value of facts.enteredValues.values()) {
    if (value.kind !== "accountBalance") continue;
    const seen = checkedOn.get(value.subject);
    if (seen === undefined || value.asOf > seen) checkedOn.set(value.subject, value.asOf);
  }

  const accounts = new Map<AccountId, ImportStatus>();
  let due = 0;
  for (const account of facts.accounts.values()) {
    if (account.scope !== "shared") continue;
    const covers = coversTo.get(account.id) ?? null;
    const state: ImportState = covers === null ? "notImported" : isDue(account.importRhythm ?? "monthly", covers, asOf) ? "due" : "upToDate";
    if (state === "due") due += 1;
    accounts.set(account.id, { accountId: account.id, lastImport: lastImport.get(account.id) ?? null, coversTo: covers, state, checkedOn: checkedOn.get(account.id) ?? null });
  }
  return { accounts, due };
}
