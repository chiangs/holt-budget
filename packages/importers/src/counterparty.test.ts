import { describe, expect, it } from "vitest";
import { cleanCounterparty } from "./counterparty.ts";

const clean = (description: string, counterpartName?: string) => cleanCounterparty({ description, counterpartName });

describe("a card payment", () => {
  it.each([
    ["Kortkjøp 12.03 Torgbua", "Torgbua"],
    ["Kortkjøp 12.03.26 *1234 Torgbua", "Torgbua"],
    ["Kortkjøp 12.03 NOK 349,00 Torgbua Eksempelby", "Torgbua Eksempelby"],
    ["Varekjøp Torgbua 505", "Torgbua"],
    ["Visa 4567 12.03 Torgbua", "Torgbua"],
    ["Visa *4567 Torgbua", "Torgbua"],
    ["Debetkort 4571 **** **** 1234 Torgbua", "Torgbua"],
    ["Torgbua 12:45", "Torgbua"],
    ["TORGBUA 505", "Torgbua"],
    ["Torgbua - Zettle", "Torgbua"],
    ["Torgbua \u2013 Zettle", "Torgbua"],
    ["Zettle*Torgbua", "Torgbua"],
  ])("%s gives %s", (description, expected) => {
    expect(clean(description)).toBe(expected);
  });

  it("gives one name to the same shop however the bank dresses it", () => {
    const dressings = ["Torgbua", "TORGBUA", "Kortkjøp 03.11 Torgbua 4521", "Varekjøp 03.11 *4567 TORGBUA", "Torgbua - Vipps", "Visa 4567 Torgbua 12:45"];
    expect(new Set(dressings.map((d) => clean(d)))).toEqual(new Set(["Torgbua"]));
  });
});

describe("a recurring bill", () => {
  it.each([
    ["Avtalegiro til: Fjordstrøm Energi Betalt: 15.03.26", "Fjordstrøm Energi"],
    ["Avtalegiro Fjordstrøm Energi", "Fjordstrøm Energi"],
    ["Efaktura Nettbredd Bredbånd", "Nettbredd Bredbånd"],
    ["E-faktura Nettbredd Bredbånd", "Nettbredd Bredbånd"],
    ["Fjordstrøm Energi KID 0012345678903", "Fjordstrøm Energi"],
    ["Fjordstrøm Energi Ref: AB12345", "Fjordstrøm Energi"],
    ["Eksempel Mobil f.nr:16636463", "Eksempel Mobil"],
    ["Fjordstrøm Energi 0012345678903", "Fjordstrøm Energi"],
    ["Lønn Eksempel AS", "Eksempel AS"],
    ["Eksempelbank Kundeutbytte 2025", "Eksempelbank Kundeutbytte"],
  ])("%s gives %s", (description, expected) => {
    expect(clean(description)).toBe(expected);
  });
});

describe("a payment between two people", () => {
  it.each([
    ["Fra: Eksempel Venn Betalt: 12.03.26", "Eksempel Venn"],
    ["Til: Eksempel Venn", "Eksempel Venn"],
    ["Nettgiro til: Eksempel Venn Betalt: 02.03.26", "Eksempel Venn"],
    ["Overføring til: Eksempel Venn", "Eksempel Venn"],
    ["Eksempel Venn - Vipps", "Eksempel Venn"],
    ["Vipps*Eksempel Venn", "Eksempel Venn"],
    ["Eksempel Venn - PayPal", "Eksempel Venn"],
    ["Eksempel Venn", "Eksempel Venn"],
    ["Fra: EKSEMPEL ETAT", "Eksempel Etat"],
  ])("%s gives %s", (description, expected) => {
    expect(clean(description)).toBe(expected);
  });
});

describe("a transfer between the household's own accounts", () => {
  it.each([
    "Til :97200020003",
    "Til:97200020003",
    "Overføring til 9720.00.20003",
    "9720.00.20003",
    "97200020003",
    "Overførsel",
    "Nettbank",
    "Overføring",
    "",
    "   ",
  ])("gives no name for %j, because the description only names the other account", (description) => {
    expect(clean(description)).toBeUndefined();
  });

  it("keeps a label the family chose for a savings transfer", () => {
    expect(clean("Mikrospar til Ferie")).toBe("Mikrospar til Ferie");
  });
});

describe("a purchase in a foreign currency", () => {
  it.each([
    ["Visa 4567 Utland USD 15,50 Kurs: 10,5000 Example Store", "Example Store"],
    ["Utlandskjøp 12.03 15,50 USD Valutakurs 10,5 Example Store", "Example Store"],
    ["Kortkjøp EUR 4,40 Café Exemple", "Café Exemple"],
    ["Example Store", "Example Store"],
  ])("%s gives %s", (description, expected) => {
    expect(clean(description)).toBe(expected);
  });

  it("does not take a word that looks like a currency for one", () => {
    expect(clean("Sek Skoleutstyr")).toBe("Sek Skoleutstyr");
  });
});

