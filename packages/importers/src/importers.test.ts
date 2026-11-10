import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImportError, type ParsedStatement, readCsv, recogniseFormat } from "./index.ts";
import { dotted, syntheticAccounts } from "./synthetic.ts";

const synthetic = join(import.meta.dirname, "..", "fixtures", "synthetic");
const real = join(import.meta.dirname, "..", "..", "..", "private", "fixtures");

function parse(text: string): ParsedStatement {
  const format = recogniseFormat(text);
  if (format === null) throw new Error("No format recognised the file.");
  return format.parse(text);
}
const parseFile = (dir: string, name: string) => parse(readFileSync(join(dir, name), "utf8"));
const dataLines = (text: string) => text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "").length - 1;

describe("reading delimited text", () => {
  it("reads quoted fields, doubled quotes, delimiters inside quotes and CRLF", () => {
    expect(readCsv('\uFEFF"a";"b;c";"say ""hi"""\r\n1;;3\r\n', ";")).toEqual([
      { line: 1, fields: ["a", "b;c", 'say "hi"'] },
      { line: 2, fields: ["1", "", "3"] },
    ]);
  });

  it("reports an unclosed quote with the line it started on", () => {
    expect(() => readCsv('a;b\n"open;c\n', ";")).toThrow("line 2");
  });
});

describe("recognising a format", () => {
  it("names each bank's export by its header", () => {
    expect(recogniseFormat(readFileSync(join(synthetic, "bulder.csv"), "utf8"))?.id).toBe("bulder-csv");
    expect(recogniseFormat(readFileSync(join(synthetic, "sparebank1-deposit.csv"), "utf8"))?.id).toBe("sparebank1-csv");
  });

  it("names an OFX file by its header, with or without a byte-order mark", () => {
    expect(recogniseFormat(readFileSync(join(synthetic, "statement-1x.ofx"), "utf8"))?.id).toBe("ofx");
    expect(recogniseFormat(readFileSync(join(synthetic, "statement-2x.ofx"), "utf8"))?.id).toBe("ofx");
    expect(recogniseFormat("\uFEFF<OFX>\n<BANKMSGSRSV1>\n")?.id).toBe("ofx");
  });

  it("ignores blank lines before the header", () => {
    expect(recogniseFormat("\n\r\n  \nOFXHEADER:100\nDATA:OFXSGML\n")?.id).toBe("ofx");
    expect(recogniseFormat("\n" + readFileSync(join(synthetic, "bulder.csv"), "utf8"))?.id).toBe("bulder-csv");
    expect(recogniseFormat("\n\uFEFF" + readFileSync(join(synthetic, "sparebank1-deposit.csv"), "utf8").replace(/^\uFEFF/, ""))?.id).toBe("sparebank1-csv");
  });

  it("does not take a CSV that mentions OFX for an OFX file", () => {
    expect(recogniseFormat("Date,Note\n2026-01-01,<OFX>\n")).toBeNull();
    expect(recogniseFormat("Date,Note\n2026-01-01,OFXHEADER:100\n")).toBeNull();
  });

  it("returns null for a file it doesn't know", () => {
    expect(recogniseFormat("Date,Amount,Description\n2026-01-01,1.00,x\n")).toBeNull();
    expect(recogniseFormat("")).toBeNull();
  });
});

