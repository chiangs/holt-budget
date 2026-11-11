import { type AccountNumber, accountNumber } from "@holt/core";

export interface SyntheticAccount {
  /** The name the bank gives the account, as the synthetic household's accounts are named. */
  readonly name: string;
  readonly number: AccountNumber;
}

const account = (name: string, number: string): SyntheticAccount => ({ name, number: accountNumber(number) });

/**
 * The invented household behind every synthetic file. Core's test builders, the development seed and the importer
 * tests all take their account numbers from here. Every number and name is made up.
 */
export const syntheticAccounts = {
  bulder: {
    everyday: account("BRUKSKONTO", "97101110001"),
    bills: account("Regninger", "97101110002"),
    food: account("Mat", "97101110003"),
    holiday: account("Ferie", "97101110004"),
  },
  sparebank1: {
    loanPayments: account("Lånebetaling", "97200020001"),
    deposit: account("Depositum", "97200020002"),
    /** SpareBank 1 doesn't export loans (decision 0043), so no file carries rows for this one. */
    houseLoan: account("Boliglån", "97200020003"),
  },
  /** The account in the synthetic OFX files. The household's real banks don't offer OFX. */
  ofx: account("Eksempelkonto", "97600060001"),
  /** The children's savings accounts at Bulder. The household pays into them and doesn't export them, so no file carries rows for them. */
  children: {
    eldest: account("Eldest's savings", "97101110011"),
    second: account("Second's savings", "97101110012"),
    third: account("Third's savings", "97101110013"),
    youngest: account("Youngest's savings", "97101110014"),
  },
  /** Accounts outside the household: an employer, two billers and a housing co-operative. */
  outside: {
    employer: account("Eksempel AS", "97300030001"),
    energy: account("Fjordstrøm Energi", "97404040001"),
    broadband: account("Nettbredd Bredbånd", "97404040002"),
    housing: account("Eksempel Borettslag", "97505050001"),
  },
} as const;

/** How Bulder writes an account number: "9710.11.10001". SpareBank 1 writes the bare 11 digits. */
export function dotted(number: AccountNumber): string {
  return `${number.slice(0, 4)}.${number.slice(4, 6)}.${number.slice(6)}`;
}
