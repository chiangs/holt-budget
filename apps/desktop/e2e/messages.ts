import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const folder = join(import.meta.dirname, "../src/renderer/src/messages");

/** Every en-GB message file, merged, for tests that look up the words a screen shows. */
export const messages: Record<string, string> = Object.assign(
  {},
  ...readdirSync(folder)
    .filter((name) => /^en-GB(\..+)?\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(folder, name), "utf8")) as Record<string, string>),
);

export function say(id: string): string {
  const text = messages[id];
  if (text === undefined) throw new Error(`No message ${id}`);
  return text;
}
