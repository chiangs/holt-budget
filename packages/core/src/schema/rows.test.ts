import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Facts, type RowOf, type TableName, tableNames } from "../facts.ts";
import { rowsEqual } from "../patch.ts";
import { arbitraryFacts } from "../testing/arbitrary-facts.ts";
import { testId } from "../testing/facts-builder.ts";
import { problems } from "./test-helpers.ts";
import { TableSchemas } from "./rows.ts";

const rowsOf = <T extends TableName>(facts: Facts, table: T): RowOf<T>[] => [...(facts[table] as ReadonlyMap<string, RowOf<T>>).values()];

describe("a row read from storage", () => {
  for (const table of tableNames) {
    it(`in ${table} comes back equal to the row that was stored`, () => {
      fc.assert(
        fc.property(arbitraryFacts(), (facts) => {
          for (const row of rowsOf(facts, table)) {
            const parsed = TableSchemas[table].safeParse(row);
            expect(problems(parsed)).toEqual([]);
            expect(rowsEqual(parsed.data, row)).toBe(true);
          }
        }),
      );
    });

    it(`in ${table} survives a trip through JSON, as the stored change records do`, () => {
      fc.assert(
        fc.property(arbitraryFacts(), (facts) => {
          for (const row of rowsOf(facts, table)) {
            const parsed = TableSchemas[table].safeParse(JSON.parse(JSON.stringify(row)));
            expect(problems(parsed)).toEqual([]);
            expect(rowsEqual(parsed.data, row)).toBe(true);
          }
        }),
      );
    });
  }
});

const id = (n: number) => testId(n);
const account = { id: id(1), name: "Everyday", kind: "everyday", scope: "shared", openingBalance: 0, openingDate: "2026-01-01" };
const spendJob = { id: id(2), name: "Food", groupId: id(3), status: "active", accountId: id(1), essential: true, opening: 0, kind: "spend", keepsMoney: false, plan: { mode: "setAmount", amount: 500_000 }, seasonality: "auto" };
const transaction = { id: id(4), accountId: id(1), bookingDate: "2026-02-03", amount: -10_000, description: "Card", treatment: { kind: "needsYou" } };
const batch = { id: id(5), fileName: "march.csv", fingerprint: "a".repeat(64), format: "bulder-csv", importedAt: "2026-03-01T10:00:00.000Z", from: "2026-02-01", to: "2026-02-28", rows: 1, created: 1, matched: 0, pending: 0, undone: false };
const importRow = { id: id(6), batchId: id(5), line: 1, accountId: id(1), bookingDate: "2026-02-03", description: "Card", amount: -10_000, fingerprint: "f", pending: false, backs: null };
const rule = { id: id(7), match: { counterparty: "Kiwi" }, result: { kind: "job", jobId: id(2) }, origin: "set", priority: 1 };
const person = { id: id(12), name: "Mia", kind: "child", birthMonth: "2018-04" };
const agreement = { id: id(13), personId: id(12), accountId: id(1), amount: 900_000, day: 20, from: "2026-10", to: "2027-09" };
const bucketTransfer = { id: id(14), month: "2026-11", from: id(2), to: id(15), amount: 410_000, reason: "Start evening out" };
const enteredValue = { id: id(8), kind: "figure", subject: "gross-income", value: 1.5, unit: "percent", asOf: "2026-01-01", source: "you" };

const good = {
  household: { id: id(9), name: "Home", currency: "NOK", planStart: "2026-01", evenOutStep: 5_000 },
  accounts: account,
  groups: { id: id(3), name: "Living", order: 0, countsTowardsSavingsRate: false },
  jobs: spendJob,
  budgetMonths: { month: "2026-01", state: "open" },
  assignments: { month: "2026-01", jobId: id(2), amount: 100 },
  transactions: transaction,
  moves: { id: id(10), from: id(1), to: id(11), amount: 100, month: "2026-01", reason: "Seed", status: "todo", completedBy: null },
  enteredValues: enteredValue,
  importBatches: batch,
  importRows: importRow,
  rules: rule,
  people: person,
  contributionAgreements: agreement,
  bucketTransfers: bucketTransfer,
} satisfies { [T in TableName]: unknown };

describe("the examples used below", () => {
  for (const table of tableNames) {
    it(`are accepted as a row of ${table}`, () => {
      expect(problems(TableSchemas[table].safeParse(good[table]))).toEqual([]);
    });
  }
});

function refused(table: TableName, row: unknown): string[] {
  const result = TableSchemas[table].safeParse(row);
  expect(result.success).toBe(false);
  return problems(result);
}

