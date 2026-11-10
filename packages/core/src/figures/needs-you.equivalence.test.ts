/**
 * The figures behind "needs you" are indexed so a pass stays in single-digit milliseconds at the family's
 * volume. Each indexed function must give exactly what the plain definition gives, so every function here
 * is checked against a brute-force reference written from the decision record, on generated households
 * that are full of the cases an index gets wrong: many identical rows, dates a day apart across month and
 * year ends and across a leap day, ties between candidates, rows on other accounts, rows one bank file
 * lists both, and counterparties that differ only by case.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type LocalDate, addDays, daysBetween } from "../dates.ts";
import type { Facts, ImportBatch, ImportRow, Rule, Transaction, Treatment } from "../facts.ts";
import { makeSplit } from "../facts.ts";
import { type ImportBatchId, type JobId, type RuleId, type TransactionId, importBatchId, importRowId, transactionId } from "../ids.ts";
import { nearMatches } from "../import/near-matches.ts";
import { transferCandidates, uniquePairs, unpairedSides } from "../import/transfers.ts";
import { type Money, money } from "../money.ts";
import { ruleOf, withRules } from "../rules/rule-fixtures.ts";
import { counterpartyKey, resolveRule, ruleResolver, splitByWeights, treatmentOfRule } from "../rules/resolve.ts";
import { type Precedent, bookedBefore, precedentsByCounterparty, sameAsLastTime } from "../rules/same-as-last-time.ts";
import { emptyChangeLog } from "../change-log.ts";
import { commit } from "../commands/apply.ts";
import { planImport } from "../import/plan.ts";
import { factsBuilder, kr, setAmount, testId } from "../testing/facts-builder.ts";
import { firstImport } from "../testing/first-import.ts";
import { today } from "../testing/synthetic-statement.ts";
import { type NeedsYouItem, needsYouItems } from "./needs-you.ts";

// ── The households ───────────────────────────────────────────────────────────

/** Runs of days that cross a month end, a year end, a leap day and the end of a century that is not a leap year. */
const windows = [
  ["2024-02-27", "2024-02-28", "2024-02-29", "2024-03-01", "2024-03-02", "2024-03-03"],
  ["2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03"],
  ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"],
  ["2100-02-27", "2100-02-28", "2100-03-01", "2100-03-02"],
  ["2026-04-28", "2026-04-29", "2026-04-30", "2026-05-01", "2026-05-02"],
] as const;
const dates = windows.flat();

/** Case, spacing and a no-break space differ, and the normalised text is the same for the first four. */
const descriptions = ["Kiwi Sentrum", "KIWI sentrum", "  kiwi   sentrum ", "Kiwi Sentrum", "Kiwi Sentrum 2", "Rema"] as const;
const counterparties = ["Kiwi", "kiwi ", "KIWI", "Rema 1000", "Vy"] as const;
const amounts = [-500, -500, -500, -500, 500, 500, -1_200, 0] as const;

const kinds = ["needsYou", "needsYou", "needsYou", "needsYou", "split", "split", "splitBack", "history", "income", "transferOpen", "transferPaired"] as const;

interface Spec {
  readonly account: 0 | 1 | 2;
  /** A day of the household's window of dates, wrapping if the window is shorter. */
  readonly day: number;
  readonly amount: number;
  readonly description: string;
  readonly counterparty: string | null;
  readonly kind: (typeof kinds)[number];
  readonly weights: readonly number[];
  /** Which files list the row as backing this transaction: two live, one undone, one the facts do not hold. */
  readonly files: readonly number[];
}

const spec: fc.Arbitrary<Spec> = fc.record({
  account: fc.constantFrom<0 | 1 | 2>(0, 0, 0, 1, 2),
  day: fc.integer({ min: 0, max: 5 }),
  amount: fc.constantFrom(...amounts),
  description: fc.constantFrom(...descriptions),
  counterparty: fc.option(fc.constantFrom(...counterparties), { nil: null }),
  kind: fc.constantFrom(...kinds),
  weights: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 2 }),
  files: fc.subarray([0, 1, 2, 3], { minLength: 0, maxLength: 3 }),
});

interface RuleSpec {
  readonly counterparty: string;
  readonly account: 0 | 1 | 2 | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly priority: number;
  readonly twoJobs: boolean;
}

