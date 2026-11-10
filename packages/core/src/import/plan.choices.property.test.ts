import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { apply } from "../commands/apply.ts";
import type { TreatmentInput } from "../commands/transactions.ts";
import { month } from "../dates.ts";
import type { Facts, ImportRow, Transaction } from "../facts.ts";
import type { JobId } from "../ids.ts";
import { money } from "../money.ts";
import { type ImportScenario, arbitraryImportScenario } from "../testing/arbitrary-import.ts";
import { importInput, today } from "../testing/synthetic-statement.ts";
import { type ImportChoice, type ImportPlan, planImport } from "./plan.ts";
import type { StatementFile } from "./statement.ts";

const runs = { numRuns: 300 };
const planStartDate = "2026-10-01";

const pick = fc.record({
  at: fc.nat(),
  kind: fc.constantFrom("job", "job", "job", "job", "two", "needsYou", "broken", "income"),
  job: fc.constantFrom(0, 0, 0, 0, 1, 2),
});
type Pick = typeof pick extends fc.Arbitrary<infer P> ? P : never;

const anyPicks = fc.array(pick, { maxLength: 60 });
const validPicks = anyPicks.map((list) => list.filter((p) => p.kind !== "broken" && p.kind !== "income"));

/** Choices for lines of the file. `broken` does not add up and `income` is a kind a choice can't be. */
function choicesFor(facts: Facts, file: StatementFile, list: readonly Pick[]): ImportChoice[] {
  const jobs = [...facts.jobs.keys()];
  const jobAt = (n: number): JobId => jobs[n % jobs.length] as JobId;
  return list.flatMap((p): ImportChoice[] => {
    const row = file.rows[p.at % file.rows.length];
    if (row === undefined) return [];
    const { line, amount } = row;
    const first = money(Math.trunc(amount / 2));
    const treatments: Record<Pick["kind"], TreatmentInput> = {
      job: { kind: "split", allocations: [{ jobId: jobAt(p.job), amount }] },
      two: { kind: "split", allocations: [{ jobId: jobAt(p.job), amount: first }, { jobId: jobAt(p.job + 1), amount: money(amount - first) }] },
      needsYou: { kind: "needsYou" },
      broken: { kind: "split", allocations: [{ jobId: jobAt(p.job), amount: money(amount + 1) }] },
      income: { kind: "income", fundsMonth: month("2026-12"), source: "other" },
    };
    return [{ line, treatment: treatments[p.kind] }];
  });
}

/** The treatment each line gets from its choices: the later choice for a line wins. */
const lastChoices = (choices: readonly ImportChoice[]): Map<number, TreatmentInput> => new Map(choices.map((c) => [c.line, c.treatment]));

interface Step {
  readonly plan: ImportPlan;
  readonly before: Facts;
  readonly after: Facts;
  /** The rows the import adds, and the transactions it creates. */
  readonly rows: readonly ImportRow[];
  readonly created: readonly Transaction[];
}

function run(facts: Facts, file: StatementFile, start: number, choices: readonly ImportChoice[], suggest: boolean): Step {
  const plan = planImport(facts, file, { ...importInput(`file-${start}`, start), choices, suggest });
  if (!plan.ok) return { plan, before: facts, after: facts, rows: [], created: [] };
  const result = apply(facts, plan.command, { asOf: today });
  if (!result.ok) throw new Error(result.refusal.code);
  const inserted = <T extends "importRows" | "transactions">(table: T) => result.patch.flatMap((c) => (c.table === table && c.before === null && c.after !== null ? [c.after] : []));
  return { plan, before: facts, after: result.facts, rows: inserted("importRows") as ImportRow[], created: inserted("transactions") as Transaction[] };
}

/** Imports both files in turn, each with its own choices, so the second file sees what the first decided. */
function importTwice(s: ImportScenario, choices: readonly [readonly ImportChoice[], readonly ImportChoice[]], suggest: boolean): [Step, Step] {
  const first = run(s.facts, s.files[0], 10_000, choices[0], suggest);
  return [first, run(first.after, s.files[1], 20_000, choices[1], suggest)];
}

const makesTransaction = (row: ImportRow): boolean => row.backs !== null && (row.id as string) === row.backs;

/** Whether the first file is decided line by line, so the second file has a history to suggest from. */
const scenarioWithChoices = fc.tuple(arbitraryImportScenario(), validPicks, validPicks, fc.boolean(), fc.boolean());

function chosenFor(s: ImportScenario, p0: readonly Pick[], p1: readonly Pick[], decideFirst: boolean): [ImportChoice[], ImportChoice[]] {
  const jobs = [...s.facts.jobs.keys()];
  const everyLine = s.files[0].rows.map((row, i): ImportChoice => ({ line: row.line, treatment: { kind: "split", allocations: [{ jobId: jobs[i % 5 === 0 ? 0 : 1] as JobId, amount: row.amount }] } }));
  return [decideFirst ? everyLine : choicesFor(s.facts, s.files[0], p0), choicesFor(s.facts, s.files[1], p1)];
}

