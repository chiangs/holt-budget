// Estimates how often Holt as a whole would suggest the family's own job: "same as last time" first, using only the
// family's other labels (leaving the row itself out), and the model's saved answer only where that finds nothing.
//   node tools/eval/pipeline.ts private/eval/<run>.json
import { readFileSync } from "node:fs";
import { householdTransactions } from "./household-data.ts";

const run = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
  model: string;
  categoriseBatch: { mistakes: { id: string; got: string | null }[] };
};
const labelled = householdTransactions().filter((t) => t.jobFrom === "label" && t.job !== "Unsure" && t.job !== "Split");
const modelWrong = new Map(run.categoriseBatch.mistakes.map((m) => [m.id, m.got]));
let byPayee = 0, payeeRight = 0, byModel = 0, modelRight = 0;
for (const t of labelled) {
  const others = new Set(labelled.filter((o) => o.id !== t.id && o.counterparty === t.counterparty).map((o) => o.job));
  if (others.size === 1) {
    byPayee++;
    if ([...others][0] === t.job) payeeRight++;
  } else {
    byModel++;
    if (!modelWrong.has(t.id)) modelRight++;
  }
}
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`${run.model}: ${labelled.length} labelled rows`);
console.log(`  same as last time: ${byPayee} rows, ${pct(payeeRight, byPayee)} right`);
console.log(`  the model:         ${byModel} rows, ${pct(modelRight, byModel)} right`);
console.log(`  Holt as a whole:   ${pct(payeeRight + modelRight, labelled.length)} right`);
