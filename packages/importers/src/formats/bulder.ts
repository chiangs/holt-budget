import { type StatementRow, currency } from "@holt/core";
import { cleanCounterparty } from "../counterparty.ts";
import { readCsv } from "../csv.ts";
import { accountNumber, amount, columnIndexes, counterpart, isoDate, startOf } from "../fields.ts";
import { type BankFormat, ImportError } from "../types.ts";

const nok = currency("NOK");

const columns = [
  "Dato",
  "Beløp",
  "Originalt Beløp",
  "Original Valuta",
  "Til konto",
  "Til kontonummer",
  "Fra konto",
  "Fra kontonummer",
  "Type",
  "Tekst",
  "KID",
] as const;

/**
 * Bulder's transaction export: one file for every account, semicolons, ISO dates, decimal commas, no closing balance.
 * Each row belongs to the account on its own side: "Fra" when money goes out, "Til" when it comes in.
 * A transfer between two of the household's Bulder accounts appears twice, once on each account.
 * Bulder offers accounts only in kroner, and "Beløp" is in kroner even for purchases abroad; "Originalt Beløp" and "Original Valuta" say what the purchase cost there.
 * The export has no column that marks a reserved (pending) row, and the family's real export has none, so every row is booked.
 */
export const bulder: BankFormat = {
  id: "bulder-csv",
  bank: "Bulder",
  recognises: (text) => startOf(text).startsWith("Dato;Beløp;Originalt Beløp;Original Valuta;Til konto;"),
  parse(text) {
    const [header, ...records] = readCsv(text, ";");
    if (header === undefined) throw new ImportError("The file is empty.");
    const col = columnIndexes(header.fields, columns);
    const field = (fields: readonly string[], name: (typeof columns)[number]) => (fields[col[name]] ?? "").trim();

    const rows = records.map(({ line, fields }): StatementRow => {
      const value = amount(field(fields, "Beløp"), nok, line);
      // A zero-kroner row (an e-invoice for nothing) has no sign, so the paying side is the household's when it's filled in.
      const out = value < 0 || (value === 0 && field(fields, "Fra kontonummer") !== "");
      const own = out ? "Fra" : "Til";
      const other = out ? "Til" : "Fra";
      const originalCurrency = field(fields, "Original Valuta");
      const accountName = field(fields, `${own} konto`);
      const reference = field(fields, "KID");
      const bankType = field(fields, "Type");
      const description = field(fields, "Tekst");
      const party = counterpart(field(fields, `${other} kontonummer`));
      const counterparty = cleanCounterparty({ description, counterpartName: "counterpartName" in party ? party.counterpartName : undefined });
      return {
        line,
        account: accountNumber(field(fields, `${own} kontonummer`), line),
        ...(accountName ? { accountName } : {}),
        bookingDate: isoDate(field(fields, "Dato"), line),
        description,
        ...(counterparty ? { counterparty } : {}),
        amount: value,
        ...party,
        ...(reference ? { reference } : {}),
        ...(bankType ? { bankType } : {}),
        ...(originalCurrency && originalCurrency !== nok
          ? { original: { text: field(fields, "Originalt Beløp"), currency: originalCurrency } }
          : {}),
        pending: false,
      };
    });
    return { format: "bulder-csv", rows, accountCurrency: nok, closingBalances: [] };
  },
};
