import {
  type Account,
  type AccountId,
  type Facts,
  type ImportBatch,
  type JobId,
  type Patch,
  type Rule,
  type RuleId,
  type Transaction,
  accountId,
  accountNumber,
  importBatchId,
  localDate,
  money,
  ruleId,
  transactionId,
} from "@holt/core";
import { afterEach, describe, expect, it } from "vitest";
import { createFactsStore, openFactsStore } from "./index.ts";
import { prepareStatements, writePatch } from "./store.ts";
import { differences, factsBuilder, storeDeps, testDatabase, testId } from "./test-support.ts";

let database: ReturnType<typeof testDatabase> | undefined;
afterEach(() => database?.dispose());

const base = () => {
  const b = factsBuilder();
  const account = b.account({ name: "Everyday" });
  b.group();
  b.buffer({ monthly: money(1_000) });
  return { facts: b.facts(), account };
};

const batch = (n: number, fingerprint: string, undone = false): ImportBatch => ({
  id: importBatchId(testId(2_000 + n)),
  fileName: `file-${n}.csv`,
  fingerprint,
  format: "bulder-csv",
  importedAt: "2026-06-15T09:00:00.000Z",
  from: localDate("2026-01-01"),
  to: localDate("2026-01-31"),
  rows: 1,
  created: 1,
  matched: 0,
  pending: 0,
  undone,
});

const withBatches = (facts: Facts, ...batches: ImportBatch[]): Facts => ({ ...facts, importBatches: new Map(batches.map((b) => [b.id, b])) });
const fingerprintA = "a".repeat(64);
const fingerprintB = "b".repeat(64);

const sql = () => database!.db;
const insertBatch = (n: number, fingerprint: string, undone = 0): void => {
  sql()
    .prepare("insert into import_batches (id, file_name, fingerprint, format, imported_at, from_date, to_date, row_count, created, matched, pending, undone) values (?, 'f.csv', ?, 'bulder-csv', '2026-06-15T09:00:00.000Z', '2026-01-01', '2026-01-31', 1, 1, 0, 0, ?)")
    .run(testId(3_000 + n), fingerprint, undone);
};

describe("the same file twice, even if core is bypassed", () => {
  it("is refused while the first import is live", () => {
    database = testDatabase();
    createFactsStore(database.db, base().facts, storeDeps());
    insertBatch(1, fingerprintA);
    expect(() => insertBatch(2, fingerprintA)).toThrow(/UNIQUE/);
    expect(() => insertBatch(2, fingerprintB)).not.toThrow();
  });

  it("is allowed once the first import was undone, and refused again if that undo is reversed", () => {
    database = testDatabase();
    createFactsStore(database.db, base().facts, storeDeps());
    insertBatch(1, fingerprintA);
    sql().prepare("update import_batches set undone = 1 where id = ?").run(testId(3_001));
    expect(() => insertBatch(2, fingerprintA)).not.toThrow();
    expect(() => sql().prepare("update import_batches set undone = 0 where id = ?").run(testId(3_001))).toThrow(/UNIQUE/);
  });

  it("allows any number of undone imports of one file", () => {
    database = testDatabase();
    createFactsStore(database.db, base().facts, storeDeps());
    for (const n of [1, 2, 3]) insertBatch(n, fingerprintA, 1);
    expect((sql().prepare("select count(*) as n from import_batches").get() as { n: number }).n).toBe(3);
  });
});

describe("one file backs a transaction at most once", () => {
  const prepareRows = () => {
    database = testDatabase();
    const { facts, account } = base();
    createFactsStore(database.db, facts, storeDeps());
    insertBatch(1, fingerprintA);
    insertBatch(2, fingerprintB);
    const shop = transactionId(testId(4_000));
    sql().prepare("insert into transactions (id, account_id, booking_date, amount, description, treatment) values (?, ?, '2026-03-05', -100, 'Shop', '{\"kind\":\"needsYou\"}')").run(shop, account);
    const row = (n: number, batchN: number, backs: string | null): void => {
      sql()
        .prepare("insert into import_rows (id, batch_id, line, account_id, booking_date, description, amount, fingerprint, pending, backs) values (?, ?, ?, ?, '2026-03-05', 'Shop', -100, 'f', 0, ?)")
        .run(testId(5_000 + n), testId(3_000 + batchN), n, account, backs);
    };
    return { shop, row };
  };

  it("refuses two rows of one file that back the same transaction", () => {
    const { shop, row } = prepareRows();
    row(1, 1, shop);
    expect(() => row(2, 1, shop)).toThrow(/UNIQUE/);
  });

  it("lets rows of different files back the same transaction", () => {
    const { shop, row } = prepareRows();
    row(1, 1, shop);
    expect(() => row(2, 2, shop)).not.toThrow();
  });

  it("lets any number of rows of a file back nothing", () => {
    const { row } = prepareRows();
    row(1, 1, null);
    expect(() => row(2, 1, null)).not.toThrow();
  });
});