describe("Bulder", () => {
  const file = parseFile(synthetic, "bulder.csv");
  const rows = file.rows;

  it("reads every row, in kroner, with no closing balance", () => {
    expect(rows).toHaveLength(dataLines(readFileSync(join(synthetic, "bulder.csv"), "utf8")));
    expect(file.accountCurrency).toBe("NOK");
    expect(file.closingBalances).toEqual([]);
  });

  it("books every row, because the export has no way to mark a reserved one", () => {
    expect(rows.every((r) => !r.pending)).toBe(true);
  });

  it("gives each row to the account on its own side", () => {
    expect(new Set(rows.map((r) => r.account))).toEqual(new Set(["97101110001", "97101110002", "97101110003", "97101110004"]));
    const salary = rows.find((r) => r.description === "Lønn Eksempel AS");
    expect(salary).toMatchObject({ account: "97101110001", amount: 4_250_000, bankType: "Inntekt", counterparty: "Eksempel AS" });
  });

  it("shows a transfer between two Bulder accounts once on each account", () => {
    const transfer = rows.filter((r) => r.description === "Overførsel" && r.bookingDate === "2026-03-21");
    expect(transfer).toHaveLength(2);
    expect(transfer.map((r) => [r.account, r.amount])).toEqual([
      ["97101110001", transfer[0]!.amount],
      ["97101110003", -transfer[0]!.amount],
    ]);
    expect(transfer[0]!.amount).toBeLessThan(0);
  });

  it("keeps identical rows, because they are real repeats", () => {
    expect(rows.filter((r) => r.description === "Mikrospar til Ferie")).toHaveLength(40);
  });

  it("keeps the kroner amount of a purchase abroad and the original as information", () => {
    expect(rows.find((r) => r.description === "Example Store")).toMatchObject({
      amount: -16_460,
      counterpartName: "Example Store",
      counterparty: "Example Store",
      original: { text: "-15,11", currency: "USD" },
    });
  });

  it("reads a bill's account and KID, and a shop's name", () => {
    expect(rows.find((r) => r.description === "Fjordstrøm Energi")).toMatchObject({ counterpartAccount: "97404040001", reference: "0012345678903", counterparty: "Fjordstrøm Energi" });
    expect(rows.find((r) => r.description.startsWith("Nærbutikken"))?.counterpartName).toBe("Nærbutikken Fjord");
  });

  it("names the other party of a Vipps payment and of a payment to someone's account", () => {
    expect(rows.find((r) => r.description.startsWith("Fra: Eksempel Venn"))?.counterparty).toBe("Eksempel Venn");
    expect(rows.find((r) => r.description === "Eksempel Venn - Vipps")?.counterparty).toBe("Eksempel Venn");
    expect(rows.find((r) => r.description === dotted(syntheticAccounts.sparebank1.loanPayments.number))?.counterparty).toBeUndefined();
  });

  it("names a creditor whose account field holds an IBAN-like code by the description instead", () => {
    expect(rows.find((r) => r.description === "Eksempel Inkasso")).toMatchObject({ counterpartName: "NO7712345600099", counterparty: "Eksempel Inkasso" });
  });

  it("gives a zero-kroner e-invoice to the account that pays it", () => {
    const zero = rows.filter((r) => r.amount === 0);
    expect(zero).toHaveLength(9);
    expect(new Set(zero.map((r) => r.account))).toEqual(new Set(["97101110001"]));
  });

  it("keeps three identical purchases on one day as three rows", () => {
    const coffee = rows.filter((r) => r.description === "Kaffebaren Torget" && r.bookingDate === "2026-03-09" && r.amount === -4_500);
    expect(coffee).toHaveLength(3);
  });

  it("gives the line of a row it can't read", () => {
    const text = readFileSync(join(synthetic, "bulder.csv"), "utf8").replace("2026-01-03;-20,00", "2026-01-03;-20,0x");
    expect(() => parse(text)).toThrow(ImportError);
    expect(() => parse(text)).toThrow(/^Line 3: "-20,0x" isn't an amount\.$/);
  });
});

describe("SpareBank 1", () => {
  const file = parseFile(synthetic, "sparebank1-loan-payments.csv");

  it("reads a quoted file with a byte-order mark, for one account", () => {
    expect(file.rows).toHaveLength(20);
    expect(new Set(file.rows.map((r) => r.account))).toEqual(new Set(["97200020001"]));
    expect(file.accountCurrency).toBe("NOK");
  });

  it("reads money in and out from their own columns", () => {
    const [out, into] = [file.rows[0]!, file.rows[1]!];
    expect(out).toMatchObject({ bookingDate: "2026-10-22", interestDate: "2026-10-22", amount: -941_200, counterpartAccount: "97200020003" });
    expect(into).toMatchObject({ bookingDate: "2026-10-20", amount: 941_200, counterpartAccount: "97101110002", counterparty: "Eksempel Person" });
    expect(out.counterparty).toBeUndefined();
  });

  it("books every row, because the export has no way to mark a reserved one", () => {
    expect(file.rows.every((r) => !r.pending)).toBe(true);
    expect(file.closingBalances).toEqual([]);
  });

  it("leaves the interest date out when the bank does", () => {
    expect(file.rows.at(-1)?.interestDate).toBeUndefined();
  });

  it("refuses a file that mixes accounts", () => {
    const text = '\uFEFFDato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;\n"01.02.2026";"a";;"1,00";;"97200020001";;\n"02.02.2026";"b";;"1,00";;"97200020009";;\n';
    expect(() => parse(text)).toThrow("Line 3: This row belongs to 97200020009, but the file is for 97200020001.");
  });

  it("refuses a row with money both in and out", () => {
    const text = '\uFEFFDato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;\n"01.02.2026";"a";;"1,00";"-1,00";"97200020001";;\n';
    expect(() => parse(text)).toThrow("Line 2: A row needs an amount in either Inn or Ut.");
  });

  it("refuses a date that doesn't exist", () => {
    const text = '\uFEFFDato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;\n"30.02.2026";"a";;"1,00";;"97200020001";;\n';
    expect(() => parse(text)).toThrow('Line 2: "30.02.2026" isn\'t a date.');
  });
});

// The family's own exports, when this machine has them. They never leave private/fixtures/.
describe.skipIf(!existsSync(real))("the family's real exports", () => {
  const files = existsSync(real) ? readdirSync(real).filter((f) => f.toLowerCase().endsWith(".csv")) : [];

  it.each(files)("%s: Holt recognises the format and reads every row", (name) => {
    const text = readFileSync(join(real, name), "utf8");
    const file = parse(text);
    expect(file.rows).toHaveLength(dataLines(text));
    expect(file.accountCurrency).toBe("NOK");
    for (const row of file.rows) {
      expect(row.account).toMatch(/^\d{11}$/);
      expect(row.bookingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isSafeInteger(row.amount)).toBe(true);
      expect(row.pending).toBe(false);
      if (row.counterparty !== undefined) {
        expect(row.counterparty).toBe(row.counterparty.trim());
        expect(row.counterparty).toMatch(/\p{L}/u);
        expect(row.counterparty).not.toMatch(/\s{2}/);
      }
    }
  });
});
