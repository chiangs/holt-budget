/**
 * Random households for property tests: a few shared accounts and one paid-into account, jobs of every
 * kind and status, the first six months of 2026 in random states with random assignments, transactions
 * with every treatment from December 2025 on, moves, and a buffer-months setting. `withMore` builds the
 * same household again with extra rows, so a property can compare the figures before and after.
 * `arbitraryFacts` is the same household with every table and every optional field filled in some of the
 * time: account numbers and import rhythms, transaction details, import batches with their rows, rules,
 * people, contribution agreements, bucket transfers and the agreement an income names.
 */

import fc from "fast-check";
import { accountNumber } from "../account-number.ts";
import { type LocalDate, type Month, addMonths, localDate, month } from "../dates.ts";
import type {
  Account,
  BucketTransfer,
  BudgetMonthState,
  ContributionAgreement,
  Facts,
  ImportBatch,
  ImportRhythm,
  ImportRow,
  Person,
  Rule,
  RuleOrigin,
  RuleResult,
  Transaction,
} from "../facts.ts";
import { type AccountId, type AgreementId, type JobId, type TransactionId, agreementId, bucketTransferId, importBatchId, importRowId, personId, ruleId } from "../ids.ts";
import { type Money, money } from "../money.ts";
import { type FactsBuilder, amountByMonth, evenOut, factsBuilder, followBills, kr, monthlySaving, setAmount, testId } from "./facts-builder.ts";

export interface ArbitraryHousehold {
  readonly facts: Facts;
  readonly asOf: LocalDate;
  readonly sharedAccounts: readonly AccountId[];
  readonly jobs: readonly JobId[];
  /** The same facts with the rows that `add` makes on top. */
  withMore(add: (builder: FactsBuilder) => void): Facts;
}

const planStart = month("2026-01");
const monthAt = (index: number): Month => addMonths(planStart, index);

const signedAmount = (maxKroner: number): fc.Arbitrary<Money> => fc.integer({ min: -maxKroner * 100, max: maxKroner * 100 }).map(money);
const amountUpTo = (maxKroner: number): fc.Arbitrary<Money> => fc.integer({ min: 0, max: maxKroner * 100 }).map(money);
/** A day from December 2025 (index -1) to the month at `lastIndex`. */
const dayIn = (firstIndex: number, lastIndex: number): fc.Arbitrary<LocalDate> =>
  fc
    .record({ index: fc.integer({ min: firstIndex, max: lastIndex }), day: fc.integer({ min: 1, max: 28 }) })
    .map(({ index, day }) => localDate(`${monthAt(index)}-${String(day).padStart(2, "0")}`));

const jobRecipe = fc.record({
  kind: fc.constantFrom("setAmount", "followBills", "evenOut", "carryOver", "amountByMonth", "monthly", "payInto"),
  amount: amountUpTo(20_000),
  monthIndex: fc.integer({ min: -1, max: 7 }),
  account: fc.nat(),
  status: fc.constantFrom("active", "active", "active", "paused", "finished", "archived"),
  essential: fc.boolean(),
  opening: amountUpTo(10_000),
});

const treatmentRecipe = fc.oneof(
  fc.record({ kind: fc.constant("income"), fundsIndex: fc.integer({ min: -1, max: 6 }) }),
  fc.record({ kind: fc.constant("split"), allocations: fc.array(fc.record({ job: fc.nat(), amount: signedAmount(10_000) }), { minLength: 1, maxLength: 3 }) }),
  fc.record({ kind: fc.constant("transfer"), to: fc.nat(), matched: fc.boolean() }),
  fc.record({ kind: fc.constant("history"), job: fc.option(fc.nat(), { nil: null }) }),
  fc.record({ kind: fc.constant("needsYou") }),
);