describe("accounts", () => {
  const insertAccount = (n: number, number: string | null, rhythm: string | null = null): void => {
    sql()
      .prepare("insert into accounts (id, name, kind, scope, opening_balance, opening_date, number, import_rhythm) values (?, 'A', 'everyday', 'shared', 0, '2026-01-01', ?, ?)")
      .run(testId(6_000 + n), number, rhythm);
  };

  it("never gives two accounts one number, but any number of accounts none", () => {
    database = testDatabase();
    createFactsStore(database.db, base().facts, storeDeps());
    insertAccount(1, "12345678903");
    expect(() => insertAccount(2, "12345678903")).toThrow(/UNIQUE/);
    expect(() => insertAccount(3, null)).not.toThrow();
    expect(() => insertAccount(4, null)).not.toThrow();
  });

  it.each(["1234567890", "123456789012", "1234567890a", "1234567890 ", ""])("refuses the number %j, which is not 11 digits", (number) => {
    database = testDatabase();
    createFactsStore(database.db, base().facts, storeDeps());
    expect(() => insertAccount(1, number)).toThrow(/CHECK/);
  });

  it("accepts only the import rhythms the domain has", () => {
    database = testDatabase();
    createFactsStore(database.db, base().facts, storeDeps());
    for (const [n, rhythm] of ["weekly", "fortnightly", "monthly", null].entries()) expect(() => insertAccount(n + 1, null, rhythm)).not.toThrow();
    expect(() => insertAccount(9, null, "daily")).toThrow(/CHECK/);
  });
});

describe("the other rows", () => {
  it("holds one household at most", () => {
    database = testDatabase();
    createFactsStore(database.db, base().facts, storeDeps());
    expect(() => sql().prepare("insert into household (id, name, currency, plan_start, even_out_step) values (?, 'Other', 'NOK', '2026-01', 5000)").run(testId(7_000))).toThrow(/UNIQUE/);
  });

  it("keeps a job's columns to its own kind", () => {
    database = testDatabase();
    const { facts } = base();
    createFactsStore(database.db, facts, storeDeps());
    const group = [...facts.groups.keys()][0]!;
    const account = [...facts.accounts.keys()][0]!;
    const insert = (n: number, columns: string, values: string) =>
      sql().prepare(`insert into jobs (id, name, group_id, status, account_id, essential, opening, ${columns}) values ('${testId(8_000 + n)}', 'J', '${group}', 'active', '${account}', 0, 0, ${values})`).run();
    expect(() => insert(1, "kind, keeps_money, plan, seasonality", `'spend', 0, '{"mode":"followBills"}', 'auto'`)).not.toThrow();
    expect(() => insert(2, "kind, keeps_money, seasonality", `'spend', 0, 'auto'`)).toThrow(/CHECK/);
    expect(() => insert(3, "kind, keeps_money, plan, seasonality, role, target", `'spend', 0, '{"mode":"followBills"}', 'auto', 'ordinary', '{"kind":"monthly","amount":1}'`)).toThrow(/CHECK/);
    expect(() => insert(4, "kind, role, target", `'saveUp', 'ordinary', '{"kind":"monthly","amount":1}'`)).not.toThrow();
    expect(() => insert(5, "kind, role", `'saveUp', 'ordinary'`)).toThrow(/CHECK/);
    expect(() => insert(6, "kind, monthly", `'payInto', 5`)).toThrow(/CHECK/);
  });

  it("holds a treatment that is valid JSON of a known kind", () => {
    database = testDatabase();
    const { facts, account } = base();
    createFactsStore(database.db, facts, storeDeps());
    const insert = (n: number, treatment: string) =>
      sql().prepare("insert into transactions (id, account_id, booking_date, amount, description, treatment) values (?, ?, '2026-03-05', -1, 'x', ?)").run(testId(9_000 + n), account, treatment);
    expect(() => insert(1, '{"kind":"needsYou"}')).not.toThrow();
    expect(() => insert(2, '{"kind":"nonsense"}')).toThrow(/CHECK/);
    expect(() => insert(3, "not json")).toThrow(/CHECK/);
  });
});