const ruleSpec: fc.Arbitrary<RuleSpec> = fc.record({
  counterparty: fc.constantFrom(...counterparties),
  account: fc.option(fc.constantFrom<0 | 1 | 2>(0, 1, 2), { nil: null }),
  min: fc.option(fc.constantFrom(-1_000, -500, 0), { nil: null }),
  max: fc.option(fc.constantFrom(-500, 0, 1_000), { nil: null }),
  priority: fc.integer({ min: 0, max: 2 }),
  twoJobs: fc.boolean(),
});

/** All the rows of a household fall in one window of dates, so rows a day apart are common. */
const household = fc.record({ window: fc.integer({ min: 0, max: windows.length - 1 }), rows: fc.array(spec, { minLength: 2, maxLength: 36, size: "large" }), rules: fc.array(ruleSpec, { maxLength: 4 }) });

function build({ window = 0, rows, rules }: { readonly window?: number; readonly rows: readonly Spec[]; readonly rules: readonly RuleSpec[] }): Facts {
  const days = windows[window] as readonly string[];
  const dateOf = (row: Spec): LocalDate => days[row.day % days.length] as LocalDate;
  const b = factsBuilder({ planStart: "2023-12" });
  const accounts = [b.account({ name: "One" }), b.account({ name: "Two" }), b.account({ name: "Three", scope: "paidInto" })] as const;
  b.group();
  const jobs: readonly [JobId, JobId] = [b.spendJob({ name: "Food", plan: setAmount(kr(1)) }), b.spendJob({ name: "Fun", plan: setAmount(kr(1)) })];
  const base = b.facts();

  const batches: ImportBatch[] = [0, 1, 2].map((n) => ({
    id: importBatchId(testId(2_000 + n)),
    fileName: `file-${n}.csv`,
    fingerprint: String(n).padStart(64, "0"),
    format: "test",
    importedAt: `2026-11-0${n + 1}T09:00:00.000Z`,
    from: dates[0] as LocalDate,
    to: dates[0] as LocalDate,
    rows: 0,
    created: 0,
    matched: 0,
    pending: 0,
    undone: n === 2,
  }));
  const batchIds: readonly ImportBatchId[] = [...batches.map((batch) => batch.id), importBatchId(testId(2_099))];

  const transactions = new Map<TransactionId, Transaction>();
  const importRows = new Map<ImportRow["id"], ImportRow>();
  rows.forEach((row, i) => {
    const id = transactionId(testId(1_000 + i));
    const amount = money(row.amount);
    const treatmentFor = (): Treatment => {
      switch (row.kind) {
        case "needsYou":
          return { kind: "needsYou" };
        case "split":
          return makeSplit(amount, splitByWeights(amount, row.weights.length === 1 ? [{ jobId: jobs[0], weight: row.weights[0] as number }] : [{ jobId: jobs[0], weight: row.weights[0] as number }, { jobId: jobs[1], weight: row.weights[1] as number }]));
        case "splitBack":
          return makeSplit(amount, [{ jobId: jobs[0], amount: money(amount * 2) }, { jobId: jobs[1], amount: money(-amount) }]);
        case "history":
          return { kind: "history", jobId: null };
        case "income":
          return { kind: "income", fundsMonth: "2026-01" as never, source: "other" };
        case "transferOpen":
          return { kind: "transfer", partner: null };
        case "transferPaired":
          return { kind: "transfer", partner: transactionId(testId(1_000 + ((i + 1) % rows.length))) };
      }
    };
    transactions.set(id, {
      id,
      accountId: accounts[row.account],
      bookingDate: dateOf(row),
      amount,
      description: row.description,
      treatment: treatmentFor(),
      ...(row.counterparty === null ? {} : { counterparty: row.counterparty }),
    });
    row.files.forEach((file, k) => {
      const rowId = importRowId(testId(5_000 + i * 4 + k));
      importRows.set(rowId, {
        id: rowId,
        batchId: batchIds[file] as ImportBatchId,
        line: i + 1,
        accountId: accounts[row.account],
        bookingDate: dateOf(row),
        description: row.description,
        amount,
        fingerprint: `fp-${i}-${k}`,
        pending: false,
        backs: id,
      });
    });
  });
  const ruleRows = rules.map((r, n): Rule =>
    ruleOf({
      n,
      counterparty: r.counterparty,
      result: r.twoJobs ? { kind: "split", shares: [{ jobId: jobs[0], weight: 1 }, { jobId: jobs[1], weight: 2 }] } : { kind: "job", jobId: jobs[0] },
      priority: r.priority,
      ...(r.account === null ? {} : { accountId: accounts[r.account] }),
      ...(r.min === null ? {} : { min: money(r.min) }),
      ...(r.max === null ? {} : { max: money(r.max) }),
    }),
  );
  return withRules({ ...base, transactions, importRows, importBatches: new Map(batches.map((batch) => [batch.id, batch])) }, ...ruleRows);
}

