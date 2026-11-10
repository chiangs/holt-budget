import { ImportError } from "./types.ts";

export interface DecodedStatement {
  readonly text: string;
  /** Which encoding read the bytes. A file that isn't valid UTF-8 is read as Windows-1252, which older bank exports use. */
  readonly encoding: "utf-8" | "windows-1252";
}

const utf16ByteOrderMarks: readonly (readonly [number, number])[] = [
  [0xff, 0xfe],
  [0xfe, 0xff],
];

/**
 * Turns a file's bytes into text: UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252, which reads any byte.
 * A byte-order mark is dropped. A file with NUL bytes isn't text, so it is refused before any format sees it.
 */
export function decodeStatement(bytes: Uint8Array): DecodedStatement {
  if (bytes.includes(0)) {
    const [first, second] = bytes;
    const utf16 = utf16ByteOrderMarks.some(([a, b]) => a === first && b === second);
    throw new ImportError(
      utf16
        ? "This file is UTF-16 text, which Holt can't read. Export it again as UTF-8, or ask the bank for a CSV or OFX file."
        : "This file isn't a text export. It has binary content, such as a PDF, a spreadsheet or an image. Holt reads CSV and OFX files.",
    );
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}
