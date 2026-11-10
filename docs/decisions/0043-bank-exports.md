# 0043 Bank exports from Bulder and SpareBank 1 (spike S4)

Status: accepted.
Date: 2026-11-09

## Question
What do the first household's two banks export, and can Holt read it? Does each CSV carry a closing balance and state its currency? Does SpareBank 1 SR-Bank export the loan accounts, and does it split interest from principal?

## What Stephen exported
The real files stay in `private/fixtures/` and are never committed.
- **Bulder:** one CSV covering every Bulder account, from January 2024 to November 2026. That's 8,556 rows across 9 accounts.
- **SpareBank 1 SR-Bank:** one CSV per account, for a savings account (32 rows) and a rental deposit account (4 rows).
- **The house loan and the car loan:** no export is available, so Stephen took screenshots.

## Findings
- **Bulder exports every account in one file.** The columns are separated by semicolons and include `Dato;Beløp;Originalt Beløp;Original Valuta;Til konto;Til kontonummer;Fra konto;Fra kontonummer;Type;Tekst;KID;Hovedkategori;Underkategori`. Dates are ISO, decimals use commas, and there is no byte-order mark.
  - A row belongs to the account on its own side: "Fra" when money leaves and "Til" when it arrives. A zero-kroner e-invoice has no sign, so it belongs to the paying side.
  - A transfer between two of the household's Bulder accounts appears twice, once on each account.
  - For card payments, "Til kontonummer" holds the shop's name, not a number. That happens on 1,738 of the rows.
  - The file has 135 groups of identical rows. They are real repeats, mostly small automatic savings transfers made several times a day. Duplicate matching must count rows, as the domain model says, not drop identical ones.
  - `Beløp` is always in kroner. For 69 purchases abroad, `Originalt Beløp` and `Original Valuta` show what they cost in PLN, USD, EUR, ISK, DKK or GBP. That's the purchase currency, not the account currency, so these rows must not make Holt refuse the file (decision 15).
  - Bulder's own categories (`Hovedkategori`, `Underkategori`) are not Holt's jobs. Holt ignores them.
- **SpareBank 1 exports one file per account ("OversiktKonti").** The columns are `Dato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;`, with a byte-order mark, every field quoted, and a trailing semicolon. Dates are `dd.mm.yyyy`, and money in and out sit in separate columns, with "Ut" already negative.
  - The file names neither its account nor its currency. The account is the one money arrives in on "Inn" rows and leaves on "Ut" rows, and Holt checks it is the same on every row.
  - `Rentedato` (the interest date) is filled in on some rows only.
- **Neither bank gives a closing balance,** so the balance check uses the balance the family types at import (rule 5).
- **Neither bank states the account currency.** Both offer their everyday and savings accounts in kroner only. So each format reports NOK, and the import refuses the file when the household's currency is anything else.
- **Account numbers match across banks once normalised.** Bulder writes `1234.56.78901` and SpareBank 1 writes `12345678901`. Holt stores 11 digits, so a transfer from Bulder to SR-Bank can be matched by account number.
- **SpareBank 1 doesn't export loans.** Its online bank shows each loan's balance, rate and next payment. The loan history lists interest ("ORD.RTE ETTERSKUDD") and the fee ("TERMINOMK.") as separate rows next to each payment, so principal is the payment minus both. Holt can't import that history. Loan balances are entered by hand with a date, as the domain model already allowed.
- **The family's loan payments run through an SR-Bank account.** Money moves from Bulder to an SR-Bank account, then on to the house loan. That account's export shows both moves.

## What was built
- `packages/importers` has one format per bank, as code (§13). The two are `bulder-csv` and `sparebank1-csv`, both recognised by their header line. Both read into one row shape:
  - the account, the booking date and the interest date;
  - the description and the amount as `Money` in øre;
  - the counterpart's account or name, the KID and the bank's type;
  - the original foreign amount, and the line number.
  - a cleaned counterparty name (`cleanCounterparty`) and a `pending` flag. Neither bank marks pending rows, and none of the three real files contains one, so the flag is always false for them (Milestone 3).
- `readCsv` reads quoted fields, doubled quotes, byte-order marks, and LF or CRLF line ends.
- Errors name the line: "Line 3: "-20,0x" isn't an amount."
- `scripts/make-synthetic.ts` (`pnpm --filter @holt/importers synthetic`) writes synthetic files in each bank's exact format to `fixtures/synthetic/`, and those are committed. Every name, account number and amount in them is invented.
- Milestone 3 moved the row shape into core (`StatementRow`, `StatementFile`), added OFX 1.x and 2.x (built from the published structure with synthetic fixtures, because neither bank offers it), `decodeStatement` (UTF-8, else Windows-1252) and the synthetic generator as a function. There are now 198 tests. Most run on the synthetic files, and 3 run on the family's real files when `private/fixtures/` exists and skip otherwise. All three real files are read completely: 8,556, 32 and 4 rows.
- `private/public-patterns.txt` now also blocks the family's account numbers (in both spellings), the loan payments and the loans' identifiers. A synthetic file once copied the real loan payment by accident, and this check missed it then.

## Open for Milestone 3
- One Bulder file updates every Bulder account, so "Up to date" and the balance check work per account within one import.
- The import has to ask for each account's balance, because no file gives one.
