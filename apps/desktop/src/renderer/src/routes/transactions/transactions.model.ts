/**
 * What the Transactions header and tab bar show: which tab is open, the badge on the sidebar, and how up to
 * date each account is. The states and dates come from core's `importStatus` figure. This only adds the bank's
 * name from the account's last import and the days since it.
 */

import type { AccountId, Facts, Figures, ImportRhythm, ImportState, ImportStatusFigures, LocalDate } from "@holt/core";
import { daysBetween } from "../../i18n/dates.ts";
import { localDateOf } from "../../data/replica.ts";

export type TabId = "needsYou" | "all" | "imports";

/** The tab's value in the address, so the back button and a reload keep it. */
const params: Readonly<Record<TabId, string>> = { needsYou: "needs-you", all: "all", imports: "imports" };

export const tabIds: readonly TabId[] = ["needsYou", "all", "imports"];

export const paramOf = (tab: TabId): string => params[tab];

export function tabFromParam(value: string | null): TabId | null {
  return tabIds.find((tab) => params[tab] === value) ?? null;
}

/** The tab in the address, or when there is none, Needs you if anything waits and All if not. */
export function activeTab(param: string | null, waiting: number): TabId {
  return tabFromParam(param) ?? (waiting > 0 ? "needsYou" : "all");
}

export interface TabCounts {
  readonly needsYou: number;
  readonly all: number;
  /** Imports that are still in force. An undone import stays in the history but no longer counts. */
  readonly imports: number;
}

export function tabCounts(facts: Facts, figures: Pick<Figures, "needsYou">): TabCounts {
  return {
    needsYou: figures.needsYou.length,
    all: facts.transactions.size,
    imports: [...facts.importBatches.values()].filter((batch) => !batch.undone).length,
  };
}

export type SidebarBadge = { readonly kind: "due" } | { readonly kind: "needsYou"; readonly count: number };

/** "Due" when any account is due for an import, otherwise how many transactions wait, otherwise nothing. */
export function sidebarBadge(figures: Pick<Figures, "importStatus" | "needsYou">): SidebarBadge | null {
  if (figures.importStatus.due > 0) return { kind: "due" };
  return figures.needsYou.length > 0 ? { kind: "needsYou", count: figures.needsYou.length } : null;
}

export type BankKey = "bulder" | "sparebank1" | "generic";

/** The bank behind a format profile. A format the app has no name for gets the generic one. */
export function bankOfFormat(format: string): BankKey {
  switch (format) {
    case "bulder-csv":
      return "bulder";
    case "sparebank1-csv":
      return "sparebank1";
    default:
      return "generic";
  }
}

export interface AccountChip {
  readonly accountId: AccountId;
  readonly name: string;
  readonly state: ImportState;
  /** From the format of the account's last import still in force, or null when it has none. */
  readonly bank: BankKey | null;
  readonly rhythm: ImportRhythm;
  readonly coversTo: LocalDate | null;
  /** Whole days from the last import to today, 0 for today, or null when the account has no import. */
  readonly daysSinceImport: number | null;
  /** The date of the latest balance the family typed from their bank, or null when the account was never checked. */
  readonly checkedOn: LocalDate | null;
}

/** One chip for each account that is imported, in the order the facts hold the accounts. */
export function accountChips(facts: Facts, status: ImportStatusFigures, today: LocalDate): AccountChip[] {
  return [...facts.accounts.values()].flatMap((account) => {
    const figure = status.accounts.get(account.id);
    if (figure === undefined) return [];
    const last = figure.lastImport;
    const format = last === null ? undefined : facts.importBatches.get(last.batchId)?.format;
    return {
      accountId: account.id,
      name: account.name,
      state: figure.state,
      bank: format === undefined ? null : bankOfFormat(format),
      rhythm: account.importRhythm ?? "monthly",
      coversTo: figure.coversTo,
      daysSinceImport: last === null ? null : Math.max(0, daysBetween(localDateOf(new Date(last.importedAt)), today)),
      checkedOn: figure.checkedOn,
    };
  });
}
