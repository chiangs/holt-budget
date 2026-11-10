import type { AccountNumber, LocalDate, Money, StatementFile } from "@holt/core";

/** A closing balance a file states, as at a date. */
export interface StatedBalance {
  readonly account: AccountNumber;
  readonly date: LocalDate;
  readonly balance: Money;
}

/** What a format reads from a file: core's `StatementFile`, plus any closing balances the file states. */
export interface ParsedStatement extends StatementFile {
  /** Empty for Bulder and SpareBank 1, which state none (spike S4). OFX states one per statement. */
  readonly closingBalances: readonly StatedBalance[];
}

export type BankFormatId = "bulder-csv" | "sparebank1-csv" | "ofx";

export interface BankFormat {
  readonly id: BankFormatId;
  readonly bank: string;
  /** False until the format has read a real file from a bank's own export. Mirrors `unprovenFormats`, which the page reads. */
  readonly proven: boolean;
  /** True when the start of the file is this format's header. The text may start with a byte-order mark. */
  readonly recognises: (text: string) => boolean;
  readonly parse: (text: string) => ParsedStatement;
}

export class ImportError extends Error {
  override name = "ImportError";
  readonly line: number | undefined;
  constructor(message: string, line?: number) {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.line = line;
  }
}
