/**
 * Accounts and groups. An account's opening balance and date come from Setup and no command changes them,
 * because changing either would adjust the balance the app checks against the bank (rule 5).
 */

import type { Account, AccountKind, Group } from "../facts.ts";
import type { AccountId, GroupId } from "../ids.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { patched, refuse } from "./refusal.ts";

export interface AccountChanges {
  readonly name?: string;
  readonly kind?: AccountKind;
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

export const accountAndGroupHandlers: Handlers<AccountAndGroupCommand> = {
  addAccount(facts, { account }) {
    if (facts.accounts.has(account.id)) return refuse("idTaken");
    if (account.name.trim() === "") return refuse("nameMissing");
    return patched(editFacts(facts).put("accounts", account));
  },

  changeAccount(facts, { accountId, changes }) {
    const account = facts.accounts.get(accountId);
    if (account === undefined) return refuse("accountNotFound");
    if (changes.name?.trim() === "") return refuse("nameMissing");
    return patched(editFacts(facts).put("accounts", { ...account, ...changes }));
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
