import { chmodSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStatementFile } from "./files.ts";

const mebibyte = 1024 * 1024;

/** What a read came to, without the bytes, so a failing assertion doesn't try to print 32 MiB. */
async function outcome(path: string) {
  const read = await readStatementFile(path);
  return read.kind === "bytes" ? { kind: read.kind, length: read.bytes.length } : read;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "holt-files-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading a file the family chose", () => {
  it("gives the file's bytes", async () => {
    writeFileSync(join(dir, "a.csv"), "Dato;Beløp\n");
    const read = await readStatementFile(join(dir, "a.csv"));
    expect(read.kind === "bytes" && Buffer.from(read.bytes).toString("utf8")).toBe("Dato;Beløp\n");
  });

  it("says a file that isn't there is missing, also when a folder in its path is a file", async () => {
    writeFileSync(join(dir, "plain"), "x");
    expect(await readStatementFile(join(dir, "gone.csv"))).toEqual({ kind: "unreadable", reason: "missing" });
    expect(await readStatementFile(join(dir, "plain", "inside.csv"))).toEqual({ kind: "unreadable", reason: "missing" });
  });

  it.skipIf(process.getuid?.() === 0)("says a file the family can't open is denied", async () => {
    const file = join(dir, "locked.csv");
    writeFileSync(file, "x");
    chmodSync(file, 0o000);
    expect(await readStatementFile(file)).toEqual({ kind: "unreadable", reason: "denied" });
  });

  it("refuses a file over 32 MiB without reading it, and reads one of exactly 32 MiB", async () => {
    const big = join(dir, "big.csv");
    writeFileSync(big, "");
    truncateSync(big, 32 * mebibyte + 1);
    expect(await outcome(big)).toEqual({ kind: "unreadable", reason: "tooLarge" });

    truncateSync(big, 32 * mebibyte);
    expect(await outcome(big)).toEqual({ kind: "bytes", length: 32 * mebibyte });
  });

  it("calls a folder or a device not text, and never waits on it", async () => {
    mkdirSync(join(dir, "folder"));
    expect(await readStatementFile(join(dir, "folder"))).toEqual({ kind: "unreadable", reason: "notText" });
    expect(await readStatementFile("/dev/zero")).toEqual({ kind: "unreadable", reason: "notText" });
  });
});
