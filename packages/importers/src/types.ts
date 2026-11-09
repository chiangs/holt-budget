import type { Currency, Money } from "@holt/core";

/** A Norwegian account number as 11 digits, whatever dots or spaces the bank wrote. */
export type AccountNumber = string & { readonly __brand: "AccountNumber" };

/** A calendar date as "yyyy-mm-dd". Core's LocalDate replaces this in Milestone 2. */
export type IsoDate = string & { readonly __brand: "IsoDate" };

export interface ParsedRow {
  /** The 1-based line in the file, so every imported row can be traced back to it. */
  readonly line: number;
  /** The household's own account that this row belongs to. */
  readonly account: AccountNumber;
  /** The bank's name for that account, when the file gives one. */
  readonly accountName?: string;
  /** Decides which month the row counts in (domain model, Transaction). */
  readonly bookingDate: IsoDate;
  /** The date interest is calculated from, when the bank gives one. */
  readonly interestDate?: IsoDate;
  readonly description: string;
  /** In the account's currency. Negative means money out of `account`. */
  readonly amount: Money;
  /** The other account, when the bank gives its number. */
  readonly counterpartAccount?: AccountNumber;
  /** The other party's name, when the bank gives a name where the number would be (Bulder does for card payments). */
  readonly counterpartName?: string;
  /** The payment reference (KID). */
  readonly reference?: string;
  /** The bank's own word for the kind of row, such as "Overføring" or "Avtalegiro". */
  readonly bankType?: string;
  /** What a purchase cost in a foreign currency, as the bank wrote it. For information only: `amount` is what left the account. */
  readonly original?: { readonly text: string; readonly currency: string };
}

export interface ParsedFile {
  readonly format: BankFormatId;
  readonly rows: readonly ParsedRow[];
  /**
   * The accounts' currency: what the file states, or else the only currency the bank offers.
   * The import refuses the file when this isn't the household's currency (decision 15).
   */
  readonly accountCurrency: Currency;
  /** The closing balance the file states, per account, if it states one. Neither Bulder nor SR-Bank does (spike S4). */
  readonly closingBalances: ReadonlyMap<AccountNumber, Money>;
}

export type BankFormatId = "bulder-csv" | "sparebank1-csv";

export interface BankFormat {
  readonly id: BankFormatId;
  readonly bank: string;
  /** True when the file's first line is this format's header. */
  readonly recognises: (firstLine: string) => boolean;
  readonly parse: (text: string) => ParsedFile;
}

export class ImportError extends Error {
  override name = "ImportError";
  readonly line: number | undefined;
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.line = line;
  }
}
