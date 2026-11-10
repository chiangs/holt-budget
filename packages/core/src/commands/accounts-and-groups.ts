/**
 * Accounts and groups. An account's opening balance and date come from Setup and no command changes them,
 * because changing either would adjust the balance the app checks against the bank (rule 5).
 */

import type { AccountNumber } from "../account-number.ts";
import type { Account, AccountKind, Facts, Group, ImportRhythm } from "../facts.ts";
import type { AccountId, GroupId } from "../ids.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { patched, refuse } from "./refusal.ts";

export interface AccountChanges {
  readonly name?: string;
  readonly kind?: AccountKind;
  /** null clears the number. */
  readonly number?: AccountNumber | null;
  readonly importRhythm?: ImportRhythm;
}

export interface GroupChanges {
  readonly name?: string;
  readonly order?: number;
  readonly countsTowardsSavingsRate?: boolean;
}

export type AccountAndGroupCommand =
  | { readonly kind: "addAccount"; readonly account: Account }
  | { readonly kind: "changeAccount"; readonly accountId: AccountId; readonly changes: AccountChanges }
  | { readonly kind: "addGroup"; readonly group: Group }
  | { readonly kind: "changeGroup"; readonly groupId: GroupId; readonly changes: GroupChanges };

function numberTaken(facts: Facts, number: AccountNumber | undefined, except: AccountId): boolean {
  if (number === undefined) return false;
  for (const other of facts.accounts.values()) if (other.id !== except && other.number === number) return true;
  return false;
}

export const accountAndGroupHandlers: Handlers<AccountAndGroupCommand> = {
  addAccount(facts, { account }) {
    if (facts.accounts.has(account.id)) return refuse("idTaken");
    if (account.name.trim() === "") return refuse("nameMissing");
    if (numberTaken(facts, account.number, account.id)) return refuse("accountNumberTaken");
    return patched(editFacts(facts).put("accounts", account));
  },

  changeAccount(facts, { accountId, changes }) {
    const account = facts.accounts.get(accountId);
    if (account === undefined) return refuse("accountNotFound");
    if (changes.name?.trim() === "") return refuse("nameMissing");
    const { number, ...rest } = changes;
    if (number !== undefined && numberTaken(facts, number ?? undefined, accountId)) return refuse("accountNumberTaken");
    const { number: _old, ...withoutNumber } = account;
    const kept = number === undefined ? account.number : (number ?? undefined);
    return patched(editFacts(facts).put("accounts", { ...withoutNumber, ...rest, ...(kept === undefined ? {} : { number: kept }) }));
  },

  addGroup(facts, { group }) {
    if (facts.groups.has(group.id)) return refuse("idTaken");
    if (group.name.trim() === "") return refuse("nameMissing");
    return patched(editFacts(facts).put("groups", group));
  },

  changeGroup(facts, { groupId, changes }) {
    const group = facts.groups.get(groupId);
    if (group === undefined) return refuse("groupNotFound");
    if (changes.name?.trim() === "") return refuse("nameMissing");
    return patched(editFacts(facts).put("groups", { ...group, ...changes }));
  },
};
