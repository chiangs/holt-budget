/** One record per line of a delimited file: fields in order, with the 1-based line it started on. */
export interface CsvRecord {
  readonly line: number;
  readonly fields: readonly string[];
}

/**
 * Reads delimited text as the banks write it: an optional byte-order mark, quoted or bare fields,
 * doubled quotes inside quoted fields, and LF or CRLF line ends. Blank lines are skipped.
 */
export function readCsv(text: string, delimiter: ";" | "," | "\t"): CsvRecord[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    if (fields.length > 1 || fields[0] !== "") records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      endField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error(`A quoted field starting on line ${recordLine} never ends.`);
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}