describe("a row that does not belong is refused, and the problem names where it is", () => {
  it("for an ID that is not a UUID", () => {
    expect(refused("accounts", { ...account, id: "not-an-id" })).toEqual([expect.stringMatching(/^id: .*not-an-id/)]);
  });

  it("for an ID in the place of a different kind of ID that is still a UUID, which the brand cannot tell apart at runtime", () => {
    expect(problems(TableSchemas.jobs.safeParse({ ...spendJob, groupId: id(1) }))).toEqual([]);
  });

  it("for a date that is not on the calendar and a month that is not a month", () => {
    expect(refused("accounts", { ...account, openingDate: "2026-02-30" })).toEqual([expect.stringMatching(/^openingDate: /)]);
    expect(refused("household", { ...good.household, planStart: "2026-13" })).toEqual([expect.stringMatching(/^planStart: /)]);
  });

  it("for an amount that is negative zero, fractional, unsafe, not a number or text", () => {
    for (const amount of [-0, 12.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, "100", null, undefined]) {
      expect(refused("accounts", { ...account, openingBalance: amount })).toEqual([expect.stringMatching(/^openingBalance: /)]);
    }
  });

  it("for an amount nested in a plan or a split", () => {
    expect(refused("jobs", { ...spendJob, plan: { mode: "setAmount", amount: 1.5 } })).toEqual([expect.stringMatching(/^plan\.amount: /)]);
    const split = { kind: "split", allocations: [{ jobId: id(2), amount: -0 }] };
    expect(refused("transactions", { ...transaction, amount: 0, treatment: split })).toEqual([expect.stringMatching(/^treatment\.allocations\.0\.amount: /)]);
  });

  it("for a key the type does not have, at the top and inside a nested object", () => {
    expect(refused("accounts", { ...account, balance: 5 })).toEqual([expect.stringMatching(/^: .*"balance"/)]);
    expect(refused("jobs", { ...spendJob, plan: { mode: "followBills", amount: 5 } })).toEqual([expect.stringMatching(/^plan: .*"amount"/)]);
    expect(refused("rules", { ...rule, match: { counterparty: "Kiwi", note: "x" } })).toEqual([expect.stringMatching(/^match: .*"note"/)]);
    expect(refused("importRows", { ...importRow, original: { text: "1", currency: "EUR", rate: 1 } })).toEqual([expect.stringMatching(/^original: .*"rate"/)]);
  });

  it("for a field that belongs to a different kind of job", () => {
    expect(refused("jobs", { ...spendJob, target: { kind: "monthly", amount: 1 } })).toEqual([expect.stringMatching(/"target"/)]);
    expect(refused("jobs", { ...spendJob, kind: "gift" })).toEqual([expect.stringMatching(/^kind: /)]);
  });

  it("for a split that does not add up to the amount, or that has no allocations", () => {
    const split = (amount: number) => ({ kind: "split", allocations: [{ jobId: id(2), amount: -6_000 }, { jobId: id(2), amount }] });
    expect(problems(TableSchemas.transactions.safeParse({ ...transaction, treatment: split(-4_000) }))).toEqual([]);
    expect(refused("transactions", { ...transaction, treatment: split(-3_999) })).toEqual([expect.stringMatching(/^treatment\.allocations: .*add up/)]);
    expect(refused("transactions", { ...transaction, treatment: { kind: "split", allocations: [] } })).toEqual([expect.stringMatching(/^treatment\.allocations: /)]);
  });

  it("for a treatment of a kind that does not exist", () => {
    expect(refused("transactions", { ...transaction, treatment: { kind: "gift" } })).toEqual([expect.stringMatching(/^treatment\.kind: /)]);
  });

  it("for a currency, account number, fingerprint or time that is not one", () => {
    expect(refused("household", { ...good.household, currency: "nok" })).toEqual([expect.stringMatching(/^currency: /)]);
    expect(refused("household", { ...good.household, currency: "ZZZ" })).toEqual([expect.stringMatching(/^currency: /)]);
    expect(refused("accounts", { ...account, number: "123" })).toEqual([expect.stringMatching(/^number: /)]);
    expect(refused("importBatches", { ...batch, fingerprint: "A".repeat(64) })).toEqual([expect.stringMatching(/^fingerprint: /)]);
    expect(refused("importBatches", { ...batch, fingerprint: "a".repeat(63) })).toEqual([expect.stringMatching(/^fingerprint: /)]);
    expect(refused("importBatches", { ...batch, importedAt: "yesterday" })).toEqual([expect.stringMatching(/^importedAt: /)]);
    expect(refused("importBatches", { ...batch, importedAt: "2026-03-01T10:00:00" })).toEqual([expect.stringMatching(/^importedAt: /)]);
  });

  it("for counts and weights outside their range", () => {
    expect(refused("importBatches", { ...batch, created: -1 })).toEqual([expect.stringMatching(/^created: /)]);
    expect(refused("importRows", { ...importRow, line: 0 })).toEqual([expect.stringMatching(/^line: /)]);
    expect(refused("rules", { ...rule, result: { kind: "split", shares: [{ jobId: id(2), weight: 0 }] } })).toEqual([expect.stringMatching(/^result\.shares\.0\.weight: /)]);
    expect(refused("rules", { ...rule, result: { kind: "split", shares: [] } })).toEqual([expect.stringMatching(/^result\.shares: /)]);
    expect(refused("enteredValues", { ...enteredValue, value: Number.NaN })).toEqual([expect.stringMatching(/^value: /)]);
  });

  it("for a person, an agreement or a transfer that does not fit", () => {
    expect(refused("people", { ...person, kind: "pet" })).toEqual([expect.stringMatching(/^kind: /)]);
    expect(refused("people", { ...person, birthMonth: "2018-4" })).toEqual([expect.stringMatching(/^birthMonth: /)]);
    expect(refused("contributionAgreements", { ...agreement, day: 0.5 })).toEqual([expect.stringMatching(/^day: /)]);
    expect(refused("contributionAgreements", { ...agreement, from: "October" })).toEqual([expect.stringMatching(/^from: /)]);
    expect(refused("bucketTransfers", { ...bucketTransfer, amount: 1.5 })).toEqual([expect.stringMatching(/^amount: /)]);
    expect(refused("bucketTransfers", { ...bucketTransfer, reason: undefined })).toEqual([expect.stringMatching(/^reason: /)]);
  });

  it("for a key the new rows do not have", () => {
    expect(refused("people", { ...person, nickname: "M" })).toEqual([expect.stringMatching(/^: .*"nickname"/)]);
    expect(refused("contributionAgreements", { ...agreement, status: "arrived" })).toEqual([expect.stringMatching(/^: .*"status"/)]);
    expect(refused("bucketTransfers", { ...bucketTransfer, note: "x" })).toEqual([expect.stringMatching(/^: .*"note"/)]);
  });

  it("for an income that names an agreement when it is not a contribution", () => {
    const income = (source: string, extra: object = { agreement: id(13) }) => ({ ...transaction, treatment: { kind: "income", fundsMonth: "2026-03", source, ...extra } });
    expect(problems(TableSchemas.transactions.safeParse(income("contribution")))).toEqual([]);
    expect(problems(TableSchemas.transactions.safeParse(income("recurring", {})))).toEqual([]);
    for (const source of ["recurring", "other"]) expect(refused("transactions", income(source))).toEqual([expect.stringMatching(/^treatment\.agreement: .*contribution/)]);
    expect(refused("transactions", income("contribution", { agreement: "nope" }))).toEqual([expect.stringMatching(/^treatment\.agreement: /)]);
  });

  it("for a field that is missing", () => {
    const { name: _, ...withoutName } = account;
    expect(refused("accounts", withoutName)).toEqual([expect.stringMatching(/^name: /)]);
    expect(refused("moves", { ...good.moves, completedBy: undefined })).toEqual([expect.stringMatching(/^completedBy: /)]);
  });

  it("for something that is not an object", () => {
    for (const table of tableNames) for (const value of [null, undefined, "row", 5, [], [account]]) expect(TableSchemas[table].safeParse(value).success).toBe(false);
  });
});