const recipe = fc.record({
  openingBalances: fc.array(signedAmount(50_000), { minLength: 1, maxLength: 3 }),
  buffer: fc.option(fc.record({ monthly: amountUpTo(5_000), opening: amountUpTo(60_000), account: fc.nat() }), { nil: null }),
  jobs: fc.array(jobRecipe, { maxLength: 6 }),
  monthStates: fc.array(fc.constantFrom<BudgetMonthState | "planned">("planned", "open", "closed", "reopened"), { minLength: 6, maxLength: 6 }),
  assignments: fc.array(fc.record({ monthIndex: fc.integer({ min: 0, max: 5 }), job: fc.nat(), amount: amountUpTo(20_000) }), { maxLength: 20 }),
  transactions: fc.array(fc.record({ account: fc.nat(), date: dayIn(-1, 5), amount: signedAmount(30_000), treatment: treatmentRecipe }), { maxLength: 40 }),
  moves: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), amount: amountUpTo(5_000), monthIndex: fc.integer({ min: 0, max: 5 }), status: fc.constantFrom("todo", "done", "skipped") }), { maxLength: 3 }),
  bufferMonths: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null }),
  asOf: dayIn(0, 5),
});

function at<T>(list: readonly T[], n: number): T | undefined {
  return list.length === 0 ? undefined : list[n % list.length];
}

type Recipe = typeof recipe extends fc.Arbitrary<infer R> ? R : never;

function build(r: Recipe): { readonly builder: FactsBuilder; readonly shared: readonly AccountId[]; readonly jobs: readonly JobId[] } {
  const b = factsBuilder({ planStart });
  const shared = r.openingBalances.map((openingBalance, i) => b.account({ name: `Shared ${i + 1}`, openingBalance }));
  const paidInto = b.account({ name: "Child", scope: "paidInto", kind: "savings", openingBalance: kr(1_000) });
  const accountAt = (n: number): AccountId => at(shared, n) ?? b.defaultAccount();

  const jobs: JobId[] = [];
  if (r.buffer !== null) jobs.push(b.buffer({ monthly: r.buffer.monthly, opening: r.buffer.opening, accountId: accountAt(r.buffer.account), essential: false }));
  for (const j of r.jobs) {
    const common = { accountId: accountAt(j.account), status: j.status, essential: j.essential, opening: j.opening };
    const someMonth = monthAt(j.monthIndex);
    switch (j.kind) {
      case "setAmount":
        jobs.push(b.spendJob({ ...common, plan: setAmount(j.amount) }));
        break;
      case "followBills":
        jobs.push(b.spendJob({ ...common, plan: followBills() }));
        break;
      case "evenOut":
        jobs.push(b.spendJob({ ...common, plan: evenOut(j.amount, someMonth) }));
        break;
      case "carryOver":
        jobs.push(b.spendJob({ ...common, plan: setAmount(j.amount), keepsMoney: true }));
        break;
      case "amountByMonth":
        jobs.push(b.saveUpJob({ ...common, target: amountByMonth(j.amount, someMonth) }));
        break;
      case "monthly":
        jobs.push(b.saveUpJob({ ...common, target: monthlySaving(j.amount) }));
        break;
      case "payInto":
        jobs.push(b.payIntoJob({ ...common, monthly: j.amount, payInto: paidInto }));
        break;
    }
  }

  r.monthStates.forEach((state, i) => {
    if (state !== "planned") b.budgetMonth(monthAt(i), state);
  });
  for (const a of r.assignments) {
    const job = at(jobs, a.job);
    if (job !== undefined) b.assign(monthAt(a.monthIndex), job, a.amount);
  }
  for (const t of r.transactions) {
    const accountId = accountAt(t.account);
    const date = t.date;
    const treatment = t.treatment;
    switch (treatment.kind) {
      case "income":
        b.income({ accountId, date, amount: t.amount, fundsMonth: monthAt(treatment.fundsIndex) });
        break;
      case "split": {
        const allocations = treatment.allocations.flatMap((a) => {
          const job = at(jobs, a.job);
          return job === undefined ? [] : [[job, a.amount] as const];
        });
        if (allocations.length > 0) b.split({ accountId, date, allocations });
        else b.needsYou({ accountId, date, amount: t.amount });
        break;
      }
      case "transfer":
        if (treatment.matched) b.transfer({ from: accountId, to: accountAt(treatment.to), date, amount: money(Math.abs(t.amount)) });
        else b.unmatchedTransfer({ accountId, date, amount: t.amount });
        break;
      case "history": {
        const job = treatment.job === null ? undefined : at(jobs, treatment.job);
        b.history({ accountId, date, amount: t.amount, ...(job === undefined ? {} : { jobId: job }) });
        break;
      }
      case "needsYou":
        b.needsYou({ accountId, date, amount: t.amount });
        break;
    }
  }
  const everyAccount = [...shared, paidInto];
  for (const m of r.moves) {
    b.move({ from: at(everyAccount, m.from) ?? paidInto, to: at(everyAccount, m.to) ?? paidInto, amount: m.amount, month: monthAt(m.monthIndex), status: m.status });
  }
  if (r.bufferMonths !== null) b.enteredValue({ kind: "reference", subject: "buffer-months", value: r.bufferMonths, unit: "months", asOf: "2026-01-01" });

  return { builder: b, shared, jobs };
}

