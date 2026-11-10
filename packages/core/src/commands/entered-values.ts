/**
 * Entered values (domain model, "Entered value"; rule 10). A change adds a row and never replaces one, so
 * every past value is kept. No command edits or deletes an entered value; only undo removes the row it added.
 */

import type { EnteredValue } from "../facts.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { patched, refuse } from "./refusal.ts";

export type EnteredValueCommand = { readonly kind: "enterValue"; readonly value: EnteredValue };

export const enteredValueHandlers: Handlers<EnteredValueCommand> = {
  enterValue(facts, { value }) {
    if (facts.enteredValues.has(value.id)) return refuse("idTaken");
    return patched(editFacts(facts).put("enteredValues", value));
  },
};