describe("an optional field", () => {
  it("stays absent when the row leaves it out", () => {
    const parsed = TableSchemas.accounts.parse(account);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(account).sort());
    expect(Object.hasOwn(TableSchemas.transactions.parse(transaction), "counterparty")).toBe(false);
    expect(Object.hasOwn(TableSchemas.people.parse({ id: id(12), name: "Alex", kind: "adult" }), "birthMonth")).toBe(false);
    const { to: _, ...running } = agreement;
    expect(Object.hasOwn(TableSchemas.contributionAgreements.parse(running), "to")).toBe(false);
  });

  it("is refused when it is present and undefined, because the type allows absent but not undefined", () => {
    expect(refused("accounts", { ...account, number: undefined })).toEqual([expect.stringMatching(/^number: /)]);
    expect(refused("transactions", { ...transaction, note: undefined })).toEqual([expect.stringMatching(/^note: /)]);
    expect(refused("rules", { ...rule, match: { counterparty: "Kiwi", min: undefined } })).toEqual([expect.stringMatching(/^match\.min: /)]);
  });

  it("takes an account number written with dots and keeps the 11 digits", () => {
    expect(TableSchemas.accounts.parse({ ...account, number: "1234.56.78901" }).number).toBe("12345678901");
  });
});

describe("parsing", () => {
  it("never throws, whatever it is given", () => {
    fc.assert(
      fc.property(fc.constantFrom(...tableNames), fc.anything(), (table, value) => {
        expect(() => TableSchemas[table].safeParse(value)).not.toThrow();
      }),
    );
  });

  it("refuses a row of one table in the schema of another", () => {
    for (const table of tableNames) for (const other of tableNames) if (table !== other) expect(TableSchemas[other].safeParse(good[table]).success, `${table} as ${other}`).toBe(false);
  });
});