export function arbitraryHousehold(): fc.Arbitrary<ArbitraryHousehold> {
  return recipe.map((r) => {
    const { builder, shared, jobs } = build(r);
    return {
      facts: builder.facts(),
      asOf: r.asOf,
      sharedAccounts: shared,
      jobs,
      withMore: (add) => {
        const again = build(r).builder;
        add(again);
        return again.facts();
      },
    };
  });
}

// ── Every table and every optional field ─────────────────────────────────────

const maybe = <T>(arbitrary: fc.Arbitrary<T>): fc.Arbitrary<T | null> => fc.option(arbitrary, { nil: null });
const textFrom = (alphabet: string, minLength: number, maxLength: number): fc.Arbitrary<string> => fc.string({ unit: fc.constantFrom(...alphabet), minLength, maxLength });
/** Plain text with Norwegian letters, an emoji and a CJK character, and no control characters. */
const words = textFrom("abcdefghijklmnopqrstuvwxyz ÆØÅæøå0123456789-_.,/&'🙂日", 0, 16);
const digits = (length: number): fc.Arbitrary<string> => textFrom("0123456789", length, length);
const hex64 = textFrom("0123456789abcdef", 64, 64);
const rhythms: readonly ImportRhythm[] = ["weekly", "fortnightly", "monthly"];
const ruleOrigins: readonly RuleOrigin[] = ["set", "learned", "accepted"];
const isoDateTime = fc.date({ min: new Date("2025-12-01T00:00:00Z"), max: new Date("2026-07-01T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString());

const importRowRecipe = fc.record({
  account: fc.nat(),
  date: dayIn(-1, 5),
  interestDate: maybe(dayIn(-1, 5)),
  description: words,
  amount: signedAmount(30_000),
  counterpartAccount: maybe(digits(11)),
  counterpartName: maybe(words),
  reference: maybe(digits(12)),
  bankType: maybe(fc.constantFrom("VISA", "AVTALEGIRO", "OVERFØRSEL")),
  original: maybe(fc.record({ text: words, currency: fc.constantFrom("EUR", "SEK", "GBP") })),
  fingerprint: words,
  pending: fc.boolean(),
  backs: maybe(fc.nat()),
});

const extrasRecipe = fc.record({
  /** Account numbers are the base plus the account's position, so no two accounts share one. */
  numberBase: fc.integer({ min: 0, max: 99_999_999_000 }),
  accounts: fc.array(fc.record({ hasNumber: fc.boolean(), rhythm: maybe(fc.constantFrom(...rhythms)) }), { minLength: 4, maxLength: 4 }),
  transactions: fc.array(
    fc.record({ counterparty: maybe(words), transactionDate: maybe(dayIn(-1, 5)), reference: maybe(digits(12)), note: maybe(words), rule: maybe(fc.nat()), agreement: maybe(fc.nat()) }),
    { maxLength: 40 },
  ),
  people: fc.array(fc.record({ name: words, child: fc.boolean(), birthMonth: maybe(fc.integer({ min: -240, max: 5 })) }), { maxLength: 4 }),
  agreements: fc.array(
    fc.record({ person: fc.nat(), account: fc.nat(), amount: fc.integer({ min: 1, max: 5_000_000 }).map(money), day: fc.integer({ min: 1, max: 28 }), fromIndex: fc.integer({ min: -1, max: 4 }), lastOffset: maybe(fc.nat(6)) }),
    { maxLength: 3 },
  ),
  transfers: fc.array(fc.record({ monthIndex: fc.integer({ min: 0, max: 5 }), from: fc.nat(), to: fc.nat(), amount: fc.integer({ min: 1, max: 5_000_000 }).map(money), reason: words }), { maxLength: 4 }),
  rules: fc.array(
    fc.record({
      counterparty: words,
      account: maybe(fc.nat()),
      min: maybe(signedAmount(500)),
      max: maybe(signedAmount(500)),
      result: fc.oneof(
        fc.record({ kind: fc.constant("job"), job: fc.nat() }),
        fc.record({ kind: fc.constant("split"), shares: fc.array(fc.record({ job: fc.nat(), weight: fc.integer({ min: 1, max: 5 }) }), { minLength: 1, maxLength: 3 }) }),
      ),
      origin: fc.constantFrom(...ruleOrigins),
      priority: fc.integer({ min: -5, max: 100 }),
    }),
    { maxLength: 3 },
  ),
  batches: fc.uniqueArray(
    fc.record({
      fileName: words,
      fingerprint: hex64,
      format: fc.constantFrom("bulder-csv", "sparebank1-csv"),
      importedAt: isoDateTime,
      fallbackDate: dayIn(-1, 5),
      created: fc.nat(5),
      undone: fc.boolean(),
      rows: fc.array(importRowRecipe, { maxLength: 5 }),
    }),
    { maxLength: 3, selector: (batch) => batch.fingerprint },
  ),
});
type Extras = typeof extrasRecipe extends fc.Arbitrary<infer R> ? R : never;

function withoutNulls<T extends object>(fields: { readonly [K in keyof T]: T[K] | null }): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)) as Partial<T>;
}

