// Benchmarks a local model on the household's own data (technical-decisions.md §12, decisions 0039 and 0045):
// suggesting jobs, turning questions into Ask queries, and drafting the monthly review. It writes the scores and
// every reply to private/eval/, and prints them beside the baseline, so a new model can be judged before switching.
//   pnpm eval <model> [--runtime ollama|llama-server|llmster] [--set-baseline]
// The model must already be available in the runtime, for example with `ollama pull <model>`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AskReply, type Step, askReplyJsonSchema, currency } from "@holt/core";
import { householdTransactions, privateFolder } from "./household-data.ts";
import { sameReply } from "./score.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const setBaseline = args.includes("--set-baseline");
const runtimeName = option("--runtime") ?? "ollama";
const model = args.find((a) => !a.startsWith("--"));
const runtimes = {
  // Each runtime turns thinking off its own way (decision 0045).
  ollama: { url: "http://127.0.0.1:11434/v1/chat/completions", thinkingOff: { reasoning_effort: "none" } },
  "llama-server": { url: "http://127.0.0.1:8080/v1/chat/completions", thinkingOff: { chat_template_kwargs: { enable_thinking: false } } },
  llmster: { url: "http://127.0.0.1:1234/v1/chat/completions", thinkingOff: { reasoning_effort: "none" } },
} as const;
if (!(model && runtimeName in runtimes)) {
  console.error("Usage: pnpm eval <model> [--runtime ollama|llama-server|llmster] [--set-baseline]");
  process.exit(1);
}
const evalFolder = join(privateFolder, "eval");
const baselineFile = join(evalFolder, "baseline.json");
const outFile = join(evalFolder, `${new Date().toISOString().slice(0, 10)}-${runtimeName}-${model.replace(/[^\w.-]+/g, "_")}.json`);
const runtime = runtimes[runtimeName as keyof typeof runtimes];
const prompt = (name: string) => readFileSync(join(import.meta.dirname, "prompts", `${name}.md`), "utf8");
const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? "");