const facts = household.map(build);

// ── The plain definitions ────────────────────────────────────────────────────

const normalise = (text: string): string => text.split(/\s+/).filter((part) => part !== "").join(" ").toLowerCase();

/** Per transaction, the live files that list a row backing it. */
function backing(f: Facts): Map<TransactionId, Set<ImportBatchId>> {
  const result = new Map<TransactionId, Set<ImportBatchId>>();
  for (const row of f.importRows.values()) {
    if (row.backs === null || f.importBatches.get(row.batchId)?.undone !== false) continue;
    result.set(row.backs, (result.get(row.backs) ?? new Set()).add(row.batchId));
  }
  return result;
}

const smallest = (ids: readonly TransactionId[]): TransactionId | undefined => ids.reduce<TransactionId | undefined>((best, id) => (best === undefined || id < best ? id : best), undefined);

function plainNearMatches(f: Facts): Map<TransactionId, TransactionId> {
  const files = backing(f);
  const matches = new Map<TransactionId, TransactionId>();
  for (const t of f.transactions.values()) {
    if (t.treatment.kind !== "needsYou") continue;
    const near = [...f.transactions.values()].filter(
      (u) =>
        u.accountId === t.accountId &&
        u.amount === t.amount &&
        normalise(u.description) === normalise(t.description) &&
        (u.bookingDate === addDays(t.bookingDate, -1) || u.bookingDate === addDays(t.bookingDate, 1)) &&
        ![...(files.get(t.id) ?? [])].some((file) => files.get(u.id)?.has(file)),
    );
    const first = smallest(near.map((u) => u.id));
    if (first !== undefined) matches.set(t.id, first);
  }
  return matches;
}

function plainUnpaired(f: Facts): Transaction[] {
  return [...f.transactions.values()].filter(
    (t) => (t.treatment.kind === "needsYou" || (t.treatment.kind === "transfer" && t.treatment.partner === null)) && f.accounts.get(t.accountId)?.scope === "shared",
  );
}

