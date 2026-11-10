import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { refusalCodes } from "@holt/core";
import { createIntl } from "react-intl";
import { describe, expect, it } from "vitest";
import { locale, mergeMessages, messages } from "./messages.ts";

const sourceRoot = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "messages" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

// A message ID is a lower-case dotted string literal such as "nav.overview".
const idLiteral = /["'`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)["'`]/g;

function usedIds(): Map<string, string> {
  const used = new Map<string, string>();
  for (const file of sourceFiles(sourceRoot)) {
    for (const [, id] of readFileSync(file, "utf8").matchAll(idLiteral)) if (id !== undefined) used.set(id, file);
  }
  return used;
}

// Messages kept for screens that arrive later in Milestone 1 or after, and the refusal words, which refusal.ts looks up by code.
const reserved = new Set<string>(refusalCodes.map((code) => `refusal.${code}`));

describe("message files", () => {
  it("an ID in two message files is an error, so screens can't silently overwrite each other", () => {
    expect(() => mergeMessages({ "a.b": "One" }, { "a.b": "Two" })).toThrow(/two message files/);
    expect(mergeMessages({ "a.b": "One" }, { "a.c": "Two" })).toEqual({ "a.b": "One", "a.c": "Two" });
  });

  it("M2: every message ID used in the code exists in the en-GB file", () => {
    const missing = [...usedIds()].filter(([id]) => !(id in messages)).map(([id, file]) => `${id} in ${file}`);
    expect(missing).toEqual([]);
  });

  it("M2: every message in the en-GB file is used or reserved", () => {
    const used = usedIds();
    const unused = Object.keys(messages).filter((id) => !used.has(id) && !reserved.has(id));
    expect(unused).toEqual([]);
  });

  it("M3: every message is valid ICU", () => {
    const syntaxErrors: string[] = [];
    const intl = createIntl({
      locale,
      messages,
      onError: (error) => {
        if (error.message.includes("SyntaxError")) syntaxErrors.push(error.message.split("\n")[1] ?? error.message);
      },
    });
    for (const id of Object.keys(messages)) intl.formatMessage({ id });
    expect(syntaxErrors).toEqual([]);
  });

  it("M3: the check catches a broken message", () => {
    const syntaxErrors: string[] = [];
    const intl = createIntl({
      locale,
      messages: { broken: "Hello {name" },
      onError: (error) => {
        if (error.message.includes("SyntaxError")) syntaxErrors.push(error.message);
      },
    });
    intl.formatMessage({ id: "broken" });
    expect(syntaxErrors).toHaveLength(1);
  });
});