// ── The model client: loopback only, JSON schema constrained, thinking off ──
interface Call {
  content: string;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  finish: string;
}
async function chat(messages: { role: "user" | "assistant"; content: string }[], name: string, schema: object, maxTokens: number): Promise<Call> {
  const url = new URL(runtime.url);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") throw new Error(`Refusing a non-loopback address: ${url.hostname}`);
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_schema", json_schema: { name, schema, strict: true } },
      ...runtime.thinkingOff,
    }),
  });
  const body = (await response.json()) as {
    choices?: { message: { content: string | null }; finish_reason: string }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
    error?: unknown;
  };
  const ms = performance.now() - started;
  if (!response.ok || !body.choices?.[0]) throw new Error(`The runtime said ${response.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  return {
    content: body.choices[0].message.content ?? "",
    ms,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
    finish: body.choices[0].finish_reason,
  };
}
const calls: (Call & { task: string })[] = [];
async function call(task: string, ...args: Parameters<typeof chat>): Promise<Call> {
  const c = await chat(...args);
  calls.push({ task, ...c });
  return c;
}
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ── The household's data ──
const transactions = householdTransactions();
const jobsTable = readFileSync(join(privateFolder, "jobs.md"), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("|"))
  .map((l) => l.split("|").map((c) => c.trim()))
  .filter((c) => c[1] && c[1] !== "Job" && !/^-+$/.test(c[1]));
const jobNames = jobsTable.map((c) => c[1]!);
const jobList = jobsTable.map((c) => `- ${c[1]}: ${c[2]}`).join("\n");

// ── Task 1: suggest a job ──
const answers = [...jobNames, "Income", "Transfer"];
const labelled = transactions.filter((t) => t.jobFrom === "label" && answers.includes(t.job!));
const payeeCounts = new Map<string, number>();
for (const t of labelled) payeeCounts.set(t.counterparty, (payeeCounts.get(t.counterparty) ?? 0) + 1);
const kr = (ore: number) => `${(ore / 100).toFixed(2).replace(".", ",")} kr`;

async function categorise(batchSize: number) {
  const results: { id: string; expected: string; got: string | null; seenOnce: boolean }[] = [];
  let validJson = 0;
  let batches = 0;
  for (let start = 0; start < labelled.length; start += batchSize) {
    const batch = labelled.slice(start, start + batchSize);
    const schema = {
      type: "object",
      properties: {
        results: {
          type: "array",
          minItems: batch.length,
          maxItems: batch.length,
          items: { type: "object", properties: { n: { type: "integer" }, job: { type: "string", enum: answers } }, required: ["n", "job"] },
        },
      },
      required: ["results"],
    };
    const lines = batch.map((t, i) => `${i + 1}. ${t.bookingDate} | ${t.account} | ${kr(t.amount)} | ${t.counterparty} | ${t.description}`).join("\n");
    const c = await call(`categorise-${batchSize}`, [{ role: "user", content: fill(prompt("categorise"), { jobs: jobList, transactions: lines }) }], "jobs", schema, 60 * batch.length + 50);
    batches++;
    const reply = parseJson(c.content) as { results?: { n: number; job: string }[] } | undefined;
    if (reply?.results) validJson++;
    batch.forEach((t, i) => {
      const got = reply?.results?.find((r) => r.n === i + 1)?.job ?? null;
      results.push({ id: t.id, expected: t.job!, got, seenOnce: payeeCounts.get(t.counterparty) === 1 });
    });
  }
  const accuracy = (rows: typeof results) => (rows.length === 0 ? null : rows.filter((r) => r.got === r.expected).length / rows.length);
  return {
    batchSize,
    transactions: results.length,
    validJsonRate: validJson / batches,
    accuracy: accuracy(results),
    accuracySeenOnce: accuracy(results.filter((r) => r.seenOnce)),
    seenOnce: results.filter((r) => r.seenOnce).length,
    mistakes: results.filter((r) => r.got !== r.expected),
  };
}

// ── Task 2: Ask ──
interface Question {
  n: number;
  question: string;
  reply: unknown;
  /** Other replies that answer the question as fairly, when it can be read two ways. */
  alternatives?: unknown[];
}
const questions = JSON.parse(readFileSync(join(privateFolder, "questions.json"), "utf8")) as { today: string; questions: Question[] };
const context = { today: questions.today, currency: currency("NOK") };
// The accounts Holt knows: those in the exports, and the loans whose balances the family enters by hand (spike S4).
const loanAccounts = (JSON.parse(readFileSync(join(privateFolder, "review-config.json"), "utf8")) as { loanAccounts?: string[] }).loanAccounts ?? [];
const accounts = [...new Set(transactions.map((t) => t.account))].filter((a) => !/^\d+$/.test(a)).concat(loanAccounts);
const askSchema = askReplyJsonSchema();
/** Right when it matches the expected reply, or one of the alternatives recorded for a question that can fairly be read two ways. */
function isCorrect(steps: Step[], q: Question): boolean {
  return [q.reply, ...(q.alternatives ?? [])].some((r) => sameReply(steps, AskReply.parse(r).steps, transactions, context));
}

async function ask() {
  const results = [];
  for (const q of questions.questions) {
    const c = await call("ask", [{ role: "user", content: fill(prompt("ask"), { today: questions.today, accounts: accounts.join(", "), jobs: jobNames.join(", "), question: q.question }) + `\n\nThe reply's JSON Schema:\n${JSON.stringify(askSchema)}` }], "ask_reply", askSchema, 600);
    const parsed = AskReply.safeParse(parseJson(c.content));
    results.push({ n: q.n, question: q.question, valid: parsed.success, correct: parsed.success && isCorrect(parsed.data.steps, q), reply: parsed.success ? parsed.data : c.content });
  }
  return {
    questions: results.length,
    validRate: results.filter((r) => r.valid).length / results.length,
    correctRate: results.filter((r) => r.correct).length / results.length,
    results,
  };
}

