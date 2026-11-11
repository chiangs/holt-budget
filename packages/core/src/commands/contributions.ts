/**
 * Contribution agreements (domain model, "Contribution agreement"; decision 0048). An adult pays a fixed
 * amount into a shared account on a usual day. A change of amount can be a new agreement from a later month,
 * which keeps the history, or a change here when the family is correcting the agreement itself. An agreement
 * ends by setting its last month, and is never deleted.
 */

import type { Month } from "../dates.ts";
import type { ContributionAgreement, Facts } from "../facts.ts";
import type { AccountId, AgreementId } from "../ids.ts";
import type { Money } from "../money.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import type { Fault } from "./check-facts.ts";
import { patched, refuse } from "./refusal.ts";

export interface AgreementChanges {
  readonly amount?: Money;
  readonly day?: number;
  readonly accountId?: AccountId;
  /** The last month it funds. null removes the end. */
  readonly to?: Month | null;
}

export type ContributionCommand =
  | { readonly kind: "addAgreement"; readonly agreement: ContributionAgreement }
  | { readonly kind: "changeAgreement"; readonly agreementId: AgreementId; readonly changes: AgreementChanges };

const lastDay = 28;

/** Everything wrong with an agreement, the first being the one the family hears about. `checkFacts` flags the same list. */
export function agreementFaults(facts: Facts, agreement: ContributionAgreement): Fault[] {
  const faults: Fault[] = [];
  const person = facts.people.get(agreement.personId);
  if (person === undefined) faults.push({ violation: "missingReference", refusal: "personNotFound", field: "personId" });
  else if (person.kind !== "adult") faults.push({ violation: "agreementPersonNotAdult", refusal: "personNotAdult", field: "personId" });
  const account = facts.accounts.get(agreement.accountId);
  if (account === undefined) faults.push({ violation: "missingReference", refusal: "accountNotFound", field: "accountId" });
  else if (account.scope !== "shared") faults.push({ violation: "agreementAccountNotShared", refusal: "accountNotShared", field: "accountId" });
  if (agreement.amount <= 0) faults.push({ violation: "agreementAmountNotPositive", refusal: "amountNotPositive", field: "amount" });
  if (!Number.isInteger(agreement.day) || agreement.day < 1 || agreement.day > lastDay) faults.push({ violation: "agreementDayOutOfRange", refusal: "dayOutOfRange", field: "day" });
  if (agreement.to !== undefined && agreement.to < agreement.from) faults.push({ violation: "agreementEndsBeforeStart", refusal: "agreementEndsBeforeStart", field: "to" });
  return faults;
}

function put(facts: Facts, agreement: ContributionAgreement) {
  const [fault] = agreementFaults(facts, agreement);
  return fault === undefined ? patched(editFacts(facts).put("contributionAgreements", agreement)) : refuse(fault.refusal);
}

export const contributionHandlers: Handlers<ContributionCommand> = {
  addAgreement(facts, { agreement }) {
    return facts.contributionAgreements.has(agreement.id) ? refuse("idTaken") : put(facts, agreement);
  },

  changeAgreement(facts, { agreementId, changes }) {
    const agreement = facts.contributionAgreements.get(agreementId);
    if (agreement === undefined) return refuse("agreementNotFound");
    const { to: _old, ...rest } = agreement;
    const to = changes.to === undefined ? agreement.to : (changes.to ?? undefined);
    return put(facts, {
      ...rest,
      amount: changes.amount ?? agreement.amount,
      day: changes.day ?? agreement.day,
      accountId: changes.accountId ?? agreement.accountId,
      ...(to === undefined ? {} : { to }),
    });
  },
};
