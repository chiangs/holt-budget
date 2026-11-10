import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type LocalDate, addDays, localDate } from "../dates.ts";
import type { AccountKind, Facts, ImportBatch, ImportRhythm, ImportRow } from "../facts.ts";
import type { AccountId, ImportBatchId } from "../ids.ts";
import { importBatchId, importRowId } from "../ids.ts";
import { money } from "../money.ts";
import { type FactsBuilder, factsBuilder, kr, testId } from "../testing/facts-builder.ts";
import { computeFigures } from "./index.ts";
import { importStatuses } from "./import-status.ts";

interface Account {
  readonly id: AccountId;
}

function household(rhythm?: ImportRhythm): { readonly b: FactsBuilder; readonly account: Account; readonly facts: () => Facts } {
  const b = factsBuilder({ planStart: "2026-01" });
  const id = b.account({ name: "Everyday" });
  b.buffer({ monthly: kr(1_000) });
  const withRhythm = (facts: Facts): Facts => (rhythm === undefined ? facts : { ...facts, accounts: new Map([...facts.accounts].map(([key, a]) => [key, key === id ? { ...a, importRhythm: rhythm } : a])) });
  return { b, account: { id }, facts: () => withRhythm(b.facts()) };
}

interface ImportSpec {
  readonly n: number;
  readonly accountId: AccountId;
  readonly dates: readonly string[];
  readonly importedAt?: string;
  readonly undone?: boolean;
  readonly pending?: readonly string[];
}

/** The facts with one imported file: a batch and one row per date. */
function withImport(facts: Facts, spec: ImportSpec): Facts {
  const batchId: ImportBatchId = importBatchId(testId(500_000 + spec.n));
  const booked = spec.dates;
  const pending = spec.pending ?? [];
  const all = [...booked, ...pending];
  const dates = all.map((d) => localDate(d)).sort();
  const rows = all.map((date, i): ImportRow => ({
    id: importRowId(testId(600_000 + spec.n * 100 + i)),
    batchId,
    line: i + 2,
    accountId: spec.accountId,
    bookingDate: localDate(date),
    description: "row",
    amount: money(-100),
    fingerprint: `${spec.n}-${i}`,
    pending: i >= booked.length,
    backs: null,
  }));
  const batch: ImportBatch = {
    id: batchId,
    fileName: `file-${spec.n}.csv`,
    fingerprint: `fingerprint-${spec.n}`,
    format: "test-csv",
    importedAt: spec.importedAt ?? "2026-11-01T10:00:00Z",
    from: dates[0] as LocalDate,
    to: dates.at(-1) as LocalDate,
    rows: rows.length,
    created: 0,
    matched: 0,
    pending: pending.length,
    undone: spec.undone ?? false,
  };
  return { ...facts, importBatches: new Map([...facts.importBatches, [batchId, batch]]), importRows: new Map([...facts.importRows, ...rows.map((r): [ImportRow["id"], ImportRow] => [r.id, r])]) };
}

const statusOf = (facts: Facts, asOf: string, id: AccountId) => importStatuses(facts, localDate(asOf)).accounts.get(id);

