/**
 * Why the app refused a command, in the glossary's words. The codes are the keys of one table, so a code
 * cannot exist without its message. The interface's message files key on the code; these are the English
 * source. Each message names who acts: you, or the app.
 */

import type { FactsEditor, Patch } from "../patch.ts";
import type { Violation } from "./check-facts.ts";
import { importMessages } from "./imports.messages.ts";
import { ruleMessages } from "./rules.messages.ts";

const baseMessages = {
  idTaken: "The app can't add this, because something with the same ID already exists.",
  accountNumberTaken: "The app can't give two accounts the same account number.",
  splitDoesNotAddUp: "You need the allocations to add up to the whole amount of the transaction.",
  nameMissing: "You need to give it a name.",
  negativeAmount: "You can't use a negative amount here.",
  amountNotPositive: "You need an amount above zero.",
  accountNotFound: "The app can't find that account.",
  groupNotFound: "The app can't find that group.",
  jobNotFound: "The app can't find that job.",
  moveNotFound: "The app can't find that move at the bank.",
  transactionNotFound: "The app can't find that transaction.",
  currencyFixed:
    "You can't change the currency once the app holds a transaction or a figure you entered. To use another currency, export what you want to keep, delete everything in Settings and set up again.",
  planStartFixed: "You can't change the plan start once you've opened a month or the app holds a transaction.",
  jobKindFixed: "You can't change what kind of job this is. You can add a new job instead.",
  bufferStaysActive: "You can't pause, finish or archive the buffer. You can set its target to zero months instead.",
  bufferCannotBeDeleted: "You can't delete the buffer. You can set its target to zero months instead.",
  bucketHoldsMoney: "You can't delete a job while its bucket holds money. Move the money to another job first.",
  jobInUse: "You can't delete a job that has assignments or transactions. You can archive it instead.",
  monthNotNext: "You can only open the next month of the plan.",
  monthNotOpen: "You can only change a month while it's open or reopened.",
  monthNotClosed: "You can only reopen a month you've closed.",
  sameJob: "You can't move money from a job to itself.",
  moveExceedsAssignment: "You can't move more than the job has assigned in the month.",
  sameAccount: "You need two different accounts for a move at the bank.",
  moveNotToDo: "You can only mark a move at the bank as done or skipped while it's still to do.",
  historyFromPlanStart: "The app treats only transactions from before the plan start as history.",
  notHistoryBeforePlanStart: "The app treats every transaction from before the plan start as history, except income that funds a month from the plan start on.",
  breaksFacts: "The app can't make this change, because it would leave your data inconsistent.",
  proposalNotSuggested: "You can only decide on a suggestion that's still waiting for you.",
  proposalNotAccepted: "The app applies a suggestion only once you accept it.",
  proposalStale: "Your data changed after the app worked out this suggestion, so the app won't apply it. The app will work it out again.",
} as const satisfies Record<string, string>;

/** Imports and rules keep their own messages in their own files, so they can grow without touching this one. */
const messages = { ...baseMessages, ...importMessages, ...ruleMessages } as const satisfies Record<string, string>;

export type RefusalCode = keyof typeof messages;

export const refusalCodes = Object.keys(messages) as readonly RefusalCode[];

export type Refusal =
  | { readonly code: Exclude<RefusalCode, "breaksFacts">; readonly message: string }
  /** The command would add these violations to facts that didn't have them (see `checkFacts`). */
  | { readonly code: "breaksFacts"; readonly message: string; readonly violations: readonly [Violation, ...Violation[]] };

export function refusal(code: Exclude<RefusalCode, "breaksFacts">): Refusal {
  return { code, message: messages[code] };
}

export function breaksFacts(violations: readonly [Violation, ...Violation[]]): Refusal {
  return { code: "breaksFacts", message: messages.breaksFacts, violations };
}

export function messageFor(code: RefusalCode): string {
  return messages[code];
}

/** What one command does to the facts: the rows it changes, or why the app refused it. */
export type Outcome = { readonly ok: true; readonly patch: Patch } | { readonly ok: false; readonly refusal: Refusal };

export function refuse(code: Exclude<RefusalCode, "breaksFacts">): Outcome {
  return { ok: false, refusal: refusal(code) };
}

export function patched(editor: FactsEditor): Outcome {
  return { ok: true, patch: editor.patch() };
}
