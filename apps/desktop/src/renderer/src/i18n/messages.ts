import enGB from "../messages/en-GB.json";
import browse from "../messages/en-GB.browse.json";
import importing from "../messages/en-GB.importing.json";
import transactions from "../messages/en-GB.transactions.json";

export const locale = "en-GB";

/** Message files are split by area so work on separate screens doesn't collide. An ID may live in only one. */
export function mergeMessages(...files: readonly Record<string, string>[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of files) {
    for (const [id, text] of Object.entries(file)) {
      if (id in merged) throw new Error(`The message ID "${id}" is in two message files.`);
      merged[id] = text;
    }
  }
  return merged;
}

export const messages: Record<string, string> = mergeMessages(enGB, transactions, importing, browse);
export type MessageId = keyof typeof enGB | keyof typeof transactions | keyof typeof importing | keyof typeof browse;