describe("importStatuses", () => {
  describe("an account that was never imported", () => {
    it("is not imported, covers to nothing and has no last import", () => {
      const { account, facts } = household();
      expect(statusOf(facts(), "2026-11-10", account.id)).toEqual({ accountId: account.id, lastImport: null, coversTo: null, state: "notImported", checkedOn: null });
    });

    it("is not due, however long ago the household started", () => {
      const { facts } = household("weekly");
      expect(importStatuses(facts(), localDate("2030-01-01")).due).toBe(0);
    });
  });

  describe("whether it was checked against the bank", () => {
    it("is not checked until the family types a balance, and then names the latest date they typed", () => {
      const { b, account, facts } = household();
      expect(statusOf(facts(), "2026-11-10", account.id)?.checkedOn).toBeNull();
      b.enteredValue({ kind: "accountBalance", subject: account.id, value: 2_496_000, asOf: "2026-10-20" });
      b.enteredValue({ kind: "accountBalance", subject: account.id, value: 2_500_000, asOf: "2026-11-06" });
      b.enteredValue({ kind: "accountBalance", subject: account.id, value: 2_400_000, asOf: "2026-09-01" });
      expect(statusOf(b.facts(), "2026-11-10", account.id)?.checkedOn).toBe(localDate("2026-11-06"));
    });

    it("counts only balances typed for this account, and only balances", () => {
      const { b, account } = household();
      const other = b.account({ name: "Other" });
      b.enteredValue({ kind: "accountBalance", subject: other, value: 1, asOf: "2026-11-06" });
      b.enteredValue({ kind: "figure", subject: account.id, value: 1, asOf: "2026-11-06" });
      expect(statusOf(b.facts(), "2026-11-10", account.id)?.checkedOn).toBeNull();
      expect(statusOf(b.facts(), "2026-11-10", other)?.checkedOn).toBe(localDate("2026-11-06"));
    });
  });

  describe("what an import covers", () => {
    it("covers to the latest booking date among the account's rows", () => {
      const { account, facts } = household();
      const f = withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-03", "2026-10-28", "2026-10-15"] });
      expect(statusOf(f, "2026-11-01", account.id)?.coversTo).toBe("2026-10-28");
    });

    it("covers to the latest date over several files", () => {
      const { account, facts } = household();
      const f = withImport(withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-28"] }), { n: 2, accountId: account.id, dates: ["2026-09-01", "2026-10-05"] });
      expect(statusOf(f, "2026-11-01", account.id)?.coversTo).toBe("2026-10-28");
    });

    it("leaves out pending rows, because the bank hasn't booked them", () => {
      const { account, facts } = household();
      const f = withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-20"], pending: ["2026-10-29"] });
      expect(statusOf(f, "2026-11-01", account.id)?.coversTo).toBe("2026-10-20");
    });

    it("leaves out the rows of an undone import", () => {
      const { account, facts } = household();
      const f = withImport(withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-10"] }), { n: 2, accountId: account.id, dates: ["2026-10-28"], undone: true });
      expect(statusOf(f, "2026-11-01", account.id)?.coversTo).toBe("2026-10-10");
    });

    it("is not imported again once the only import is undone", () => {
      const { account, facts } = household();
      const f = withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-28"], undone: true });
      expect(statusOf(f, "2026-11-01", account.id)).toEqual({ accountId: account.id, lastImport: null, coversTo: null, state: "notImported", checkedOn: null });
    });

    it("is not imported when the only rows are pending, though the file was imported", () => {
      const { account, facts } = household();
      const f = withImport(facts(), { n: 1, accountId: account.id, dates: [], pending: ["2026-10-29"] });
      expect(statusOf(f, "2026-11-01", account.id)).toMatchObject({ coversTo: null, state: "notImported", lastImport: { batchId: importBatchId(testId(500_001)) } });
    });

    it("keeps each account's own coverage", () => {
      const { b, account, facts } = household();
      const second = b.account({ name: "Bills", kind: "bills" });
      const f = withImport(withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-28"] }), { n: 2, accountId: second, dates: ["2026-09-12"] });
      expect(statusOf(f, "2026-11-01", account.id)?.coversTo).toBe("2026-10-28");
      expect(statusOf(f, "2026-11-01", second)?.coversTo).toBe("2026-09-12");
    });
  });

  describe("the last import", () => {
    it("is the live batch imported most recently, with its time", () => {
      const { account, facts } = household();
      const f = withImport(
        withImport(withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-01"], importedAt: "2026-10-05T09:00:00Z" }), { n: 2, accountId: account.id, dates: ["2026-10-20"], importedAt: "2026-10-25T09:00:00Z" }),
        { n: 3, accountId: account.id, dates: ["2026-10-30"], importedAt: "2026-11-02T09:00:00Z", undone: true },
      );
      expect(statusOf(f, "2026-11-03", account.id)?.lastImport).toEqual({ batchId: importBatchId(testId(500_002)), importedAt: "2026-10-25T09:00:00Z" });
    });

    it("is the batch with the larger ID when two were imported at the same moment", () => {
      const { account, facts } = household();
      const at = "2026-10-25T09:00:00Z";
      const f = withImport(withImport(facts(), { n: 7, accountId: account.id, dates: ["2026-10-01"], importedAt: at }), { n: 4, accountId: account.id, dates: ["2026-10-20"], importedAt: at });
      expect(statusOf(f, "2026-11-03", account.id)?.lastImport?.batchId).toBe(importBatchId(testId(500_007)));
    });

    it("counts a batch only for the accounts it has rows for", () => {
      const { b, account, facts } = household();
      const second = b.account({ name: "Bills", kind: "bills" });
      const f = withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-01"] });
      expect(statusOf(f, "2026-11-03", second)?.lastImport).toBeNull();
    });
  });

  describe("when an account is due", () => {
    const stateAt = (rhythm: ImportRhythm | undefined, coversTo: string, asOf: string) => {
      const { account, facts } = household(rhythm);
      return statusOf(withImport(facts(), { n: 1, accountId: account.id, dates: [coversTo] }), asOf, account.id)?.state;
    };

    it.each([
      ["weekly", "2026-11-01", "2026-11-01", "upToDate"],
      ["weekly", "2026-11-01", "2026-11-08", "upToDate"],
      ["weekly", "2026-11-01", "2026-11-09", "due"],
      ["weekly", "2026-12-28", "2027-01-04", "upToDate"],
      ["weekly", "2026-12-28", "2027-01-05", "due"],
      ["fortnightly", "2026-11-01", "2026-11-15", "upToDate"],
      ["fortnightly", "2026-11-01", "2026-11-16", "due"],
      ["fortnightly", "2026-02-20", "2026-03-06", "upToDate"],
      ["fortnightly", "2026-02-20", "2026-03-07", "due"],
      ["monthly", "2026-10-10", "2026-11-10", "upToDate"],
      ["monthly", "2026-10-10", "2026-11-11", "due"],
      ["monthly", "2026-12-15", "2027-01-15", "upToDate"],
      ["monthly", "2026-12-15", "2027-01-16", "due"],
      ["monthly", "2026-01-31", "2026-02-28", "upToDate"],
      ["monthly", "2026-01-31", "2026-03-01", "due"],
      ["monthly", "2026-01-30", "2026-02-28", "upToDate"],
      ["monthly", "2026-01-30", "2026-03-01", "due"],
      ["monthly", "2028-01-31", "2028-02-29", "upToDate"],
      ["monthly", "2028-01-31", "2028-03-01", "due"],
      ["monthly", "2026-11-30", "2026-12-30", "upToDate"],
      ["monthly", "2026-11-30", "2026-12-31", "due"],
    ] as const)("%s: covering to %s, as of %s the account is %s", (rhythm, coversTo, asOf, state) => {
      expect(stateAt(rhythm, coversTo, asOf)).toBe(state);
    });

    it("treats an account with no rhythm as monthly", () => {
      expect(stateAt(undefined, "2026-10-10", "2026-11-10")).toBe("upToDate");
      expect(stateAt(undefined, "2026-10-10", "2026-11-11")).toBe("due");
    });

    it("is up to date when the data runs past today", () => {
      expect(stateAt("weekly", "2026-12-01", "2026-11-01")).toBe("upToDate");
    });

    it("counts the accounts that are due, and no others", () => {
      const { b, account, facts } = household("weekly");
      const monthly = b.account({ name: "Bills", kind: "bills" });
      const never = b.account({ name: "Savings", kind: "savings" });
      const f = withImport(withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-20"] }), { n: 2, accountId: monthly, dates: ["2026-10-20"] });
      const result = importStatuses(f, localDate("2026-11-10"));
      expect(result.due).toBe(1);
      expect([...result.accounts.values()].map((s) => [s.accountId, s.state])).toEqual([
        [account.id, "due"],
        [monthly, "upToDate"],
        [never, "notImported"],
      ]);
    });

    it("never calls an account due once it is imported up to the day", () => {
      fc.assert(
        fc.property(fc.constantFrom<ImportRhythm | undefined>("weekly", "fortnightly", "monthly", undefined), fc.integer({ min: 0, max: 1_000 }), (rhythm, offset) => {
          const day = addDays(localDate("2026-01-01"), offset);
          expect(stateAt(rhythm, day, day)).toBe("upToDate");
        }),
      );
    });

    it("is due exactly when more than 7 days, or 14 days, have passed", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 0, max: 40 }), (offset, gap) => {
          const covers = addDays(localDate("2026-01-01"), offset);
          const asOf = addDays(covers, gap);
          expect(stateAt("weekly", covers, asOf)).toBe(gap > 7 ? "due" : "upToDate");
          expect(stateAt("fortnightly", covers, asOf)).toBe(gap > 14 ? "due" : "upToDate");
        }),
      );
    });

    it("is never due within 28 days of a monthly import and always due after 31 days", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 0, max: 60 }), (offset, gap) => {
          const covers = addDays(localDate("2026-01-01"), offset);
          const state = stateAt("monthly", covers, addDays(covers, gap));
          if (gap <= 28) expect(state).toBe("upToDate");
          if (gap > 31) expect(state).toBe("due");
        }),
      );
    });

    it("stays due once it is due, as days pass", () => {
      fc.assert(
        fc.property(fc.constantFrom<ImportRhythm>("weekly", "fortnightly", "monthly"), fc.integer({ min: 0, max: 400 }), fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 }), (rhythm, offset, gap, more) => {
          const covers = addDays(localDate("2026-01-01"), offset);
          if (stateAt(rhythm, covers, addDays(covers, gap)) === "due") expect(stateAt(rhythm, covers, addDays(covers, gap + more))).toBe("due");
        }),
      );
    });

    it("becomes up to date again once a newer file covers the gap", () => {
      const { account, facts } = household("weekly");
      const stale = withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-01"] });
      expect(statusOf(stale, "2026-11-10", account.id)?.state).toBe("due");
      const fresh = withImport(stale, { n: 2, accountId: account.id, dates: ["2026-11-08"] });
      expect(statusOf(fresh, "2026-11-10", account.id)?.state).toBe("upToDate");
    });
  });

  describe("accounts the household pays into", () => {
    it("have no status and are never due, however old their imports are", () => {
      const { b, account, facts } = household("weekly");
      const child = b.account({ name: "Child", scope: "paidInto", kind: "savings" });
      const f = withImport(facts(), { n: 1, accountId: child, dates: ["2020-01-01"] });
      const result = importStatuses(f, localDate("2026-11-10"));
      expect(result.accounts.has(child)).toBe(false);
      expect(result.accounts.has(account.id)).toBe(true);
      expect(result.due).toBe(0);
    });

    it("are left out whatever kind of account they are", () => {
      const { b, facts } = household();
      const kinds: AccountKind[] = ["everyday", "bills", "savings", "loan"];
      const paid = kinds.map((kind) => b.account({ name: kind, scope: "paidInto", kind }));
      const result = importStatuses(facts(), localDate("2026-11-10"));
      for (const id of paid) expect(result.accounts.has(id)).toBe(false);
    });
  });

  it("is part of the figures", () => {
    const { account, facts } = household("weekly");
    const f = withImport(facts(), { n: 1, accountId: account.id, dates: ["2026-10-01"] });
    expect(computeFigures(f, localDate("2026-11-10")).importStatus).toEqual(importStatuses(f, localDate("2026-11-10")));
  });
});
