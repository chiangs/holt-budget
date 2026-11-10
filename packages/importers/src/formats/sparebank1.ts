import { type AccountNumber, type StatementRow, currency } from "@holt/core";
import { cleanCounterparty } from "../counterparty.ts";
import { readCsv } from "../csv.ts";
import { accountNumber, amount, columnIndexes, counterpart, isoDate, optionalIsoDate, startOf } from "../fields.ts";
import { type BankFormat, ImportError } from "../types.ts";

const nok = currency("NOK");

const columns = ["Dato", "Beskrivelse", "Rentedato", "Inn", "Ut", "Til konto", "Fra konto"] as const;

/**
 * SpareBank 1's account overview export ("OversiktKonti"): one file per account, a byte-order mark, every field quoted,
 * semicolons, dd.mm.yyyy dates, decimal commas, and money in and out in separate columns ("Ut" is already negative).
 * It names neither the account nor its currency, and has no closing balance. The account is the one that money comes
 * into ("Til konto") on "Inn" rows and leaves ("Fra konto") on "Ut" rows, and it must be the same on every row.
 * SpareBank 1 offers its everyday and savings accounts in kroner. Loans can't be exported (spike S4).
 * The export has no column that marks a reserved (pending) row, and the family's real exports have none, so every row is booked.
 */
export const sparebank1: BankFormat = {
  id: "sparebank1-csv",
  bank: "SpareBank 1",
  recognises: (text) => (startOf(text).split(/\r?\n/, 1)[0] ?? "") === "Dato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;",
  parse(text) {
    const [header, ...records] = readCsv(text, ";");
    if (header === undefined) throw new ImportError("The file is empty.");
    const col = columnIndexes(header.fields, columns);
    const field = (fields: readonly string[], name: (typeof columns)[number]) => (fields[col[name]] ?? "").trim();

    let fileAccount: AccountNumber | undefined;
    const rows = records.map(({ line, fields }): StatementRow => {
      const moneyIn = field(fields, "Inn");
      const moneyOut = field(fields, "Ut");
      if ((moneyIn === "") === (moneyOut === "")) throw new ImportError("A row needs an amount in either Inn or Ut.", line);
      const value = moneyIn !== "" ? amount(moneyIn, nok, line) : amount(moneyOut, nok, line);
      if (moneyOut !== "" && value > 0) throw new ImportError(`"${moneyOut}" in Ut should be negative.`, line);
      const own = accountNumber(field(fields, moneyIn !== "" ? "Til konto" : "Fra konto"), line);
      if (fileAccount === undefined) fileAccount = own;
      else if (own !== fileAccount) throw new ImportError(`This row belongs to ${own}, but the file is for ${fileAccount}.`, line);
      const interestDate = optionalIsoDate(field(fields, "Rentedato"), line);
      const description = field(fields, "Beskrivelse");
      const party = counterpart(field(fields, moneyIn !== "" ? "Fra konto" : "Til konto"));
      const counterparty = cleanCounterparty({ description, counterpartName: "counterpartName" in party ? party.counterpartName : undefined });
      return {
        line,
        account: own,
        bookingDate: isoDate(field(fields, "Dato"), line),
        ...(interestDate ? { interestDate } : {}),
        description,
        ...(counterparty ? { counterparty } : {}),
        amount: value,
        ...party,
        pending: false,
      };
    });
    return { format: "sparebank1-csv", rows, accountCurrency: nok, closingBalances: [] };
  },
};