describe("importing with choices and suggestions, as properties", () => {
  it("creates exactly the treatments the preview showed, in its lines and in its counts", () => {
    fc.assert(
      fc.property(scenarioWithChoices, ([s, p0, p1, suggest, decideFirst]) => {
        for (const step of importTwice(s, chosenFor(s, p0, p1, decideFirst), suggest)) {
          if (!step.plan.ok) continue;
          const { preview } = step.plan;
          for (const line of preview.sample) expect(step.after.transactions.get(line.transactionId)?.treatment).toEqual(line.treatment);
          const kinds = step.created.map((t) => step.after.transactions.get(t.id)?.treatment.kind);
          const count = (kind: string) => kinds.filter((k) => k === kind).length;
          const { counts } = preview;
          expect([count("history"), count("transfer"), count("needsYou"), count("split")]).toEqual([counts.history, counts.transfers, counts.needsYou, counts.byRule + counts.suggested + counts.chosen]);
          expect(counts.created).toBe(step.created.length);
        }
      }),
      runs,
    );
  });

  it("gives a line you chose for that choice, and nothing else, from the plan start on, and the one job before it", () => {
    let applied = 0;
    fc.assert(
      fc.property(scenarioWithChoices, ([s, p0, p1, suggest, decideFirst]) => {
        const chosen = chosenFor(s, p0, p1, decideFirst);
        importTwice(s, chosen, suggest).forEach((step, n) => {
          const choices = lastChoices(chosen[n] ?? []);
          for (const row of step.rows) {
            const choice = choices.get(row.line);
            const made = row.backs === null ? undefined : step.after.transactions.get(row.backs);
            if (choice === undefined || made === undefined || !makesTransaction(row)) continue;
            if (row.bookingDate >= planStartDate) {
              expect(made.treatment).toEqual(choice);
              applied += 1;
            } else if (choice.kind === "split" && choice.allocations.length === 1) {
              expect(made.treatment).toEqual({ kind: "history", jobId: choice.allocations[0].jobId });
              applied += 1;
            }
          }
        });
      }),
      runs,
    );
    expect(applied).toBeGreaterThan(100);
  });

  it("applies no same-as-last-time treatment when suggestions are off, and does when they are on", () => {
    let suggestedWhenOn = 0;
    fc.assert(
      fc.property(scenarioWithChoices, ([s, p0, p1, , decideFirst]) => {
        const chosen = chosenFor(s, p0, p1, decideFirst);
        for (const step of importTwice(s, chosen, false)) {
          if (!step.plan.ok) continue;
          expect(step.plan.preview.counts.suggested).toBe(0);
          for (const line of step.plan.preview.sample) expect(["sameAsLast", "priceChange"]).not.toContain(line.why.kind);
        }
        for (const step of importTwice(s, chosen, true)) if (step.plan.ok) suggestedWhenOn += step.plan.preview.counts.suggested;
      }),
      { numRuns: 600 },
    );
    expect(suggestedWhenOn).toBeGreaterThan(30);
  });

  it("refuses the import exactly when a choice for a line that makes a transaction can't be given, naming the first such line", () => {
    let refused = 0;
    let imported = 0;
    fc.assert(
      fc.property(fc.tuple(arbitraryImportScenario(), anyPicks), ([s, list]) => {
        const file = s.files[0];
        const choices = choicesFor(s.facts, file, list);
        const baseline = run(s.facts, file, 10_000, [], true);
        if (!baseline.plan.ok) return;
        const makes = new Set(baseline.rows.filter(makesTransaction).map((r) => r.line));
        const bad = [...lastChoices(choices)].filter(([line, t]) => makes.has(line) && t.kind !== "needsYou" && (t.kind !== "split" || t.allocations.reduce((sum, a) => sum + a.amount, 0) !== file.rows.find((r) => r.line === line)?.amount));
        const plan = planImport(s.facts, file, { ...importInput("file", 10_000), choices });
        if (bad.length === 0) {
          expect(plan.ok).toBe(true);
          imported += 1;
        } else {
          expect(plan).toEqual({ ok: false, blocked: { kind: "badChoice", line: Math.min(...bad.map(([line]) => line)) } });
          refused += 1;
        }
      }),
      runs,
    );
    expect(refused).toBeGreaterThan(30);
    expect(imported).toBeGreaterThan(30);
  });

  it("lists as ignored exactly the choices that gave no transaction its treatment, and leaves transactions already there alone", () => {
    fc.assert(
      fc.property(scenarioWithChoices, ([s, p0, p1, suggest, decideFirst]) => {
        const chosen = chosenFor(s, p0, p1, decideFirst);
        importTwice(s, chosen, suggest).forEach((step, n) => {
          if (!step.plan.ok) return;
          const rowsByLine = new Map(step.rows.map((r) => [r.line, r]));
          const unused = [...lastChoices(chosen[n] ?? [])]
            .filter(([line, t]) => {
              const row = rowsByLine.get(line);
              if (row === undefined || !makesTransaction(row)) return true;
              return row.bookingDate < planStartDate && !(t.kind === "split" && t.allocations.length === 1);
            })
            .map(([line]) => line)
            .sort((a, b) => a - b);
          expect(step.plan.preview.ignoredChoices).toEqual(unused);
          const paired = new Set(step.plan.preview.transfers.flatMap((t) => [t.outgoing, t.incoming]));
          for (const [id, t] of step.before.transactions) if (!paired.has(id)) expect(step.after.transactions.get(id)).toEqual(t);
        });
      }),
      runs,
    );
  });

  it("plans the same way every time for the same file, choices and suggestions", () => {
    fc.assert(
      fc.property(scenarioWithChoices, ([s, p0, , suggest]) => {
        const choices = choicesFor(s.facts, s.files[0], p0);
        const again = () => planImport(s.facts, s.files[0], { ...importInput("x", 10_000), choices, suggest });
        expect(again()).toEqual(again());
      }),
      runs,
    );
  });
});
