/**
 * The household's own settings. The currency is fixed once a transaction or entered value exists, and the
 * plan start once a month is opened or a transaction exists (decisions 10 and 15).
 */

import type { Month } from "../dates.ts";
import { householdOf } from "../facts.ts";
import type { Currency, Money } from "../money.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { patched, refuse } from "./refusal.ts";

export interface HouseholdChanges {
  readonly name?: string;
  readonly currency?: Currency;
  readonly planStart?: Month;
  readonly evenOutStep?: Money;
}

export type HouseholdCommand = { readonly kind: "changeHousehold"; readonly changes: HouseholdChanges };

export const householdHandlers: Handlers<HouseholdCommand> = {
  changeHousehold(facts, { changes }) {
    const household = householdOf(facts);
    if (changes.name?.trim() === "") return refuse("nameMissing");
    if (changes.evenOutStep !== undefined && changes.evenOutStep <= 0) return refuse("amountNotPositive");
    const currencyChanges = changes.currency !== undefined && changes.currency !== household.currency;
    if (currencyChanges && (facts.transactions.size > 0 || facts.enteredValues.size > 0)) return refuse("currencyFixed");
    const planStartChanges = changes.planStart !== undefined && changes.planStart !== household.planStart;
    if (planStartChanges && (facts.budgetMonths.size > 0 || facts.transactions.size > 0)) return refuse("planStartFixed");
    return patched(editFacts(facts).put("household", { ...household, ...changes }));
  },
};