// ── Task 3: the monthly review ──
interface Figure {
  placeholder: string;
  value: string;
  how: string;
}
function check(draft: string, figures: Figure[]): string[] {
  const known = new Set(figures.map((f) => f.placeholder));
  const problems: string[] = [];
  for (const [, name] of draft.matchAll(/\{([^}]*)\}/g)) if (!known.has(name!)) problems.push(`{${name}} isn't one of the listed placeholders.`);
  const outside = draft.replace(/\{[^}]*\}/g, "");
  if (/\d/.test(outside)) problems.push(`There is a digit outside a placeholder: "${outside.match(/.{0,20}\d.{0,20}/)?.[0]}".`);
  return problems;
}
const numberIn = (text: string) => [...text.matchAll(/\d[\d,. ]*\d|\d/g)].map((m) => Number(m[0].replace(/[ ,.]/g, "")));
async function review() {
  const results = [];
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    const figures = JSON.parse(readFileSync(join(privateFolder, "reviews", `${month}.json`), "utf8")) as Figure[];
    const table = figures.map((f) => `{${f.placeholder}} = ${f.value} (${f.how})`).join("\n");
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: fill(prompt("review"), { month, figures: table }) }];
    const schema = { type: "object", properties: { draft: { type: "string" } }, required: ["draft"] };
    const first = await call("review", messages, "review", schema, 700);
    const firstDraft = (parseJson(first.content) as { draft?: string } | undefined)?.draft ?? "";
    const firstProblems = check(firstDraft, figures);
    let draft = firstDraft;
    let problems = firstProblems;
    if (problems.length > 0) {
      messages.push({ role: "assistant", content: first.content }, { role: "user", content: `The draft broke these rules:\n${problems.join("\n")}\nRewrite it so it follows every rule.` });
      const second = await call("review-retry", messages, "review", schema, 700);
      draft = (parseJson(second.content) as { draft?: string } | undefined)?.draft ?? "";
      problems = check(draft, figures);
    }
    // Which of the family's figures the draft covers: a figure counts as the family's when its amount appears in their draft.
    const family = readFileSync(join(privateFolder, "reviews", `${month}.md`), "utf8").split("## Your draft")[1] ?? "";
    const familyNumbers = new Set(numberIn(family));
    const familyFigures = figures.filter((f) => /kr$/.test(f.value) && familyNumbers.has(Math.abs(Number(f.value.replace(/[^\d]/g, ""))))).map((f) => f.placeholder);
    const used = new Set([...draft.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!));
    const values = new Map(figures.map((f) => [f.placeholder, f.value.replace(/^-/, "")]));
    results.push({
      month,
      passedFirstTime: firstProblems.length === 0,
      passed: problems.length === 0,
      problems,
      familyFigures,
      covered: familyFigures.filter((p) => used.has(p)),
      draft,
      filled: draft.replace(/\{([^}]*)\}/g, (m, p: string) => values.get(p) ?? m),
    });
  }
  return { months: results.length, firstTimeRate: results.filter((r) => r.passedFirstTime).length / results.length, results };
}

const started = new Date().toISOString();
const result = {
  runtime: runtimeName,
  model,
  started,
  categoriseBatch: await categorise(20),
  categoriseSingle: await categorise(1),
  ask: await ask(),
  review: await review(),
  latency: Object.fromEntries(
    [...new Set(calls.map((c) => c.task))].map((task) => {
      const own = calls.filter((c) => c.task === task);
      const ms = own.map((c) => c.ms).sort((a, b) => a - b);
      return [task, { calls: own.length, medianMs: Math.round(ms[Math.floor(ms.length / 2)]!), tokensPerSecond: Math.round(own.reduce((s, c) => s + c.completionTokens, 0) / (own.reduce((s, c) => s + c.ms, 0) / 1000)), promptTokensMax: Math.max(...own.map((c) => c.promptTokens)), truncated: own.filter((c) => c.finish === "length").length }];
    }),
  ),
};
mkdirSync(evalFolder, { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 2));

// The scores beside the baseline's.
type Scores = typeof result;
const percent = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(1)}%`);
const rows: [string, (r: Scores) => string][] = [
  ["Job, batches of 20", (r) => percent(r.categoriseBatch.accuracy)],
  ["Job, payees seen once", (r) => percent(r.categoriseBatch.accuracySeenOnce)],
  ["Job, one at a time", (r) => percent(r.categoriseSingle.accuracy)],
  ["Ask correct", (r) => `${r.ask.results.filter((x) => x.correct).length} of ${r.ask.questions}`],
  ["Reviews passing first time", (r) => `${r.review.results.filter((x) => x.passedFirstTime).length} of ${r.review.months}`],
  ["Median Ask reply", (r) => `${(r.latency["ask"]!.medianMs / 1000).toFixed(1)} s`],
  ["Median batch of 20", (r) => `${(r.latency["categorise-20"]!.medianMs / 1000).toFixed(1)} s`],
];
const baseline = existsSync(baselineFile) ? (JSON.parse(readFileSync(baselineFile, "utf8")) as Scores) : undefined;
const name = (r: Scores) => `${r.model} (${r.runtime})`;
console.log(`\n${"".padEnd(28)}${(baseline ? name(baseline) : "no baseline").padEnd(30)}${name(result)}`);
for (const [label, value] of rows) console.log(`${label.padEnd(28)}${(baseline ? value(baseline) : "").padEnd(30)}${value(result)}`);
console.log(`\nEvery reply is in ${outFile}. Read the review drafts there before deciding: the scores can't judge their wording.`);
if (setBaseline) {
  copyFileSync(outFile, baselineFile);
  console.log("This run is now the baseline. Record the change of model in a decision record (§12).");
}
