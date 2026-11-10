/** What the import screens' tests share: the real messages, and the core's invented household and bank files. Tests only. */
import { type Facts, type ImportPlan, type ImportPreview, type StatementFile, planImport } from "@holt/core";
import { createIntl } from "react-intl";
import type { ImportEntry } from "../../../../shared/import-types.ts";
import { locale, messages } from "../../i18n/messages.ts";
import { type Words, say } from "./ImportSay.ts";

export { type RowSpec, commitPlan, importHousehold, importInput, numbers, statement, today } from "../../../../../../../packages/core/src/testing/synthetic-statement.ts";
import { importInput } from "../../../../../../../packages/core/src/testing/synthetic-statement.ts";

/** Throws on a message the files don't have and on any text that is not valid ICU, so a test fails instead of showing an ID. */
const intl = createIntl({
  locale,
  messages,
  onError: (error) => {
    throw error;
  },
});

export const english = (words: Words, currency = "NOK"): string => say(intl, currency, words);

export const noEntry: ImportEntry = { balances: [], choices: [], suggest: true };

/**
 * What the main process does for each preview and for Add: plan again on the facts as they are, with what the family entered.
 * Every plan makes its own IDs, so a plan with another `idStart` is the one that Add stores.
 */
export function replan(facts: Facts, file: StatementFile, entry: ImportEntry, fingerprint = "the-file", idStart = 500_000): ImportPlan {
  return planImport(facts, file, { ...importInput(fingerprint, idStart), balances: entry.balances, choices: entry.choices, suggest: entry.suggest });
}

export function previewOf(plan: ImportPlan): ImportPreview {
  if (!plan.ok) throw new Error(`Blocked: ${plan.blocked.kind}`);
  return plan.preview;
}