describe("noise that is not a name", () => {
  it.each(["BV2510310175601 NOT4ZVS66EJJO11C", "NO7712345600099", "SPAV26021601QXB0NOTAJIBC0VL5111P", "12345", "12.03.26", "Kortkjøp 12.03 *1234"])(
    "gives no name for %j",
    (description) => {
      expect(clean(description)).toBeUndefined();
    },
  );
});

describe("store numbers and brand numerals", () => {
  it.each([
    ["Fjordmat 1132", "Fjordmat"],
    ["Fjordmat Nr 103", "Fjordmat"],
    ["Fjordmat NO 10", "Fjordmat"],
    ["Fjordmat #7", "Fjordmat"],
    ["Fjordmat 505 Eksempelby", "Fjordmat 505 Eksempelby"],
    ["Studio 54", "Studio 54"],
    ["Eksempelbank 1 Sør", "Eksempelbank 1 Sør"],
    ["24-Timer Eksempel", "24-Timer Eksempel"],
    ["Vaskehall 24/7 AS", "Vaskehall 24/7 AS"],
    ["Eksempel1Sparing", "Eksempel1Sparing"],
  ])("%s gives %s", (description, expected) => {
    expect(clean(description)).toBe(expected);
  });
});

describe("casing", () => {
  it.each([
    ["FJORDBANK FINANS AS", "Fjordbank Finans AS"],
    ["S&K SPORT", "S&K Sport"],
    ["OLA-KARI NORDMANN", "Ola-Kari Nordmann"],
    ["Fjordstrøm Energi", "Fjordstrøm Energi"],
    ["Bredbånd As", "Bredbånd As"],
    ["ÅSE BRØD", "Åse Brød"],
  ])("%s gives %s", (description, expected) => {
    expect(clean(description)).toBe(expected);
  });
});

describe("the name the bank gives", () => {
  it("prefers the counterpart name to the description", () => {
    expect(clean("Kortkjøp 12.03 Torgbua", "Torgbua Eksempelby")).toBe("Torgbua Eksempelby");
  });

  it("falls back to the description when the name is only a code", () => {
    expect(clean("Eksempel Inkasso", "NO7712345600099")).toBe("Eksempel Inkasso");
  });

  it("gives no name when neither holds one", () => {
    expect(clean("Overførsel", "NO7712345600099")).toBeUndefined();
  });
});

describe("cleaning in general", () => {
  const payees = ["Torgbua", "Fjordstrøm Energi", "Eksempel Venn", "Bokhandel Strand", "Nordlys Kiosk AS", "Café Exemple"];
  const prefixes = ["", "Kortkjøp 12.03 ", "Varekjøp ", "Visa 4567 ", "Avtalegiro til: ", "Nettgiro til: ", "Fra: ", "Til: ", "Vipps*", "Kortkjøp 03.11.26 *1234 "];
  const suffixes = ["", " 505", " 1132", " Nr 103", " Betalt: 12.03.26", " - Vipps", " - Zettle", " 12:45", " KID 0012345678903", " f.nr:16636463"];
  const everyDressing = payees.flatMap((payee) => prefixes.flatMap((prefix) => suffixes.map((suffix) => ({ payee, text: `${prefix}${payee}${suffix}` }))));

  it("gives one name to a payee, whatever method words, dates, card fragments and numbers surround it", () => {
    for (const { payee, text } of everyDressing) expect(clean(text), text).toBe(payee);
  });

  it("gives the same name when it cleans a name it already cleaned, even from capitals", () => {
    for (const { payee, text } of everyDressing) {
      const once = clean(text.toUpperCase().replace(/^KORTKJØP/, "Kortkjøp"));
      expect(once, text).toBeDefined();
      expect(clean(once!), text).toBe(once);
      expect(once?.toLowerCase(), text).toBe(payee.toLowerCase());
    }
  });

  it("gives a name that is trimmed, has a letter and has no double spaces, or no name at all, whatever the text", () => {
    const pieces = [...payees, ...prefixes, ...suffixes, "12.03", "*1234", "NOK 349,00", "-", ":", "*", "  ", "99", "ÆØÅ", "x", "\t", "\u2013"];
    let state = 20261110;
    const next = (n: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % n;
    };
    for (let i = 0; i < 3000; i++) {
      const description = Array.from({ length: next(7) }, () => pieces[next(pieces.length)]!).join(next(2) === 0 ? " " : "");
      const name = clean(description);
      if (name === undefined) continue;
      expect(name, JSON.stringify(description)).toBe(name.trim());
      expect(name, JSON.stringify(description)).toMatch(/\p{L}/u);
      expect(name, JSON.stringify(description)).not.toMatch(/\s{2}/);
    }
  });
});
