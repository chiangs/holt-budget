// Spike S3: works out the figures for the monthly review drafts from the real exports in private/fixtures/,
// one file per month in private/reviews/. Each figure has a placeholder name, the way the assistant's draft names it (§6).
// Figures that need a plan or account balances can't be worked out until Milestone 2; the files say so.
// Run: node tools/eval/make-review-figures.ts 2026-08 2026-09 2026-10
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type TransactionQuery, type Value, currency, evaluateTransactionQuery } from "@holt/core";
import { householdTransactions, root } from "./household-data.ts";

const fixtures = join(root, "private", "fixtures");
const outFolder = join(root, "private", "reviews");
const months = process.argv.slice(2);
if (!existsSync(fixtures) || !existsSync(join(root, "private", "review-config.json")) || months.length === 0 || months.some((m) => !/^\d{4}-\d{2}$/.test(m))) {
  console.error("Usage: make-review-figures.ts yyyy-mm [yyyy-mm…], with the exports in private/fixtures/ and the account details in private/review-config.json.");
  process.exit(1);
}

const transactions = householdTransactions();

const nok = currency("NOK");
const kr = (ore: number) => `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.round(ore / 100))} kr`;
const show = (v: Value) => (v.kind === "money" ? kr(v.amount) : String(v.count));
// Which accounts are savings, and which account pays the house loan: the household's own details, kept in private/.
const config = JSON.parse(readFileSync(join(root, "private", "review-config.json"), "utf8")) as {
  savingsAccounts: string[];
  loanPaymentAccount: string;
  /** Jobs whose monthly trend the review shows, alone or added together, with the short name their placeholders use. */
  trendJobs: { key: string; jobs: string[] }[];
};

const shiftMonth = (month: string, by: number) => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

type Row = [placeholder: string, value: string, how: string];