function addExtras(facts: Facts, extras: Extras): Facts {
  const accountIds = [...facts.accounts.keys()];
  const jobIds = [...facts.jobs.keys()];
  const transactionIds = [...facts.transactions.keys()].sort();

  const accounts = new Map(
    [...facts.accounts.values()].map((account, i): [AccountId, Account] => {
      const e = extras.accounts[i];
      const number = e?.hasNumber ? accountNumber(String(extras.numberBase + i).padStart(11, "0")) : undefined;
      return [account.id, { ...account, ...(number === undefined ? {} : { number }), ...(e?.rhythm == null ? {} : { importRhythm: e.rhythm }) }];
    }),
  );

  const rules = new Map<Rule["id"], Rule>();
  extras.rules.forEach((r, i) => {
    const job = (n: number): JobId | undefined => (jobIds.length === 0 ? undefined : jobIds[n % jobIds.length]);
    const first = job(r.result.kind === "job" ? r.result.job : (r.result.shares[0]?.job ?? 0));
    if (first === undefined) return;
    const result: RuleResult =
      r.result.kind === "job"
        ? { kind: "job", jobId: first }
        : { kind: "split", shares: [{ jobId: first, weight: r.result.shares[0]?.weight ?? 1 }, ...r.result.shares.slice(1).map((s) => ({ jobId: job(s.job) ?? first, weight: s.weight }))] };
    const [min, max] = r.min !== null && r.max !== null && r.min > r.max ? [r.max, r.min] : [r.min, r.max];
    const id = ruleId(testId(30_000 + i));
    const account = r.account === null || accountIds.length === 0 ? undefined : accountIds[r.account % accountIds.length];
    rules.set(id, {
      id,
      match: { counterparty: r.counterparty, ...(account === undefined ? {} : { accountId: account }), ...withoutNulls({ min, max }) },
      result,
      origin: r.origin,
      priority: r.priority,
    });
  });
  const ruleIds = [...rules.keys()];

  const people = new Map<Person["id"], Person>();
  extras.people.forEach((p, i) => {
    const id = personId(testId(40_000 + i));
    people.set(id, { id, name: p.name, kind: p.child ? "child" : "adult", ...(p.birthMonth === null ? {} : { birthMonth: monthAt(p.birthMonth) }) });
  });
  const adults = [...people.values()].filter((p) => p.kind === "adult");
  const sharedAccounts = [...facts.accounts.values()].filter((a) => a.scope === "shared");
  const contributionAgreements = new Map<AgreementId, ContributionAgreement>();
  extras.agreements.forEach((a, i) => {
    const person = adults[a.person % Math.max(1, adults.length)];
    const account = sharedAccounts[a.account % Math.max(1, sharedAccounts.length)];
    if (person === undefined || account === undefined) return;
    const id = agreementId(testId(50_000 + i));
    const from = monthAt(a.fromIndex);
    contributionAgreements.set(id, { id, personId: person.id, accountId: account.id, amount: a.amount, day: a.day, from, ...(a.lastOffset === null ? {} : { to: addMonths(from, a.lastOffset) }) });
  });
  const agreementIds = [...contributionAgreements.keys()];

  const bucketTransfers = new Map<BucketTransfer["id"], BucketTransfer>();
  extras.transfers.forEach((t, i) => {
    const from = jobIds[t.from % Math.max(1, jobIds.length)];
    const to = jobIds[t.to % Math.max(1, jobIds.length)];
    if (from === undefined || to === undefined || from === to) return;
    const id = bucketTransferId(testId(60_000 + i));
    bucketTransfers.set(id, { id, month: monthAt(t.monthIndex), from, to, amount: t.amount, reason: t.reason });
  });
  const transactions = new Map(
    transactionIds.map((id, i): [TransactionId, Transaction] => {
      const transaction = facts.transactions.get(id) as Transaction;
      const e = extras.transactions[i];
      if (e === undefined) return [id, transaction];
      const rule = e.rule === null || ruleIds.length === 0 ? undefined : ruleIds[e.rule % ruleIds.length];
      const agreement = e.agreement === null || agreementIds.length === 0 ? undefined : agreementIds[e.agreement % agreementIds.length];
      const treatment = transaction.treatment.kind === "income" && transaction.treatment.source === "contribution" && agreement !== undefined ? { ...transaction.treatment, agreement } : transaction.treatment;
      return [
        id,
        {
          ...transaction,
          treatment,
          ...withoutNulls({ counterparty: e.counterparty, transactionDate: e.transactionDate, reference: e.reference, note: e.note }),
          ...(rule === undefined ? {} : { ruleId: rule }),
        },
      ];
    }),
  );

  const importBatches = new Map<ImportBatch["id"], ImportBatch>();
  const importRows = new Map<ImportRow["id"], ImportRow>();
  extras.batches.forEach((b, batchIndex) => {
    const batch = importBatchId(testId(10_000 + batchIndex));
    const backed = new Set<TransactionId>();
    const rows = b.rows.flatMap((r, line): ImportRow[] => {
      const accountId = accountIds.length === 0 ? undefined : accountIds[r.account % accountIds.length];
      if (accountId === undefined) return [];
      const candidate = r.pending || r.backs === null || transactionIds.length === 0 ? undefined : transactionIds[r.backs % transactionIds.length];
      // A file backs a transaction at most once, and a pending row backs none.
      const backs = candidate === undefined || backed.has(candidate) ? null : candidate;
      if (backs !== null) backed.add(backs);
      return [
        {
          id: importRowId(testId(20_000 + batchIndex * 100 + line)),
          batchId: batch,
          line: line + 1,
          accountId,
          bookingDate: r.date,
          ...(r.interestDate === null ? {} : { interestDate: r.interestDate }),
          description: r.description,
          amount: r.amount,
          ...withoutNulls({ counterpartAccount: r.counterpartAccount, counterpartName: r.counterpartName, reference: r.reference, bankType: r.bankType }),
          ...(r.original === null ? {} : { original: r.original }),
          fingerprint: r.fingerprint,
          pending: r.pending,
          backs,
        },
      ];
    });
    for (const row of rows) importRows.set(row.id, row);
    const dates = rows.map((row) => row.bookingDate).sort();
    const pending = rows.filter((row) => row.pending).length;
    const created = Math.min(b.created, rows.length - pending);
    importBatches.set(batch, {
      id: batch,
      fileName: b.fileName,
      fingerprint: b.fingerprint,
      format: b.format,
      importedAt: b.importedAt,
      from: dates[0] ?? b.fallbackDate,
      to: dates.at(-1) ?? b.fallbackDate,
      rows: rows.length,
      created,
      matched: rows.length - pending - created,
      pending,
      undone: b.undone,
    });
  });

  return { ...facts, accounts, transactions, rules, importBatches, importRows, people, contributionAgreements, bucketTransfers };
}

/** Facts from `arbitraryHousehold` with account numbers, import rhythms, transaction details, rules, and import batches with their rows added. */
export function arbitraryFacts(): fc.Arbitrary<Facts> {
  return fc.tuple(arbitraryHousehold(), extrasRecipe).map(([household, extras]) => addExtras(household.facts, extras));
}
