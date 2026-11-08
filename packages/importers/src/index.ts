/**
 * Bank statement importers. Each shared account remembers a format profile, so
 * the next file from the same account needs only a check (see the domain model).
 * Profiles for Bulder and SpareBank 1 SR-Bank are built in spike S4. Real exports
 * stay in private/fixtures/; the committed fixtures are synthetic.
 */
import type { Money } from "@holt/core";

export interface FormatProfile {
  readonly id: string;
  readonly bank: string;
  readonly fileType: "csv" | "ofx";
  /** Column names or indexes for each field (CSV only). */
  readonly columns?: {
    readonly bookingDate: string | number;
    readonly transactionDate?: string | number;
    readonly description: string | number;
    readonly amount?: string | number;
    readonly amountIn?: string | number;
    readonly amountOut?: string | number;
    readonly reference?: string | number;
  };
  readonly delimiter?: "," | ";" | "\t";
  readonly decimalSeparator: "," | ".";
  /** Date format as written in the file, for example "dd.MM.yyyy". */
  readonly dateFormat: string;
  /** Which sign means money out, when a single amount column is used. */
  readonly moneyOutSign: "negative" | "positive";
}

export interface ParsedRow {
  readonly bookingDate: string; // ISO date
  readonly transactionDate?: string;
  readonly description: string;
  readonly amount: Money;
  readonly reference?: string;
}
