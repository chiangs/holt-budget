import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImportError, type ParsedStatement, recogniseFormat } from "./index.ts";

/** The hash sign of a numeric character reference, written as a character code so the colour lint doesn't read the reference as a hex colour. */
const hash = String.fromCharCode(35);

const synthetic = join(import.meta.dirname, "..", "fixtures", "synthetic");

function parse(text: string): ParsedStatement {
  const format = recogniseFormat(text);
  if (format === null) throw new Error("No format recognised the file.");
  return format.parse(text);
}

/** The 1-based line of the first line that contains the marker. */
const lineOf = (text: string, marker: string) => text.split("\n").findIndex((l) => l.includes(marker)) + 1;

const fixture = (name: string) => parse(readFileSync(join(synthetic, name), "utf8"));
const withoutLines = (file: ParsedStatement) => file.rows.map(({ line: _, ...row }) => row);

const sgmlHeader = ["OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "SECURITY:NONE", "ENCODING:USASCII", "CHARSET:1252", "COMPRESSION:NONE", "OLDFILEUID:NONE", "NEWFILEUID:NONE", ""];

/** A one-statement OFX 1.x file. The statement's transactions go in the given lines; the first line after the header is line 11. */
function sgml(transactions: readonly string[], { curdef = "NOK", acct = "97600060001", extra = [] as string[] } = {}): string {
  return [
    ...sgmlHeader,
    "<OFX>",
    "<BANKMSGSRSV1>",
    "<STMTTRNRS>",
    "<STMTRS>",
    ...(curdef ? [`<CURDEF>${curdef}`] : []),
    "<BANKACCTFROM>",
    "<BANKID>9760",
    `<ACCTID>${acct}`,
    "<ACCTTYPE>CHECKING",
    "</BANKACCTFROM>",
    "<BANKTRANLIST>",
    "<DTSTART>20261001",
    "<DTEND>20261031",
    ...transactions,
    "</BANKTRANLIST>",
    ...extra,
    "</STMTRS>",
    "</STMTTRNRS>",
    "</BANKMSGSRSV1>",
    "</OFX>",
    "",
  ].join("\n");
}

const debit = (amount: string, extra: readonly string[] = []) => ["<STMTTRN>", "<TRNTYPE>DEBIT", "<DTPOSTED>20261003", `<TRNAMT>${amount}`, "<FITID>1", ...extra, "</STMTTRN>"];

describe("the synthetic OFX files", () => {
  const sgmlFile = () => fixture("statement-1x.ofx");
  const xmlFile = () => fixture("statement-2x.ofx");

  it("read the same rows from OFX 1.x (SGML) and 2.x (XML)", () => {
    const [old, xml] = [sgmlFile(), xmlFile()];
    expect(old.rows.length).toBeGreaterThan(20);
    expect(withoutLines(xml)).toEqual(withoutLines(old));
    expect(xml.closingBalances).toEqual(old.closingBalances);
  });

  it("state the account, the currency and the closing balance", () => {
    const old = sgmlFile();
    expect(old.format).toBe("ofx");
    expect(old.accountCurrency).toBe("NOK");
    expect(new Set(old.rows.map((r) => r.account))).toEqual(new Set(["97600060001"]));
    expect(old.closingBalances).toEqual([{ account: "97600060001", date: "2026-11-09", balance: 43_619_257 }]);
  });

  it("read the posted rows as booked and the pending one as pending", () => {
    const old = sgmlFile();
    expect(old.rows.filter((r) => r.pending)).toEqual([
      expect.objectContaining({ bookingDate: "2026-11-09", amount: -4_900, description: "Nærbutikken Fjord", counterparty: "Nærbutikken Fjord", bankType: "POS" }),
    ]);
  });

  it("read a row's type, name, memo and cleaned counterparty", () => {
    const old = sgmlFile();
    expect(old.rows[0]).toMatchObject({
      bookingDate: "2026-01-05",
      bankType: "POS",
      description: "KAFFEBAREN TORGET Kortkjøp 05.01",
      counterpartName: "KAFFEBAREN TORGET",
      counterparty: "Kaffebaren Torget",
      pending: false,
    });
  });

  it("give the line each row started on, counting the header", () => {
    const lines = readFileSync(join(synthetic, "statement-1x.ofx"), "utf8").split("\n");
    for (const row of sgmlFile().rows) expect(lines[row.line - 1]).toMatch(/^<STMTTRNP?>$/);
  });
});

describe("reading a transaction", () => {
  it("takes the amount's sign, a plus sign, a bare whole number and a comma decimal", () => {
    const file = parse(sgml([...debit("-12.50"), ...debit("+1234.5"), ...debit("7"), ...debit("-0,05")]));
    expect(file.rows.map((r) => r.amount)).toEqual([-1_250, 123_450, 700, -5]);
  });

  it("takes the day as the bank wrote it, whatever the time and the time zone", () => {
    const dates = ["20261003", "20261003235959", "20261003000000.000", "20261003000000.123[+1:CET]", "20261003120000[-5:EST]"];
    const file = parse(sgml(dates.flatMap((d) => ["<STMTTRN>", "<TRNTYPE>DEBIT", `<DTPOSTED>${d}`, "<TRNAMT>-1.00", "</STMTTRN>"])));
    expect(new Set(file.rows.map((r) => r.bookingDate))).toEqual(new Set(["2026-10-03"]));
  });

  it("takes the check number, or else the reference number, as the reference", () => {
    const file = parse(sgml([...debit("-1.00", ["<CHECKNUM>1001"]), ...debit("-1.00", ["<REFNUM>R-77"]), ...debit("-1.00")]));
    expect(file.rows.map((r) => r.reference)).toEqual(["1001", "R-77", undefined]);
  });

  it("joins the name and the memo into the description, and does not repeat a memo that says the same", () => {
    const file = parse(sgml([...debit("-1.00", ["<NAME>Torgbua", "<MEMO>Kortkjøp 12.03"]), ...debit("-1.00", ["<NAME>Torgbua", "<MEMO>Torgbua"]), ...debit("-1.00", ["<MEMO>Only a memo"]), ...debit("-1.00")]));
    expect(file.rows.map((r) => r.description)).toEqual(["Torgbua Kortkjøp 12.03", "Torgbua", "Only a memo", ""]);
    expect(file.rows.map((r) => r.counterparty)).toEqual(["Torgbua", "Torgbua", "Only a memo", undefined]);
  });

  it("reads a payee name inside a PAYEE aggregate", () => {
    const file = parse(sgml(debit("-1.00", ["<PAYEE>", "<NAME>Fjordmat", "<ADDR1>Storgata 1", "</PAYEE>"])));
    expect(file.rows[0]).toMatchObject({ description: "Fjordmat", counterpartName: "Fjordmat" });
  });

  it("reads character references and entities in a name", () => {
    const file = parse(sgml(debit("-1.00", [`<NAME>Smith &amp; S&${hash}248;nner &lt;1&gt;`])));
    expect(file.rows[0]?.description).toBe("Smith & Sønner <1>");
  });

  it("keeps a character reference it cannot make a character from", () => {
    const reference = `&${hash}99999999;`;
    const file = parse(sgml(debit("-1.00", [`<NAME>Torgbua ${reference} &bogus;`])));
    expect(file.rows[0]?.description).toBe(`Torgbua ${reference} &bogus;`);
  });

  it("reads a statement with no transactions", () => {
    const file = parse(sgml([]));
    expect(file.rows).toEqual([]);
    expect(file.accountCurrency).toBe("NOK");
  });

  it("reads a card statement", () => {
    const text = [
      "<OFX>",
      "<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>",
      "<CURDEF>NOK",
      "<CCACCTFROM><ACCTID>97600060009</ACCTID></CCACCTFROM>",
      "<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261003</DTPOSTED><TRNAMT>-99.00</TRNAMT><FITID>1</FITID><NAME>Torgbua</NAME></STMTTRN></BANKTRANLIST>",
      "<LEDGERBAL><BALAMT>-1500.00</BALAMT><DTASOF>20261031</DTASOF></LEDGERBAL>",
      "</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>",
      "</OFX>",
    ].join("\n");
    const file = parse(text);
    expect(file.rows).toEqual([expect.objectContaining({ account: "97600060009", amount: -9_900, counterparty: "Torgbua" })]);
    expect(file.closingBalances).toEqual([{ account: "97600060009", date: "2026-10-31", balance: -150_000 }]);
  });
});

describe("a pending transaction", () => {
  const pending = ["<BANKTRANLISTP>", "<DTASOF>20261031", "<STMTTRNP>", "<TRNTYPE>HOLD", "<DTTRAN>20261030", "<DTEXPIRE>20261105", "<TRNAMT>-250.00", "<NAME>Eksempel Bilutleie", "</STMTTRNP>", "</BANKTRANLISTP>"];

  it("is pending, booked on the day it started, and apart from the posted ones", () => {
    const file = parse(sgml(debit("-12.50"), { extra: pending }));
    expect(file.rows.map((r) => [r.bookingDate, r.amount, r.pending, r.bankType])).toEqual([
      ["2026-10-03", -1_250, false, "DEBIT"],
      ["2026-10-30", -25_000, true, "HOLD"],
    ]);
  });

  it("needs the date it started", () => {
    const text = sgml([], { extra: pending.map((l) => (l.startsWith("<DTTRAN>") ? "<DTPOSTED>20261030" : l)) });
    expect(() => parse(text)).toThrow(`Line ${lineOf(text, "<STMTTRNP>")}: The <STMTTRNP> element has no <DTTRAN> element.`);
  });
});

describe("the closing balance", () => {
  it("is the ledger balance, as at its date", () => {
    const file = parse(sgml([], { extra: ["<LEDGERBAL>", "<BALAMT>-4321.09", "<DTASOF>20261031235959[0:GMT]", "</LEDGERBAL>"] }));
    expect(file.closingBalances).toEqual([{ account: "97600060001", date: "2026-10-31", balance: -432_109 }]);
  });

  it("is left out when the file states none", () => {
    expect(parse(sgml([])).closingBalances).toEqual([]);
  });

  it("is not the available balance", () => {
    const file = parse(sgml([], { extra: ["<AVAILBAL>", "<BALAMT>5.00", "<DTASOF>20261031", "</AVAILBAL>"] }));
    expect(file.closingBalances).toEqual([]);
  });
});

describe("the account", () => {
  it("is the 11 digits the bank gives", () => {
    expect(parse(sgml(debit("-1.00"))).rows[0]?.account).toBe("97600060001");
  });

  it.each(["NO9397600060001", "NO93 9760 0060001", "no9397600060001"])("is the last 11 digits of the Norwegian IBAN %s", (iban) => {
    expect(parse(sgml(debit("-1.00"), { acct: iban })).rows[0]?.account).toBe("97600060001");
  });

  it("is refused when it is not an 11-digit number, with the line of the account", () => {
    const text = sgml(debit("-1.00"), { acct: "SE1234" });
    expect(() => parse(text)).toThrow(`Line ${lineOf(text, "<ACCTID>")}: "SE1234" isn't an 11-digit account number.`);
  });
});

describe("the currency", () => {
  it("is the statement's, so a file in another currency reads as that currency for the import to refuse", () => {
    const file = parse(sgml(debit("-12.50"), { curdef: "SEK" }));
    expect(file.accountCurrency).toBe("SEK");
    expect(file.rows[0]?.amount).toBe(-1_250);
  });

  it("is needed", () => {
    const text = sgml(debit("-1.00"), { curdef: "" });
    expect(() => parse(text)).toThrow(`Line ${lineOf(text, "<STMTRS>")}: The statement doesn't state its currency.`);
  });

  it("is a currency code", () => {
    const text = sgml(debit("-1.00"), { curdef: "XYZ" });
    expect(() => parse(text)).toThrow(`Line ${lineOf(text, "<CURDEF>")}: "XYZ" isn't a currency code.`);
  });

  it("is the same for every statement in the file", () => {
    const one = sgml(debit("-1.00"));
    const two = sgml(debit("-1.00"), { curdef: "EUR", acct: "97600060002" });
    const both = one.replace("</OFX>\n", "") + two.slice(two.indexOf("<OFX>") + "<OFX>\n".length);
    const secondStatement = both.split("\n").findIndex((l, i, lines) => l === "<STMTRS>" && lines.indexOf("<STMTRS>") !== i) + 1;
    expect(() => parse(both)).toThrow(`Line ${secondStatement}: This statement is in EUR, but the file's first is in NOK. Export one currency at a time.`);
  });

  it("refuses a transaction in another currency than its statement", () => {
    const text = sgml(debit("-1.00", ["<CURRENCY>", "<CURRATE>0.09", "<CURSYM>SEK", "</CURRENCY>"]));
    expect(() => parse(text)).toThrow(`Line ${lineOf(text, "<STMTTRN>")}: This transaction is in SEK, but the account is in NOK. Holt doesn't mix currencies.`);
  });

  it("accepts a transaction that names the statement's own currency", () => {
    const text = sgml(debit("-1.00", ["<CURRENCY>", "<CURRATE>1", "<CURSYM>NOK", "</CURRENCY>"]));
    expect(parse(text).rows).toHaveLength(1);
  });

  it("does not carry the original foreign amount, which the format gives only as a rate", () => {
    const text = sgml(debit("-100.00", ["<ORIGCURRENCY>", "<CURRATE>0.1", "<CURSYM>USD", "</ORIGCURRENCY>"]));
    expect(parse(text).rows[0]?.original).toBeUndefined();
  });
});

describe("a file Holt refuses", () => {
  it.each([
    ["an amount that is not one", sgml(debit("12.5x")), "<STMTTRN>", '"12.5x" isn\'t an amount.'],
    ["a date that does not exist", sgml(["<STMTTRN>", "<TRNTYPE>DEBIT", "<DTPOSTED>20261331", "<TRNAMT>-1.00", "</STMTTRN>"]), "<STMTTRN>", '"20261331" isn\'t an OFX date.'],
    ["a transaction with no amount", sgml(["<STMTTRN>", "<TRNTYPE>DEBIT", "<DTPOSTED>20261003", "</STMTTRN>"]), "<STMTTRN>", "The <STMTTRN> element has no <TRNAMT> element."],
    ["a transaction with no posting date", sgml(["<STMTTRN>", "<TRNAMT>-1.00", "</STMTTRN>"]), "<STMTTRN>", "The <STMTTRN> element has no <DTPOSTED> element."],
    ["a correction of an earlier transaction", sgml(debit("-1.00", ["<CORRECTFITID>0", "<CORRECTACTION>DELETE"])), "<STMTTRN>", "This transaction corrects an earlier one, and Holt can't apply a correction to a file it imported before."],
    ["a statement with no account", sgml([]).replace(/<BANKACCTFROM>[\s\S]*<\/BANKACCTFROM>\n/, ""), "<STMTRS>", "The statement names no account."],
    ["an aggregate that never closes", sgml(debit("-1.00")).replace("</BANKTRANLIST>\n", ""), "<BANKTRANLIST>", "<BANKTRANLIST> is never closed."],
    ["a closing tag with nothing open", sgml([]).replace("</STMTRS>", "</STMTRS>\n</BANKACCTFROM>"), "</BANKACCTFROM>\n</STMTTRNRS>", "There is a </BANKACCTFROM> with no <BANKACCTFROM> before it."],
  ])("%s, naming the line", (_, text, marker, message) => {
    const line = marker.includes("\n") ? text.slice(0, text.indexOf(marker)).split("\n").length : lineOf(text, marker);
    expect(() => parse(text)).toThrow(ImportError);
    expect(() => parse(text)).toThrow(`Line ${line}: ${message}`);
  });

  it("with no statement in it", () => {
    expect(() => parse("<OFX>\n<SIGNONMSGSRSV1>\n</SIGNONMSGSRSV1>\n</OFX>\n")).toThrow("The file has no account statement.");
  });

  it("with an OFX header but no <OFX> section", () => {
    expect(() => parse("OFXHEADER:100\nDATA:OFXSGML\n")).toThrow("The file has no <OFX> section.");
  });
});