function plainCandidates(sides: readonly Transaction[], asking: readonly Transaction[]): Map<TransactionId, TransactionId[]> {
  const result = new Map<TransactionId, TransactionId[]>();
  for (const side of asking) {
    if (side.amount === 0) continue;
    const found = sides
      .filter((other) => other.amount === -side.amount && other.accountId !== side.accountId && Math.abs(daysBetween(side.bookingDate, other.bookingDate)) <= 3)
      .map((other) => other.id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (found.length > 0) result.set(side.id, found);
  }
  return result;
}

function plainSameAsLast(f: Facts): Map<TransactionId, { from: TransactionId; treatment: unknown }> {
  const result = new Map<TransactionId, { from: TransactionId; treatment: unknown }>();
  for (const t of f.transactions.values()) {
    if (t.treatment.kind !== "needsYou" || t.counterparty === undefined) continue;
    const key = counterpartyKey(t.counterparty);
    const usable = [...f.transactions.values()].flatMap((p) => {
      if (p.counterparty === undefined || counterpartyKey(p.counterparty) !== key || p.treatment.kind !== "split" || !bookedBefore(p, t)) return [];
      const { allocations } = p.treatment;
      if (allocations.some((a) => a.amount !== 0 && Math.sign(a.amount) !== Math.sign(p.amount)) || allocations.every((a) => a.amount === 0)) return [];
      return [{ p, allocations }];
    });
    const latest = usable.reduce<(typeof usable)[number] | undefined>((best, u) => (best === undefined || bookedBefore(best.p, u.p) ? u : best), undefined);
    if (latest === undefined) continue;
    const [first, ...rest] = latest.allocations;
    const share = (a: { jobId: JobId; amount: Money }) => ({ jobId: a.jobId, weight: Math.abs(a.amount) });
    result.set(t.id, { from: latest.p.id, treatment: { kind: "split", allocations: splitByWeights(t.amount, [share(first as never), ...rest.map(share)]) } });
  }
  return result;
}

/** Newest booking date first, then the smaller ID. */
const newestFirst = (a: Transaction, b: Transaction): number => (a.bookingDate !== b.bookingDate ? (a.bookingDate < b.bookingDate ? 1 : -1) : a.id < b.id ? -1 : 1);

function plainItems(f: Facts): NeedsYouItem[] {
  const near = plainNearMatches(f);
  const candidates = plainCandidates(plainUnpaired(f), plainUnpaired(f).filter((t) => t.treatment.kind === "needsYou"));
  const last = plainSameAsLast(f);
  const dropped = new Set<TransactionId>();
  const kept = new Set<TransactionId>();
  return [...f.transactions.values()]
    .filter((t) => t.treatment.kind === "needsYou")
    .sort(newestFirst)
    .map((transaction): NeedsYouItem => {
      const transferTo = candidates.get(transaction.id) ?? [];
      const setTreatment = (treatment: unknown, ruleId?: RuleId) => ({ kind: "setTreatment", transactionId: transaction.id, treatment, ...(ruleId === undefined ? {} : { ruleId }) }) as never;
      const rule = resolveRule(f.rules.values(), { accountId: transaction.accountId, counterparty: transaction.counterparty, amount: transaction.amount });
      if (rule !== null) return { transaction, suggestion: { kind: "rule", ruleId: rule.id, command: setTreatment(treatmentOfRule(rule, transaction.amount), rule.id) }, transferCandidates: transferTo };
      const keep = near.get(transaction.id);
      if (keep !== undefined && !dropped.has(keep) && !kept.has(transaction.id)) {
        dropped.add(transaction.id);
        kept.add(keep);
        return { transaction, suggestion: { kind: "merge", command: { kind: "mergeTransactions", keep, drop: transaction.id } }, transferCandidates: transferTo };
      }
      const same = last.get(transaction.id);
      return { transaction, suggestion: same === undefined ? null : { kind: "sameAsLast", from: same.from, command: setTreatment(same.treatment) as never }, transferCandidates: transferTo };
    });
}

// ── The checks ───────────────────────────────────────────────────────────────

/** Counts what a run of generated households covered, so a property cannot pass by never meeting its case. */
function covered() {
  return { nearMatches: 0, severalNear: 0, backingDecides: 0, candidates: 0, severalCandidates: 0, edgeOfWindow: 0, sameAsLast: 0, rules: 0, merges: 0, mergeBlocked: 0 };
}

describe("the needs-you figures equal their plain definitions", () => {
  it("near matches: same account, amount and description, a day apart, the smallest ID, never two rows of one live file", () => {
    const seen = covered();
    fc.assert(
      fc.property(facts, (f) => {
        const expected = plainNearMatches(f);
        const actual = nearMatches(f);
        expect([...actual]).toEqual([...expected]);
        seen.nearMatches += expected.size;
        const withoutFiles = plainNearMatches({ ...f, importRows: new Map() });
        if ([...withoutFiles].some(([id, other]) => expected.get(id) !== other)) seen.backingDecides += 1;
        for (const t of f.transactions.values()) {
          const near = [...f.transactions.values()].filter((u) => u.accountId === t.accountId && u.amount === t.amount && normalise(u.description) === normalise(t.description) && Math.abs(daysBetween(t.bookingDate, u.bookingDate)) === 1);
          if (t.treatment.kind === "needsYou" && near.length > 1) seen.severalNear += 1;
        }
      }),
      { numRuns: 400 },
    );
    expect(seen.nearMatches).toBeGreaterThan(50);
    expect(seen.severalNear).toBeGreaterThan(20);
    expect(seen.backingDecides).toBeGreaterThan(5);
  });

  it("transfer candidates: another shared account, the opposite amount, within 3 days, in ID order", () => {
    const seen = covered();
    fc.assert(
      fc.property(facts, (f) => {
        const sides = plainUnpaired(f);
        expect(unpairedSides(f).map((t) => t.id)).toEqual(sides.map((t) => t.id));
        const everyone = plainCandidates(sides, sides);
        expect([...transferCandidates(f)]).toEqual([...everyone]);
        const waiting = plainCandidates(sides, sides.filter((t) => t.treatment.kind === "needsYou"));
        expect([...transferCandidates(f, "waiting")]).toEqual([...waiting]);
        seen.candidates += everyone.size;
        for (const found of everyone.values()) if (found.length > 1) seen.severalCandidates += 1;
        for (const [id, found] of everyone) {
          const side = f.transactions.get(id) as Transaction;
          if (found.some((other) => Math.abs(daysBetween(side.bookingDate, (f.transactions.get(other) as Transaction).bookingDate)) === 3)) seen.edgeOfWindow += 1;
        }
      }),
      { numRuns: 400 },
    );
    expect(seen.candidates).toBeGreaterThan(50);
    expect(seen.severalCandidates).toBeGreaterThan(10);
    expect(seen.edgeOfWindow).toBeGreaterThan(10);
  });

  it("the pairs an import makes: a side whose only candidate has it as its only candidate", () => {
    fc.assert(
      fc.property(facts, fc.nat(), (f, seed) => {
        const pool = unpairedSides(f);
        const first = pool.filter((_, i) => (i + seed) % 2 === 0).map((t) => t.id);
        const pairable = new Set(pool.filter((_, i) => (i + seed) % 3 !== 0).map((t) => t.id));
        const candidates = plainCandidates(pool, pool);
        const paired = new Set<TransactionId>();
        const expected: (readonly [TransactionId, TransactionId])[] = [];
        for (const self of first) {
          const [other, ...more] = candidates.get(self) ?? [];
          if (other === undefined || more.length > 0 || candidates.get(other)?.length !== 1) continue;
          if (!pairable.has(self) || !pairable.has(other) || paired.has(self) || paired.has(other)) continue;
          paired.add(self).add(other);
          expected.push([self, other]);
        }
        expect(uniquePairs(pool, first, pairable)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it("same as last time: the latest earlier split from the same counterparty, scaled to the new amount", () => {
    const seen = covered();
    fc.assert(
      fc.property(facts, (f) => {
        const expected = plainSameAsLast(f);
        expect([...sameAsLastTime(f)]).toEqual([...expected]);
        seen.sameAsLast += expected.size;
      }),
      { numRuns: 400 },
    );
    expect(seen.sameAsLast).toBeGreaterThan(50);
  });

  it("precedents by counterparty: the usable splits, oldest first, for every counterparty or only those asked for", () => {
    fc.assert(
      fc.property(facts, fc.subarray([...counterparties.map(counterpartyKey)]), (f, only) => {
        const all = precedentsByCounterparty(f.transactions.values());
        const asked = precedentsByCounterparty(f.transactions.values(), new Set(only));
        const plain = new Map<string, Precedent[]>();
        for (const t of f.transactions.values()) {
          if (t.counterparty === undefined || t.treatment.kind !== "split") continue;
          const usable = !t.treatment.allocations.some((a) => a.amount !== 0 && Math.sign(a.amount) !== Math.sign(t.amount)) && !t.treatment.allocations.every((a) => a.amount === 0);
          if (!usable) continue;
          const key = counterpartyKey(t.counterparty);
          plain.set(key, [...(plain.get(key) ?? []), { transaction: t } as Precedent]);
        }
        const ordered = (map: ReadonlyMap<string, readonly Precedent[]>) => [...map].map(([key, list]) => [key, list.map((p) => p.transaction.id)] as const).sort(([a], [b]) => (a < b ? -1 : 1));
        const expected = ordered(new Map([...plain].map(([key, list]) => [key, [...list].sort((a, b) => (bookedBefore(a.transaction, b.transaction) ? -1 : 1))])));
        expect([...all.keys()]).toEqual([...plain.keys()]);
        expect([...asked.keys()]).toEqual([...plain.keys()].filter((key) => only.includes(key)));
        expect(ordered(all)).toEqual(expected);
        expect(ordered(asked)).toEqual(expected.filter(([key]) => only.includes(key)));
      }),
      { numRuns: 300 },
    );
  });

  it("rules: the resolver for many probes picks what resolving each probe against all the rules picks", () => {
    const seen = covered();
    fc.assert(
      fc.property(facts, (f) => {
        const resolve = ruleResolver(f.rules.values());
        for (const t of f.transactions.values()) {
          const probe = { accountId: t.accountId, counterparty: t.counterparty, amount: t.amount };
          const expected = resolveRule(f.rules.values(), probe);
          expect(resolve(t)).toBe(expected);
          if (expected !== null) seen.rules += 1;
        }
      }),
      { numRuns: 300 },
    );
    expect(seen.rules).toBeGreaterThan(50);
  });

  it("the whole list: newest first, with the rule, then the merge, then the same-as-last suggestion", () => {
    const seen = covered();
    fc.assert(
      fc.property(facts, (f) => {
        const actual = needsYouItems(f);
        expect(actual).toEqual(plainItems(f));
        for (const item of actual) {
          if (item.suggestion?.kind === "merge") seen.merges += 1;
          if (item.suggestion?.kind === "rule") seen.rules += 1;
          if (item.suggestion?.kind === "sameAsLast") seen.sameAsLast += 1;
        }
        const near = plainNearMatches(f);
        if (actual.filter((i) => near.has(i.transaction.id)).some((i) => i.suggestion?.kind !== "merge" && i.suggestion?.kind !== "rule")) seen.mergeBlocked += 1;
      }),
      { numRuns: 500 },
    );
    expect(seen.merges).toBeGreaterThan(30);
    expect(seen.rules).toBeGreaterThan(30);
    expect(seen.sameAsLast).toBeGreaterThan(30);
    expect(seen.mergeBlocked).toBeGreaterThan(5);
  });

  it("gives the same lists whatever order the transactions and rules are held in", () => {
    fc.assert(
      fc.property(facts, (f) => {
        const reversed: Facts = { ...f, transactions: new Map([...f.transactions].reverse()), rules: new Map([...f.rules].reverse()), importRows: new Map([...f.importRows].reverse()) };
        expect(needsYouItems(reversed)).toEqual(needsYouItems(f));
        expect(new Map(nearMatches(reversed))).toEqual(new Map(nearMatches(f)));
        expect(new Map(transferCandidates(reversed))).toEqual(new Map(transferCandidates(f)));
      }),
      { numRuns: 300 },
    );
  });
});

describe("the shape of the family's first import", () => {
  it("lists what the plain definitions list: pairs, rows repeated 2 to 4 times, and rules", () => {
    const scenario = firstImport({ rows: 1_500, pairs: 250, repeatGroups: 30 });
    const plan = planImport(scenario.facts, scenario.file, scenario.input());
    if (!plan.ok) throw new Error(`blocked: ${plan.blocked.kind}`);
    const done = commit(scenario.facts, emptyChangeLog(), plan.command, { id: "00000000-0000-7000-8000-00000000f001" as never, at: "2026-11-09T10:00:00.000Z", by: { kind: "family" } }, { asOf: today });
    if (!done.ok) throw new Error(`refused: ${done.refusal.code}`);
    const items = needsYouItems(done.facts);
    expect(items.length).toBeGreaterThan(300);
    expect(items.some((i) => i.transferCandidates.length > 1)).toBe(true);
    expect(items).toEqual(plainItems(done.facts));
  });
});

describe("a day apart", () => {
  const pair = (a: string, b: string): Facts => {
    const f = build({ rows: [], rules: [] });
    const make = (n: number, date: string): Transaction => ({ id: transactionId(testId(1_000 + n)), accountId: [...f.accounts.keys()][0] as never, bookingDate: date as LocalDate, amount: money(-500), description: "Kiwi", treatment: { kind: "needsYou" } });
    return { ...f, transactions: new Map([make(0, a), make(1, b)].map((t) => [t.id, t])) };
  };

  it.each([
    ["2024-02-28", "2024-02-29", true],
    ["2024-02-29", "2024-03-01", true],
    ["2024-02-28", "2024-03-01", false],
    ["2026-02-28", "2026-03-01", true],
    ["2026-02-27", "2026-03-01", false],
    ["2100-02-28", "2100-03-01", true],
    ["2025-12-31", "2026-01-01", true],
    ["2026-04-30", "2026-05-01", true],
    ["2026-04-30", "2026-04-30", false],
    ["2026-04-29", "2026-05-01", false],
  ])("%s and %s are a near match: %s", (a, b, near) => {
    expect(nearMatches(pair(a, b)).size).toBe(near ? 2 : 0);
  });

  it("is not a different transaction when the description differs only by case and spacing", () => {
    const f = pair("2026-03-01", "2026-03-02");
    const [first, second] = [...f.transactions.values()] as [Transaction, Transaction];
    const respelled: Facts = { ...f, transactions: new Map([[first.id, first], [second.id, { ...second, description: "  KIWI " }]]) };
    expect(nearMatches(respelled).size).toBe(2);
    expect(nearMatches({ ...f, transactions: new Map([[first.id, first], [second.id, { ...second, description: "Kiwi 2" }]]) }).size).toBe(0);
  });
});
