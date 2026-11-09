// Spike S5's "done when": the family's questions, written by hand as queries, parse and run on the family's real exports.
// Both stay in private/, so this runs only on a machine that has them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AskReply, type QueryableTransaction, currency, evaluateTransactionQuery } from "@holt/core";
import { describe, expect, it } from "vitest";
import { type ParsedRow, recogniseFormat } from "./index.ts";

const privateFolder = join(import.meta.dirname, "..", "..", "..", "private");
const questionsFile = join(privateFolder, "questions.json");
const fixtures = join(privateFolder, "fixtures");

interface Question {
  n: number;
  question: string;
  answerableNow: boolean;
  reply: unknown;
}

function realTransactions(): QueryableTransaction[] {
  const rows: (ParsedRow & { file: string })[] = [];
  for (const name of readdirSync(fixtures).filter((f) => f.toLowerCase().endsWith(".csv"))) {
    const text = readFileSync(join(fixtures, name), "utf8");
    for (const row of recogniseFormat(text)!.parse(text).rows) rows.push({ ...row, file: name });
  }
  const own = new Set<string>(rows.map((r) => r.account));
  return rows.map((r) => ({
    id: `${r.file}:${r.line}`,
    account: r.accountName ?? r.account,
    bookingDate: r.bookingDate,
    amount: r.amount,
    // Bulder gives a bill's payee as an account number and puts the payee's name in the description.
    counterparty: r.counterpartName ?? r.description,
    ...(r.counterpartAccount ? { counterpartyAccount: r.counterpartAccount } : {}),
    description: r.description,
    transfer: r.counterpartAccount !== undefined && own.has(r.counterpartAccount),
    ...(r.original ? { originalCurrency: r.original.currency } : {}),
  }));
}

describe.skipIf(!existsSync(questionsFile) || !existsSync(fixtures))("the family's questions as queries", () => {
  const { today, questions } = existsSync(questionsFile)
    ? (JSON.parse(readFileSync(questionsFile, "utf8")) as { today: string; questions: Question[] })
    : { today: "", questions: [] };
  const transactions = existsSync(fixtures) ? realTransactions() : [];

  it.each(questions.map((q) => [q.n, q] as const))("question %i is a valid reply and runs", (_, q) => {
    const reply = AskReply.parse(q.reply);
    const results = reply.steps.flatMap((step) =>
      step.kind === "transactions" ? [evaluateTransactionQuery(step, transactions, { today, currency: currency("NOK") })] : [],
    );
    if (q.answerableNow) {
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r.matched.length).toBeGreaterThan(0);
    }
  });
});
