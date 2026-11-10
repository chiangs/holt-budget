/**
 * A parsed bank file, as core needs it. The importers package reads a file into exactly this shape. Core
 * defines it, because core can't import the importers (the importers import core), and a bank file's
 * row is a domain fact: where it belongs, when it booked, what it moved.
 */

import type { AccountNumber } from "../account-number.ts";
import type { LocalDate } from "../dates.ts";
import type { Currency, Money } from "../money.ts";

export interface StatementRow {
  /** The 1-based line in the file, so every row can be traced back to it. */
  readonly line: number;
  /** The household's own account this row belongs to, by the bank's number. */
  readonly account: AccountNumber;
  readonly accountName?: string;
  readonly bookingDate: LocalDate;
  readonly interestDate?: LocalDate;
  readonly description: string;
  /** The other party's name, cleaned up by the importers (`cleanCounterparty`). */
  readonly counterparty?: string;
  /** Negative means money out of `account`. */
  readonly amount: Money;
  readonly counterpartAccount?: AccountNumber;
  readonly counterpartName?: string;
  readonly reference?: string;
  readonly bankType?: string;
  readonly original?: { readonly text: string; readonly currency: string };
  /** A pending ("reservert") row. It backs no transaction until a later file books it. */
  readonly pending: boolean;
}

export interface StatementFile {
  /** The format profile that read the file, such as "bulder-csv". */
  readonly format: string;
  /** What the file states, or else the only currency the bank offers. */
  readonly accountCurrency: Currency;
  readonly rows: readonly StatementRow[];
  /** Closing balances the file states, per account. Neither Bulder nor SR-Bank states one (0043); OFX does. */
  readonly closingBalances?: readonly { readonly account: AccountNumber; readonly date: LocalDate; readonly balance: Money }[];
}
