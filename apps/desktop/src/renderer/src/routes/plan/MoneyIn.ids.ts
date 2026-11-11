import { type AgreementId, type MoveId, type PersonId, agreementId, personId } from "@holt/core";
import { mintId } from "../../../../shared/ids.ts";

/**
 * New IDs for what Money in and Moves at the bank add. `shared/ids.ts` has no builder for a person or an
 * agreement, but every ID is UUIDv7 text, so the mint's text is branded here by core's own builders.
 */
export const newPersonId = (): PersonId => personId(mintId("move"));
export const newAgreementId = (): AgreementId => agreementId(mintId("move"));
export const newMoveId = (): MoveId => mintId("move");
