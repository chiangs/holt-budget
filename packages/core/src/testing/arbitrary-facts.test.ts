import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Facts, ImportBatch } from "../facts.ts";
import { arbitraryFacts } from "./arbitrary-facts.ts";

const samples = (): Facts[] => fc.sample(arbitraryFacts(), { numRuns: 300, seed: 7 });

/** Whether some row of some facts has the field and some row lacks it. */
function sometimesPresentAndAbsent<R extends object>(all: readonly Facts[], rows: (facts: Facts) => Iterable<R>, field: keyof R): boolean {
  let present = false;
  let absent = false;
  for (const facts of all) for (const row of rows(facts)) (Object.hasOwn(row, field) ? (present = true) : (absent = true));
  return present && absent;
}

describe("arbitraryFacts", () => {
  it("fills every optional field of an account, a transaction, an import row and a rule some of the time", () => {
    const all = samples();
    for (const field of ["number", "importRhythm"] as const) expect(sometimesPresentAndAbsent(all, (f) => f.accounts.values(), field), `account ${field}`).toBe(true);
    for (const field of ["counterparty", "transactionDate", "reference", "note", "ruleId"] as const) {
      expect(sometimesPresentAndAbsent(all, (f) => f.transactions.values(), field), `transaction ${field}`).toBe(true);
    }
    for (const field of ["interestDate", "counterpartAccount", "counterpartName", "reference", "bankType", "original"] as const) {
      expect(sometimesPresentAndAbsent(all, (f) => f.importRows.values(), field), `import row ${field}`).toBe(true);
    }
    for (const field of ["accountId", "min", "max"] as const) expect(sometimesPresentAndAbsent(all, (f) => [...f.rules.values()].map((r) => r.match), field), `rule match ${field}`).toBe(true);
  });

  it("fills the new tables and their optional fields some of the time: people, agreements that end or run on, transfers, and an income that names its agreement", () => {
    const all = samples();
    expect(sometimesPresentAndAbsent(all, (f) => f.people.values(), "birthMonth"), "person birthMonth").toBe(true);
    expect(sometimesPresentAndAbsent(all, (f) => f.contributionAgreements.values(), "to"), "agreement to").toBe(true);
    expect(new Set(all.flatMap((f) => [...f.people.values()].map((p) => p.kind)))).toEqual(new Set(["adult", "child"]));
    expect(all.some((f) => f.bucketTransfers.size > 0)).toBe(true);
    const incomes = all.flatMap((f) => [...f.transactions.values()].flatMap((t) => (t.treatment.kind === "income" ? [t.treatment] : [])));
    expect(incomes.some((t) => t.agreement !== undefined)).toBe(true);
    expect(incomes.some((t) => t.agreement === undefined)).toBe(true);
  });

  it("makes every import rhythm, both kinds of rule result and every rule origin, and live and undone batches with and without rows", () => {
    const all = samples();
    const accounts = all.flatMap((f) => [...f.accounts.values()]);
    expect(new Set(accounts.map((a) => a.importRhythm))).toEqual(new Set([undefined, "weekly", "fortnightly", "monthly"]));
    const rules = all.flatMap((f) => [...f.rules.values()]);
    expect(new Set(rules.map((r) => r.result.kind))).toEqual(new Set(["job", "split"]));
    expect(new Set(rules.map((r) => r.origin))).toEqual(new Set(["set", "learned", "accepted"]));
    const batches = all.flatMap((f) => [...f.importBatches.values()].map((b) => ({ b, rows: [...f.importRows.values()].filter((r) => r.batchId === b.id) })));
    expect(batches.some(({ b }) => b.undone)).toBe(true);
    expect(batches.some(({ b }) => !b.undone)).toBe(true);
    expect(batches.some(({ rows }) => rows.length === 0)).toBe(true);
    expect(batches.some(({ rows }) => rows.length > 1)).toBe(true);
    const rows = all.flatMap((f) => [...f.importRows.values()]);
    expect(rows.some((r) => r.pending)).toBe(true);
    expect(rows.some((r) => r.backs !== null)).toBe(true);
    expect(rows.some((r) => !r.pending && r.backs === null)).toBe(true);
  });

  it("keeps the rows consistent with each other, as the database will require", () => {
    for (const facts of samples()) {
      const numbers = [...facts.accounts.values()].flatMap((a) => (a.number === undefined ? [] : [a.number]));
      expect(new Set(numbers).size).toBe(numbers.length);
      const live = [...facts.importBatches.values()].filter((b: ImportBatch) => !b.undone).map((b) => b.fingerprint);
      expect(new Set(live).size).toBe(live.length);
      const backed = new Set<string>();
      for (const row of facts.importRows.values()) {
        expect(facts.importBatches.has(row.batchId)).toBe(true);
        expect(facts.accounts.has(row.accountId)).toBe(true);
        if (row.pending) expect(row.backs).toBeNull();
        if (row.backs !== null) {
          expect(facts.transactions.has(row.backs)).toBe(true);
          expect(backed.has(`${row.batchId}/${row.backs}`)).toBe(false);
          backed.add(`${row.batchId}/${row.backs}`);
        }
      }
      for (const batch of facts.importBatches.values()) {
        expect(batch.from <= batch.to).toBe(true);
        expect(batch.created + batch.matched + batch.pending).toBe(batch.rows);
      }
      for (const rule of facts.rules.values()) {
        const jobs = rule.result.kind === "job" ? [rule.result.jobId] : rule.result.shares.map((s) => s.jobId);
        for (const job of jobs) expect(facts.jobs.has(job)).toBe(true);
        if (rule.match.accountId !== undefined) expect(facts.accounts.has(rule.match.accountId)).toBe(true);
      }
      for (const t of facts.transactions.values()) if (t.ruleId !== undefined) expect(facts.rules.has(t.ruleId)).toBe(true);
      for (const agreement of facts.contributionAgreements.values()) {
        expect(facts.people.get(agreement.personId)?.kind).toBe("adult");
        expect(facts.accounts.get(agreement.accountId)?.scope).toBe("shared");
        expect(agreement.amount).toBeGreaterThan(0);
        expect(agreement.day).toBeGreaterThanOrEqual(1);
        expect(agreement.day).toBeLessThanOrEqual(28);
        if (agreement.to !== undefined) expect(agreement.to >= agreement.from).toBe(true);
      }
      for (const transfer of facts.bucketTransfers.values()) {
        expect(facts.jobs.has(transfer.from) && facts.jobs.has(transfer.to)).toBe(true);
        expect(transfer.from).not.toBe(transfer.to);
        expect(transfer.amount).toBeGreaterThan(0);
      }
      for (const t of facts.transactions.values()) {
        if (t.treatment.kind === "income" && t.treatment.agreement !== undefined) {
          expect(facts.contributionAgreements.has(t.treatment.agreement)).toBe(true);
          expect(t.treatment.source).toBe("contribution");
        }
      }
    }
  });
});