describe("foreign keys are checked at commit, in any order", () => {
  const prepareTransaction = (id: number, account: AccountId, rule: RuleId | null): Transaction => ({
    id: transactionId(testId(id)),
    accountId: account,
    bookingDate: localDate("2026-03-05"),
    amount: money(-100),
    description: "Shop",
    treatment: { kind: "needsYou" },
    ...(rule === null ? {} : { ruleId: rule }),
  });
  const rule = (id: number, job: JobId): Rule => ({ id: ruleId(testId(id)), match: { counterparty: "Shop" }, result: { kind: "job", jobId: job }, origin: "set", priority: 1 });

  it("lets a patch insert a transaction before the rule it names", () => {
    database = testDatabase();
    const { facts, account } = base();
    createFactsStore(database.db, facts, storeDeps());
    const newRule = rule(10, [...facts.jobs.keys()][0]!);
    const tx = prepareTransaction(11, account, newRule.id);
    const patch: Patch = [
      { table: "transactions", key: tx.id, before: null, after: tx },
      { table: "rules", key: newRule.id, before: null, after: newRule },
    ];
    database.db.transaction(() => writePatch(prepareStatements(database!.db), patch)).immediate();
    expect(database.db.pragma("foreign_key_check")).toEqual([]);
    expect(openFactsStore(database.db, storeDeps())!.facts().transactions.get(tx.id)).toEqual(tx);
  });

  it("refuses at commit a patch that leaves a reference dangling, and keeps nothing of it", () => {
    database = testDatabase();
    const { facts, account } = base();
    const stored = createFactsStore(database.db, facts, storeDeps());
    const tx = prepareTransaction(12, account, ruleId(testId(99)));
    const patch: Patch = [{ table: "transactions", key: tx.id, before: null, after: tx }];
    expect(() => database!.db.transaction(() => writePatch(prepareStatements(database!.db), patch)).immediate()).toThrow(/FOREIGN KEY/);
    expect(database.db.inTransaction).toBe(false);
    expect(differences(openFactsStore(database.db, storeDeps())!.facts(), stored.facts())).toEqual([]);
  });

  it("refuses at commit a patch that deletes an account a job still uses", () => {
    database = testDatabase();
    const { facts, account } = base();
    createFactsStore(database.db, facts, storeDeps());
    const patch: Patch = [{ table: "accounts", key: account, before: facts.accounts.get(account)!, after: null }];
    expect(() => database!.db.transaction(() => writePatch(prepareStatements(database!.db), patch)).immediate()).toThrow(/FOREIGN KEY/);
    expect(openFactsStore(database.db, storeDeps())!.facts().accounts.has(account)).toBe(true);
  });
});

describe("a patch writes its rows in an order that never trips a unique value", () => {
  const written = (patch: Patch): void => {
    database!.db.transaction(() => writePatch(prepareStatements(database!.db), patch)).immediate();
    expect(database!.db.pragma("foreign_key_check")).toEqual([]);
  };

  it("lets a new import take the fingerprint an undone one gave up, whichever the patch lists first", () => {
    for (const order of [0, 1]) {
      database?.dispose();
      database = testDatabase();
      const { facts } = base();
      const old = batch(1, fingerprintA);
      createFactsStore(database.db, withBatches(facts, old), storeDeps());
      const undone = { ...old, undone: true };
      const fresh = batch(2, fingerprintA);
      const steps: Patch = [
        { table: "importBatches", key: fresh.id, before: null, after: fresh },
        { table: "importBatches", key: old.id, before: old, after: undone },
      ];
      written(order === 0 ? steps : [...steps].reverse());
      const reopened = openFactsStore(database.db, storeDeps())!.facts();
      expect([...reopened.importBatches.values()].map((b) => [b.id, b.undone]).sort()).toEqual([[old.id, true], [fresh.id, false]].sort());
    }
  });

  it("lets a new account take the number a deleted one held, whichever the patch lists first", () => {
    for (const order of [0, 1]) {
      database?.dispose();
      database = testDatabase();
      const { facts } = base();
      const first: Account = { id: accountId(testId(20)), name: "Old", kind: "everyday", scope: "shared", openingBalance: money(0), openingDate: localDate("2026-01-01"), number: accountNumber("12345678903") };
      createFactsStore(database.db, { ...facts, accounts: new Map([...facts.accounts, [first.id, first]]) }, storeDeps());
      const second: Account = { ...first, id: accountId(testId(21)), name: "New" };
      const steps: Patch = [
        { table: "accounts", key: second.id, before: null, after: second },
        { table: "accounts", key: first.id, before: first, after: null },
      ];
      written(order === 0 ? steps : [...steps].reverse());
      const reopened = openFactsStore(database.db, storeDeps())!.facts();
      expect(reopened.accounts.has(first.id)).toBe(false);
      expect(reopened.accounts.get(second.id)?.number).toBe("12345678903");
    }
  });
});
