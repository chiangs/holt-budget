/**
 * People (domain model, "Person"). A person's kind never changes, and nobody is deleted while a contribution
 * agreement names them: the family ends the agreement instead, which keeps the history.
 */

import type { Month } from "../dates.ts";
import type { Person } from "../facts.ts";
import type { PersonId } from "../ids.ts";
import { editFacts } from "../patch.ts";
import type { Handlers } from "./apply.ts";
import { patched, refuse } from "./refusal.ts";

export interface PersonChanges {
  readonly name?: string;
  /** null removes the birth month. */
  readonly birthMonth?: Month | null;
}

export type PersonCommand =
  | { readonly kind: "addPerson"; readonly person: Person }
  | { readonly kind: "changePerson"; readonly personId: PersonId; readonly changes: PersonChanges }
  | { readonly kind: "deletePerson"; readonly personId: PersonId };

export const personHandlers: Handlers<PersonCommand> = {
  addPerson(facts, { person }) {
    if (facts.people.has(person.id)) return refuse("idTaken");
    if (person.name.trim() === "") return refuse("nameMissing");
    return patched(editFacts(facts).put("people", person));
  },

  changePerson(facts, { personId, changes }) {
    const person = facts.people.get(personId);
    if (person === undefined) return refuse("personNotFound");
    if (changes.name !== undefined && changes.name.trim() === "") return refuse("nameMissing");
    const { birthMonth: _old, ...rest } = person;
    const birthMonth = changes.birthMonth === undefined ? person.birthMonth : (changes.birthMonth ?? undefined);
    return patched(editFacts(facts).put("people", { ...rest, name: changes.name ?? person.name, ...(birthMonth === undefined ? {} : { birthMonth }) }));
  },

  deletePerson(facts, { personId }) {
    if (!facts.people.has(personId)) return refuse("personNotFound");
    for (const agreement of facts.contributionAgreements.values()) if (agreement.personId === personId) return refuse("personInUse");
    return patched(editFacts(facts).remove("people", personId));
  },
};