function figures(month: string): Row[] {
  const today = `${month}-28`;
  const run = (q: Omit<TransactionQuery, "kind">) => evaluateTransactionQuery({ kind: "transactions", ...q }, transactions, { today, currency: nok });
  const period = { type: "month", month } as const;
  const rows: Row[] = [];

  const moneyIn = run({ filter: { period, direction: "in", transfers: "exclude" }, measure: "sum" });
  const moneyOut = run({ filter: { period, direction: "out", transfers: "exclude" }, measure: "sum" });
  const net = (moneyIn.value.kind === "money" ? moneyIn.value.amount : 0) + (moneyOut.value.kind === "money" ? moneyOut.value.amount : 0);
  rows.push(["in.total", show(moneyIn.value), `Money in from outside your own accounts, ${moneyIn.matched.length} transactions`]);
  (run({ filter: { period, direction: "in", transfers: "exclude" }, measure: "sum", groupBy: "counterparty", top: 4 }).groups ?? []).forEach((g, i) =>
    rows.push([`in.source.${i + 1}`, show(g.value), `Money in from ${g.key}, ${g.transactions} transactions`], [`in.source.${i + 1}.name`, g.key, "Who the money came from"]),
  );
  rows.push(["out.total", show(moneyOut.value), `Money out to others, ${moneyOut.matched.length} transactions, moves between your own accounts left out`]);
  rows.push(["net", kr(net), "Money in plus money out"]);

  (run({ filter: { period, direction: "out", transfers: "exclude" }, measure: "sum", groupBy: "counterparty", top: 8 }).groups ?? []).forEach((g, i) =>
    rows.push([`out.payee.${i + 1}`, show(g.value), `Paid to ${g.key}, ${g.transactions} transactions`], [`out.payee.${i + 1}.name`, g.key, "Who was paid"]),
  );
  run({ filter: { period, direction: "out", transfers: "exclude" }, measure: "list", top: 5 }).matched.forEach((t, i) =>
    rows.push([`largest.${i + 1}`, kr(t.amount), `One payment to ${t.counterparty} on ${t.bookingDate}`], [`largest.${i + 1}.name`, t.counterparty, "Who was paid"]),
  );

  for (const account of config.savingsAccounts) {
    const r = run({ filter: { period, accounts: [account], transfers: "include" }, measure: "sum" });
    if (r.matched.length > 0) rows.push([`change.${account.toLowerCase()}`, show(r.value), `How much ${account} grew or shrank: everything in minus everything out, ${r.matched.length} transactions`]);
  }
  const loan = run({ filter: { period, counterparties: [config.loanPaymentAccount], direction: "out", transfers: "only" }, measure: "sum" });
  rows.push(["loan.paid", show(loan.value), "Moved to the SR-Bank account that pays the house loan"]);
  const interest = run({ filter: { period, text: ["KREDITRENTER"], direction: "in", transfers: "exclude" }, measure: "sum" });
  if (interest.matched.length > 0) rows.push(["interest", show(interest.value), "Interest the accounts earned"]);
  const abroad = run({ filter: { period, foreign: true, transfers: "exclude" }, measure: "sum" });
  if (abroad.matched.length > 0) rows.push(["abroad", show(abroad.value), `Purchases abroad, ${abroad.matched.length} transactions`]);

  // The trend for the jobs the family follows: this month, the two before it, and the average of the three before it.
  // Each month says how much of its spending has a job, so a gap is never shown as a complete figure.
  for (const m of [month, shiftMonth(month, -1), shiftMonth(month, -2), shiftMonth(month, -3)]) {
    const out = run({ filter: { period: { type: "month", month: m }, direction: "out", transfers: "exclude" }, measure: "list" }).matched;
    const without = out.filter((t) => t.job === undefined);
    const share = out.length === 0 ? 100 : Math.round((100 * (out.length - without.length)) / out.length);
    rows.push([`jobs-known.${m}`, `${share}%`, `Share of ${m}'s payments with a job (labelled, or the same payee labelled); ${without.length} without one, ${kr(without.reduce((sum, t) => sum + t.amount, 0))}`]);
  }
  for (const { key, jobs } of config.trendJobs) {
    const job = jobs.join(" and ");
    const jobRun = (p: TransactionQuery["filter"]["period"], measure: "sum" | "monthly-average") =>
      run({ filter: { period: p, jobs, transfers: "exclude" }, measure });
    rows.push([`${key}.this-month`, show(jobRun({ type: "month", month }, "sum").value), `${job} in ${month}`]);
    rows.push([`${key}.month-before`, show(jobRun({ type: "month", month: shiftMonth(month, -1) }, "sum").value), `${job} in ${shiftMonth(month, -1)}`]);
    rows.push([`${key}.two-months-before`, show(jobRun({ type: "month", month: shiftMonth(month, -2) }, "sum").value), `${job} in ${shiftMonth(month, -2)}`]);
    rows.push([`${key}.average`, show(jobRun({ type: "last-months", count: 3 }, "monthly-average").value), `${job}: monthly average of the three months before ${month}`]);
  }

  // Payees paid this month that you had never paid before, back to the start of the exports.
  const seenBefore = new Set(transactions.filter((t) => t.bookingDate < `${month}-01` && t.amount < 0).map((t) => t.counterparty));
  const newPayees = new Map<string, number>();
  for (const t of moneyOut.matched) if (!seenBefore.has(t.counterparty)) newPayees.set(t.counterparty, (newPayees.get(t.counterparty) ?? 0) + t.amount);
  [...newPayees].forEach(([name, amount], i) => rows.push([`new.${i + 1}`, kr(amount), `${name}: a payee you hadn't paid before`], [`new.${i + 1}.name`, name, "The new payee"]));
  return rows;
}

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
mkdirSync(outFolder, { recursive: true });
for (const month of months) {
  const file = join(outFolder, `${month}.md`);
  const rows = figures(month);
  // The same figures for the S3 bake-off, which gives them to the models.
  writeFileSync(join(outFolder, `${month}.json`), JSON.stringify(rows.map(([placeholder, value, how]) => ({ placeholder, value, how })), null, 2) + "\n");
  const table = rows.map(([p, v, h]) => `| \`{${p}}\` | ${v} | ${h} |`).join("\n");
  const draft = existsSync(file) ? readFileSync(file, "utf8").split("## Your draft")[1] : undefined;
  writeFileSync(
    file,
    `# Monthly review figures: ${monthName(month)}\n\n` +
      "Worked out by `tools/eval/make-review-figures.ts` from the exports in `private/fixtures/`. Amounts out are negative.\n\n" +
      "Not here yet, because they need a plan or account balances (Milestone 2): what each job was assigned, what's left or over, unassigned money, and the buffer's and accounts' balances. Spending per job comes once the labelling sheet is filled in, for the months it covers.\n\n" +
      `| Placeholder | Value | How the app worked it out |\n|---|---|---|\n${table}\n\n` +
      "## Your draft" +
      (draft ??
        "\n\nWrite a few sentences the way you'd want the assistant to put this month: what stood out, what changed, what to decide. Use the figures above. Plain numbers are fine; Holt turns them into placeholders for the comparison.\n"),
  );
  console.log(`Wrote ${file}`);
}
