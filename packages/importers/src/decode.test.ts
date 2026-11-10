import { describe, expect, it } from "vitest";
import { ImportError, decodeStatement, recogniseFormat } from "./index.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);
const bytes = (...values: number[]) => Uint8Array.from(values);

describe("decoding a statement file", () => {
  it("reads UTF-8 and says so", () => {
    expect(decodeStatement(utf8("Fjordstrøm Energi;Åse;日本"))).toEqual({ text: "Fjordstrøm Energi;Åse;日本", encoding: "utf-8" });
  });

  it("drops a UTF-8 byte-order mark", () => {
    const decoded = decodeStatement(bytes(0xef, 0xbb, 0xbf, ...utf8("Dato;Beskrivelse")));
    expect(decoded.text).toBe("Dato;Beskrivelse");
    expect(decoded.encoding).toBe("utf-8");
  });

  it("falls back to Windows-1252 for bytes that are not UTF-8", () => {
    // "Kjøpt på nett: 12 €" as Windows-1252 writes it: ø, å and the euro sign are single bytes.
    const decoded = decodeStatement(bytes(0x4b, 0x6a, 0xf8, 0x70, 0x74, 0x20, 0x70, 0xe5, 0x20, 0x6e, 0x65, 0x74, 0x74, 0x3a, 0x20, 0x31, 0x32, 0x20, 0x80));
    expect(decoded).toEqual({ text: "Kjøpt på nett: 12 €", encoding: "windows-1252" });
  });

  it("does not take UTF-8 for Windows-1252, which would show every ø as two characters", () => {
    expect(decodeStatement(utf8("Brød og smør")).text).toBe("Brød og smør");
  });

  it("reads an empty file as empty text", () => {
    expect(decodeStatement(new Uint8Array())).toEqual({ text: "", encoding: "utf-8" });
  });

  it("gives text a format can recognise, with the byte-order mark gone", () => {
    const header = "\uFEFFDato;Beskrivelse;Rentedato;Inn;Ut;Til konto;Fra konto;\n";
    expect(recogniseFormat(decodeStatement(utf8(header)).text)?.id).toBe("sparebank1-csv");
  });
});

describe("refusing a file that is not text", () => {
  it("refuses binary content in plain words", () => {
    const pdf = bytes(...utf8("%PDF-1.7\n"), 0x00, 0x01, 0x02, 0xff);
    expect(() => decodeStatement(pdf)).toThrow(ImportError);
    expect(() => decodeStatement(pdf)).toThrow("This file isn't a text export. It has binary content, such as a PDF, a spreadsheet or an image. Holt reads CSV and OFX files.");
  });

  it("refuses a NUL byte anywhere in the file, even late", () => {
    const late = bytes(...utf8("Dato;Beløp\n".repeat(1000)), 0x00);
    expect(() => decodeStatement(late)).toThrow(ImportError);
  });

  it.each([
    ["little-endian", [0xff, 0xfe, 0x44, 0x00, 0x61, 0x00]],
    ["big-endian", [0xfe, 0xff, 0x00, 0x44, 0x00, 0x61]],
  ])("says when the file is UTF-16 (%s), because that is the usual reason a text file has NUL bytes", (_, values) => {
    expect(() => decodeStatement(bytes(...values))).toThrow(/UTF-16/);
  });

  it("carries no line, because the file is refused before it has lines", () => {
    try {
      decodeStatement(bytes(0x00));
    } catch (error) {
      expect((error as ImportError).line).toBeUndefined();
      return;
    }
    throw new Error("expected a refusal");
  });
});
