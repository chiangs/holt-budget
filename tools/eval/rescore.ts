// Spike S3: scores the saved Ask replies again, after a fix to the scoring or to the expected replies, without running the models.
//   node tools/eval/rescore.ts private/eval/*.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AskReply, currency } from "@holt/core";
import { householdTransactions, privateFolder } from "./household-data.ts";
import { sameReply } from "./score.ts";

const { today, questions } = JSON.parse(readFileSync(join(privateFolder, "questions.json"), "utf8")) as {
  today: string;
  questions: { n: number; reply: unknown; alternatives?: unknown[] }[];
};
const transactions = householdTransactions();
const context = { today, currency: currency("NOK") };
for (const file of process.argv.slice(2)) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  for (const r of run.ask.results) {
    const q = questions.find((x) => x.n === r.n)!;
    const parsed = AskReply.safeParse(r.reply);
    r.correct = parsed.success && [q.reply, ...(q.alternatives ?? [])].some((e) => sameReply(parsed.data.steps, AskReply.parse(e).steps, transactions, context));
  }
  run.ask.correctRate = run.ask.results.filter((r: { correct: boolean }) => r.correct).length / run.ask.results.length;
  writeFileSync(file, JSON.stringify(run, null, 2));
  console.log(`${file}: ask ${(run.ask.correctRate * 100).toFixed(1)}% correct`);
}
