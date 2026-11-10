import {
  type Command,
  type Facts,
  type LocalDate,
  type Transaction,
  type TransactionId,
  accountNumber,
  enteredValueId,
  groupId,
  localDate,
  makeSplit,
  maxStoredBatchCommands,
  money,
  moveId,
  proposalId,
  rowsEqual,
  tableNames,
  tablesOf,
  transactionId,
} from "@holt/core";
import { afterEach, describe, expect, it } from "vitest";
import { columns } from "./columns.ts";
import { HouseholdExistsError, StoreDivergence, UnstorableChangeError, createFactsStore, openFactsStore } from "./index.ts";
import { arbitraryFacts, arbitraryScript, differences, factsBuilder, fc, kr, storeDeps, testDatabase, testId } from "./test-support.ts";

type Database = ReturnType<typeof testDatabase>;
let database: Database | undefined;
const open = (): Database => {
  database?.dispose();
  return (database = testDatabase());
};
afterEach(() => database?.dispose());

const addGroup = (facts: Facts, n: number): Command => ({
  kind: "addGroup",
  group: { id: groupId(testId(900_000 + n)), name: `Extra ${n}`, order: facts.groups.size, countsTowardsSavingsRate: false },
});

describe("P1: facts survive being stored", () => {
  it("opens as the facts that were created, on every table", () => {
    fc.assert(
      fc.property(arbitraryFacts(), (facts) => {
        const db = open();
        const created = createFactsStore(db.db, facts, storeDeps());
        expect(differences(created.facts(), facts)).toEqual([]);
        const reopened = openFactsStore(db.reopen(), storeDeps());
        expect(differences(reopened!.facts(), facts)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  }, 60_000);

  it("is not vacuous: the generator fills every table and both sides of every optional column", () => {
    const samples = fc.sample(arbitraryFacts(), 200);
    const rowsOf = (name: (typeof tableNames)[number]): object[] => samples.flatMap((facts) => tablesOf(facts)[name] as readonly object[]);
    const valueAt = (row: object, field: string): unknown => field.split(".").reduce<unknown>((value, part) => (value === undefined || value === null ? undefined : (value as Record<string, unknown>)[part]), row);
    // groups.countsTowardsSavingsRate and moves.completedBy are never set by the generator; the edge-values test below covers them.
    const uncovered = new Set(["groups.countsTowardsSavingsRate", "moves.completedBy"]);
    for (const name of tableNames) {
      const rows = rowsOf(name);
      expect(rows.length, `${name} has rows`).toBeGreaterThan(0);
      for (const col of columns[name].columns) {
        if (col.optional !== true && col.nullable !== true && col.bool !== true) continue;
        if (uncovered.has(`${name}.${col.field}`)) continue;
        const values = rows.map((row) => valueAt(row, col.field));
        const present = values.filter((v) => v !== undefined && v !== null);
        if (col.bool === true) expect(new Set(present).size, `${name}.${col.field} takes both values`).toBe(2);
        else {
          expect(present.length, `${name}.${col.field} is sometimes set`).toBeGreaterThan(0);
          expect(present.length, `${name}.${col.field} is sometimes empty`).toBeLessThan(values.length);
        }
      }
    }
  });

  it("keeps edge values: a move completed by a transaction, a saving group, fractions, extremes, empty and awkward text", () => {
    const b = factsBuilder();
    const everyday = b.account({ name: "Everyday" });
    const savings = b.account({ name: "Savings", kind: "savings" });
    const group = b.group({ name: "Sparing", countsTowardsSavingsRate: true });
    b.buffer({ monthly: kr(500), groupId: group });
    const [out] = b.transfer({ from: everyday, to: savings, date: "2026-03-02", amount: kr(1_000) });
    const base = b.facts();
    const awkward = "Ærlig, Øl & Åse \"quoted\" 'single'; drop table x; -- \\ \n\t emoji \u{1F4B8} {\"kind\":\"history\"}";
    const awkwardTransaction: Transaction = {
      id: transactionId(testId(500)),
      accountId: everyday,
      bookingDate: localDate("2026-03-03"),
      amount: money(Number.MIN_SAFE_INTEGER),
      description: awkward,
      treatment: makeSplit(money(Number.MIN_SAFE_INTEGER), [{ jobId: [...base.jobs.keys()][0]!, amount: money(Number.MIN_SAFE_INTEGER) }]),
      counterparty: "",
      reference: "",
      note: awkward,
      transactionDate: localDate("2026-03-01"),
    };
    const numbered = { ...base.accounts.get(everyday)!, number: accountNumber("12345678903") };
    const facts: Facts = {
      ...base,
      accounts: new Map([...base.accounts, [everyday, numbered]]),
      transactions: new Map([...base.transactions, [awkwardTransaction.id, awkwardTransaction]]),
      moves: new Map([[moveId(testId(600)), { id: moveId(testId(600)), from: everyday, to: savings, amount: money(Number.MAX_SAFE_INTEGER), month: base.household.values().next().value!.planStart, reason: awkward, status: "done", completedBy: out }]]),
      enteredValues: new Map(
        [0.1, 1 / 3, 123456.789, 1e-7, 1e15, -2.5].map((value, i) => {
          const id = enteredValueId(testId(700 + i));
          return [id, { id, kind: "figure" as const, subject: `s${i}`, value, unit: "months" as const, asOf: localDate("2026-03-01"), source: awkward }] as const;
        }),
      ),
    };
    const db = open();
    createFactsStore(db.db, facts, storeDeps());
    const reopened = openFactsStore(db.reopen(), storeDeps())!;
    expect(differences(reopened.facts(), facts)).toEqual([]);
    expect(rowsEqual(tablesOf(reopened.facts()).groups, tablesOf(facts).groups)).toBe(true);
  });
});

describe("opening and creating", () => {
  it("opens as null when no household exists", () => {
    expect(openFactsStore(open().db, storeDeps())).toBeNull();
  });

  it("refuses to create a second household and changes nothing", () => {
    const db = open();
    const facts = factsBuilder().facts();
    createFactsStore(db.db, facts, storeDeps());
    const other = factsBuilder();
    other.account();
    expect(() => createFactsStore(db.db, other.facts(), storeDeps())).toThrow(HouseholdExistsError);
    expect(differences(openFactsStore(db.db, storeDeps())!.facts(), facts)).toEqual([]);
  });

  it("refuses facts that hold no household", () => {
    const db = open();
    const facts = factsBuilder().facts();
    expect(() => createFactsStore(db.db, { ...facts, household: new Map() }, storeDeps())).toThrow(/exactly one household/);
    expect(openFactsStore(db.db, storeDeps())).toBeNull();
  });

  it("writes nothing when the first population fails part way", () => {
    const db = open();
    const b = factsBuilder();
    const first = b.account();
    const second = b.account();
    const facts = b.facts();
    const same = accountNumber("12345678903");
    const clash: Facts = { ...facts, accounts: new Map([...facts.accounts].map(([id, a]) => [id, { ...a, number: same }])) };
    expect(clash.accounts.size).toBe(2);
    expect(first).not.toBe(second);
    expect(() => createFactsStore(db.db, clash, storeDeps())).toThrow(/UNIQUE/);
    expect(openFactsStore(db.db, storeDeps())).toBeNull();
    expect((db.db.prepare("select count(*) as n from accounts").get() as { n: number }).n).toBe(0);
  });

  it("makes every commit durable, though a reopened WAL database starts with the weaker NORMAL sync", () => {
    const db = open();
    createFactsStore(db.db, factsBuilder().facts(), storeDeps());
    const reopened = db.reopen();
    openFactsStore(reopened, storeDeps());
    expect(reopened.pragma("synchronous", { simple: true })).toBe(2);
    expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("what run and step return", () => {
  const starting = () => {
    const b = factsBuilder();
    b.account();
    b.group();
    b.buffer({ monthly: kr(100) });
    return b.facts();
  };
  const record = (facts: Facts, n: number): Command => ({
    kind: "recordTransaction",
    transaction: { id: transactionId(testId(1_000 + n)), accountId: [...facts.accounts.keys()][0]!, bookingDate: localDate("2026-03-05"), amount: money(-100 * n), description: `Shop ${n}`, treatment: { kind: "needsYou" } },
  });

  it("applies a command: the patch, the revision, the change and the heads", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    expect(store.revision).toBe(0);
    const result = store.run(record(store.facts(), 1));
    expect(result).toMatchObject({ status: "applied", base: 0, revision: 1, today: "2026-06-15", change: { kind: "recordTransaction", by: { kind: "family" } } });
    if (result.status !== "applied") return;
    expect(result.patch).toEqual([{ table: "transactions", key: transactionId(testId(1_001)), before: null, after: store.facts().transactions.get(transactionId(testId(1_001))) }]);
    expect(result.head).toEqual({ undo: result.change, redo: null });
    expect(store.revision).toBe(1);
  });

  it("records who made the change when main says so", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    const by = { kind: "proposal" as const, proposalId: proposalId(testId(77)) };
    const result = store.run(record(store.facts(), 1), by);
    expect(result.status === "applied" && result.change.by).toEqual(by);
  });

  it("refuses without writing anything or counting a revision", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    store.run(record(store.facts(), 1));
    const before = store.facts();
    const result = store.run(record(store.facts(), 1));
    expect(result).toMatchObject({ status: "refused", refusal: { code: "idTaken" } });
    expect(store.revision).toBe(1);
    expect(store.facts()).toBe(before);
    expect((database!.db.prepare("select count(*) as n from changes").get() as { n: number }).n).toBe(1);
  });

  it("undoes with the inverse patch and redoes with the original, moving the heads", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    const start = store.facts();
    const done = store.run(record(store.facts(), 1));
    if (done.status !== "applied") throw new Error("expected applied");
    const undone = store.step("undo");
    expect(undone).toMatchObject({ status: "applied", base: 1, revision: 2, change: done.change, head: { undo: null, redo: done.change } });
    expect(undone.status === "applied" && undone.patch).toEqual([{ ...done.patch[0], before: done.patch[0]!.after, after: null }]);
    expect(differences(store.facts(), start)).toEqual([]);
    const redone = store.step("redo");
    expect(redone).toMatchObject({ status: "applied", revision: 3, head: { undo: done.change, redo: null } });
    expect(redone.status === "applied" && redone.patch).toEqual(done.patch);
  });

  it("says there is nothing to undo or redo, and changes nothing", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    expect(store.step("undo")).toEqual({ status: "conflict", conflict: { kind: "nothingToUndo" } });
    expect(store.step("redo")).toEqual({ status: "conflict", conflict: { kind: "nothingToRedo" } });
    expect(store.revision).toBe(0);
  });

  it("snapshots the tables, the heads and today at the current revision", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    const result = store.run(record(store.facts(), 1));
    expect(store.snapshot()).toEqual({ revision: 1, today: "2026-06-15", tables: tablesOf(store.facts()), head: result.status === "applied" ? result.head : null });
  });

  it("stamps each change with the clock and a new ID", () => {
    const store = createFactsStore(open().db, starting(), storeDeps("2026-06-15", Date.parse("2026-06-15T09:00:00Z")));
    const a = store.run(record(store.facts(), 1));
    const b = store.run(record(store.facts(), 2));
    if (a.status !== "applied" || b.status !== "applied") throw new Error("expected applied");
    expect(a.change.at).toBe("2026-06-15T09:00:00.000Z");
    expect(b.change.at).toBe("2026-06-15T09:00:01.000Z");
    expect(a.change.id).not.toBe(b.change.id);
  });
});

describe("what is written must read back", () => {
  const starting = () => {
    const b = factsBuilder();
    b.account();
    b.group();
    b.buffer({ monthly: kr(100) });
    return b.facts();
  };
  // A cast, because the date constructor would refuse the date this test needs core to let through.
  const record = (facts: Facts, n: number, bookingDate = "2026-03-05"): Command => ({
    kind: "recordTransaction",
    transaction: { id: transactionId(testId(1_000 + n)), accountId: [...facts.accounts.keys()][0]!, bookingDate: bookingDate as LocalDate, amount: money(-100 * n), description: `Shop ${n}`, treatment: { kind: "needsYou" } },
  });
  const changes = (): number => (database!.db.prepare("select count(*) as n from changes").get() as { n: number }).n;

  it("refuses a batch bigger than core reads back, and the changes already stored still undo", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    store.run(record(store.facts(), 1));
    const before = store.facts();
    const tooMany: Command = { kind: "batch", commands: Array.from({ length: maxStoredBatchCommands + 1 }, () => ({ kind: "batch", commands: [] })) };
    expect(() => store.run(tooMany)).toThrow(UnstorableChangeError);
    expect(store.facts()).toBe(before);
    expect(store.revision).toBe(1);
    expect(changes()).toBe(1);
    expect(store.step("undo").status).toBe("applied");
    expect(store.facts().transactions.size).toBe(0);
  });

  it("refuses a row core's schema would not read back, such as a date that is not on the calendar", () => {
    const store = createFactsStore(open().db, starting(), storeDeps());
    const before = store.facts();
    expect(() => store.run(record(before, 1, "2026-02-30"))).toThrow(UnstorableChangeError);
    expect(store.facts()).toBe(before);
    expect(changes()).toBe(0);
    expect((database!.db.prepare("select count(*) as n from transactions").get() as { n: number }).n).toBe(0);
    expect(openFactsStore(database!.reopen(), storeDeps())).not.toBeNull();
  });
});

const script = () => arbitraryScript({ minSteps: 5, maxSteps: 25 });

describe("P2: what is in memory is what a reopened store loads", () => {
  it("holds after every command of a random script, and the database stays consistent", () => {
    fc.assert(
      fc.property(script(), (s) => {
        const db = open();
        let store = createFactsStore(db.db, s.start, storeDeps(s.asOf));
        let steps = 0;
        for (const command of s.commands(() => store.facts())) {
          store.run(command);
          const inMemory = store.facts();
          // Every step loads the facts afresh; every fourth also closes and reopens the file, as a restart does.
          store = openFactsStore(steps++ % 4 === 3 ? db.reopen() : db.db, storeDeps(s.asOf))!;
          expect(differences(store.facts(), inMemory)).toEqual([]);
          expect(db.db.pragma("foreign_key_check")).toEqual([]);
        }
      }),
      { numRuns: 25 },
    );
  }, 60_000);
});

describe("P3: undo and redo across sessions", () => {
  it("n undos give the facts after each prefix, n redos return, and a new command clears redo on disk", () => {
    fc.assert(
      fc.property(script(), (s) => {
        const db = open();
        let store = createFactsStore(db.db, s.start, storeDeps(s.asOf));
        const prefixes: Facts[] = [store.facts()];
        for (const command of s.commands(() => store.facts())) if (store.run(command).status === "applied") prefixes.push(store.facts());
        const n = prefixes.length - 1;

        store = openFactsStore(db.reopen(), storeDeps(s.asOf))!;
        for (let i = n; i >= 1; i -= 1) {
          expect(store.step("undo").status).toBe("applied");
          expect(differences(store.facts(), prefixes[i - 1]!), `after undoing change ${i}`).toEqual([]);
          if (i % 3 === 0) store = openFactsStore(db.reopen(), storeDeps(s.asOf))!;
        }
        expect(store.step("undo")).toMatchObject({ status: "conflict", conflict: { kind: "nothingToUndo" } });

        store = openFactsStore(db.reopen(), storeDeps(s.asOf))!;
        for (let i = 1; i <= n; i += 1) {
          expect(store.step("redo").status).toBe("applied");
          expect(differences(store.facts(), prefixes[i]!), `after redoing change ${i}`).toEqual([]);
        }
        expect(store.step("redo")).toMatchObject({ status: "conflict", conflict: { kind: "nothingToRedo" } });

        if (n >= 2) {
          store.step("undo");
          store.step("undo");
          const fresh = store.run(addGroup(store.facts(), 1));
          expect(fresh.status).toBe("applied");
          expect(fresh.status === "applied" && fresh.head.redo).toBeNull();
          expect(store.step("redo")).toMatchObject({ status: "conflict", conflict: { kind: "nothingToRedo" } });
          const reopened = openFactsStore(db.reopen(), storeDeps(s.asOf))!;
          expect(reopened.step("redo")).toMatchObject({ status: "conflict", conflict: { kind: "nothingToRedo" } });
          expect((db.db.prepare("select count(*) as n from changes where status = 'undone'").get() as { n: number }).n).toBe(0);
          expect((db.db.prepare("select count(*) as n from changes").get() as { n: number }).n).toBe(n - 2 + 1);
        }
      }),
      { numRuns: 25 },
    );
  }, 60_000);
});

describe("P7: the undone stack always sits above the done stack", () => {
  it("holds after any sequence of runs, undos and redos", () => {
    fc.assert(
      fc.property(script(), fc.array(fc.constantFrom("run", "run", "undo", "redo"), { minLength: 1, maxLength: 40 }), (s, operations) => {
        const db = open();
        const store = createFactsStore(db.db, s.start, storeDeps(s.asOf));
        const commands = s.commands(() => store.facts());
        const seqs = (status: string): number[] => (db.db.prepare("select seq from changes where status = ? order by seq").all(status) as { seq: number }[]).map((r) => r.seq);
        let expectedDone = 0;
        let expectedUndone = 0;
        for (const operation of operations) {
          if (operation === "run") {
            const next = commands.next();
            if (!next.done && store.run(next.value).status === "applied") {
              expectedDone += 1;
              expectedUndone = 0;
            }
          } else if (store.step(operation).status === "applied") {
            const moved = operation === "undo" ? -1 : 1;
            expectedDone += moved;
            expectedUndone -= moved;
          }
          const done = seqs("done");
          const undone = seqs("undone");
          expect(done.length).toBe(expectedDone);
          expect(undone.length).toBe(expectedUndone);
          if (done.length > 0 && undone.length > 0) expect(Math.min(...undone)).toBeGreaterThan(Math.max(...done));
          expect(new Set([...done, ...undone]).size).toBe(done.length + undone.length);
        }
      }),
      { numRuns: 40 },
    );
  }, 60_000);
});

describe("P5: a row changed behind the store's back stops the next change that touches it", () => {
  const starting = () => {
    const b = factsBuilder();
    const account = b.account();
    b.group();
    b.buffer({ monthly: kr(100) });
    const shop = b.needsYou({ date: "2026-03-05", amount: money(-12_300), description: "Shop" });
    const other = b.needsYou({ date: "2026-03-06", amount: money(-4_500), description: "Cafe" });
    return { facts: b.facts(), shop, other, account };
  };
  const note = (id: TransactionId, text = "Checked"): Command => ({ kind: "setNote", transactionId: id, note: text });
  const count = (table: string): number => (database!.db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

  it("refuses a change to a row whose value was altered", () => {
    const { facts, shop } = starting();
    const store = createFactsStore(open().db, facts, storeDeps());
    database!.db.prepare("update transactions set amount = amount - 1 where id = ?").run(shop);
    expect(() => store.run(note(shop))).toThrow(StoreDivergence);
    expect(differences(store.facts(), facts)).toEqual([]);
    expect(store.revision).toBe(0);
    expect(count("changes")).toBe(0);
    expect(database!.db.prepare("select note from transactions where id = ?").get(shop)).toEqual({ note: null });
  });

  it("refuses a change to a row that was deleted", () => {
    const { facts, shop } = starting();
    const store = createFactsStore(open().db, facts, storeDeps());
    database!.db.prepare("delete from transactions where id = ?").run(shop);
    expect(() => store.run(note(shop))).toThrow(StoreDivergence);
    expect(differences(store.facts(), facts)).toEqual([]);
    expect(count("changes")).toBe(0);
  });

  it("changes nothing at all when only one of several rows has drifted", () => {
    const { facts, shop, other } = starting();
    const store = createFactsStore(open().db, facts, storeDeps());
    database!.db.prepare("update transactions set description = 'Tampered' where id = ?").run(other);
    const both: Command = { kind: "batch", commands: [note(shop, "One"), note(other, "Two")] };
    expect(() => store.run(both)).toThrow(StoreDivergence);
    expect(database!.db.prepare("select note from transactions where id = ?").get(shop)).toEqual({ note: null });
    expect(count("changes")).toBe(0);
  });

  it("refuses an insert whose key already exists behind its back", () => {
    const { facts, account } = starting();
    const store = createFactsStore(open().db, facts, storeDeps());
    const taken = transactionId(testId(4_000));
    database!.db.prepare("insert into transactions (id, account_id, booking_date, amount, description, treatment) values (?, ?, '2026-03-01', 1, 'x', '{\"kind\":\"needsYou\"}')").run(taken, account);
    const record: Command = { kind: "recordTransaction", transaction: { id: taken, accountId: account, bookingDate: localDate("2026-03-02"), amount: money(-5), description: "New", treatment: { kind: "needsYou" } } };
    expect(() => store.run(record)).toThrow();
    expect(differences(store.facts(), facts)).toEqual([]);
    expect(count("changes")).toBe(0);
  });

  it("refuses to undo over a row that drifted, and keeps the change on the stack", () => {
    const { facts, shop } = starting();
    const store = createFactsStore(open().db, facts, storeDeps());
    store.run(note(shop));
    database!.db.prepare("update transactions set note = 'Edited elsewhere' where id = ?").run(shop);
    expect(() => store.step("undo")).toThrow(StoreDivergence);
    expect(count("changes")).toBe(1);
    expect(database!.db.prepare("select status from changes").get()).toEqual({ status: "done" });
  });
});

describe("a stored change that no longer fits the facts", () => {
  const prepared = () => {
    const b = factsBuilder();
    b.account();
    b.group();
    b.buffer({ monthly: kr(100) });
    const shop = b.needsYou({ date: "2026-03-05", amount: money(-12_300), description: "Shop" });
    const facts = b.facts();
    const store = createFactsStore(open().db, facts, storeDeps());
    store.run({ kind: "setNote", transactionId: shop, note: "Checked" });
    return { store, shop, facts };
  };

  it("returns a conflict for an undo whose rows were changed since, and changes nothing", () => {
    const { store, shop } = prepared();
    const db = database!.db;
    const stored = db.prepare("select patch from changes").get() as { patch: string };
    const patch = JSON.parse(stored.patch) as { after: { note: string } }[];
    patch[0]!.after.note = "Not what is there";
    db.prepare("update changes set patch = ?").run(JSON.stringify(patch));
    const before = store.facts();
    const result = store.step("undo");
    expect(result).toMatchObject({ status: "conflict", conflict: { kind: "rowsChanged" } });
    expect(store.facts()).toBe(before);
    expect(store.revision).toBe(1);
    expect(db.prepare("select status from changes").get()).toEqual({ status: "done" });
    expect(db.prepare("select note from transactions where id = ?").get(shop)).toEqual({ note: "Checked" });
  });

  it("refuses to load a stored command or row that breaks core's schemas", () => {
    const { store } = prepared();
    const db = database!.db;
    db.prepare("update changes set command = '{\"kind\":\"setNote\",\"transactionId\":\"nope\",\"note\":\"x\"}'").run();
    expect(() => store.step("undo")).toThrow(/ID/);
    expect(store.revision).toBe(1);
  });

  it("refuses to load a row that breaks a rule, such as a split that does not add up", () => {
    const b = factsBuilder();
    const account = b.account();
    b.group();
    const job = b.buffer({ monthly: kr(100) });
    b.spend({ date: "2026-03-05", amount: money(-1_000), jobId: job });
    const db = open();
    createFactsStore(db.db, b.facts(), storeDeps());
    expect(account).toBeDefined();
    db.db.prepare(`update transactions set treatment = json_set(treatment, '$.allocations[0].amount', -1)`).run();
    expect(() => openFactsStore(db.db, storeDeps())).toThrow(/add up/);
  });

  it("refuses to load a row that holds a value its field cannot", () => {
    const db = open();
    createFactsStore(db.db, factsBuilder().facts(), storeDeps());
    db.db.pragma("ignore_check_constraints = ON");
    db.db.prepare("update household set currency = 'nok'").run();
    db.db.pragma("ignore_check_constraints = OFF");
    expect(() => openFactsStore(db.db, storeDeps())).toThrow();
  });
});

