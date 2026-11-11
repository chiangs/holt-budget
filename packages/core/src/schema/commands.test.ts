import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { accountNumber } from "../account-number.ts";
import { type Command, apply, commandKinds } from "../commands/apply.ts";
import { localDate, month } from "../dates.ts";
import { type Facts, makeSplit } from "../facts.ts";
import { accountId, agreementId, bucketTransferId, enteredValueId, groupId, importBatchId, importRowId, jobId, moveId, personId, ruleId, transactionId } from "../ids.ts";
import { currency, money } from "../money.ts";
import { rowsEqual } from "../patch.ts";
import { arbitraryFacts } from "../testing/arbitrary-facts.ts";
import { arbitraryScript } from "../testing/arbitrary-commands.ts";
import { testId } from "../testing/facts-builder.ts";
import { CommandSchema, FamilyCommandSchema, commandSchemas, familyCommandKinds, maxBatchCommands, maxBatchDepth, maxStoredBatchCommands } from "./commands.ts";
import { problems } from "./test-helpers.ts";

const account = accountId(testId(1));
const job = jobId(testId(2));
const group = groupId(testId(3));
const tx = transactionId(testId(4));
const otherTx = transactionId(testId(5));
const batchId = importBatchId(testId(6));
const rule = ruleId(testId(7));
const mv = moveId(testId(8));
const person = personId(testId(13));
const agreement = agreementId(testId(14));
const transferId = bucketTransferId(testId(15));

const accountRow = { id: account, name: "Everyday", kind: "everyday", scope: "shared", openingBalance: money(0), openingDate: localDate("2026-01-01"), number: accountNumber("12345678901"), importRhythm: "weekly" } as const;
const transaction = {
  id: tx,
  accountId: account,
  bookingDate: localDate("2026-02-03"),
  amount: money(-10_000),
  description: "Card",
  counterparty: "Kiwi",
  treatment: makeSplit(money(-10_000), [{ jobId: job, amount: money(-6_000) }, { jobId: job, amount: money(-4_000) }]),
} as const;
const ruleRow = { id: rule, match: { counterparty: "Kiwi", accountId: account, min: money(-5_000), max: money(0) }, result: { kind: "split", shares: [{ jobId: job, weight: 2 }, { jobId: job, weight: 1 }] }, origin: "learned", priority: 3 } as const;
const importFile = {
  kind: "importFile",
  batch: { id: batchId, fileName: "march.csv", fingerprint: "b".repeat(64), format: "bulder-csv", importedAt: "2026-03-01T10:00:00.000Z", from: localDate("2026-02-01"), to: localDate("2026-02-28"), rows: 1, created: 1, matched: 0, pending: 0, undone: false },
  rows: [
    { id: importRowId(testId(9)), batchId, line: 1, accountId: account, bookingDate: localDate("2026-02-03"), description: "Card", amount: money(-10_000), fingerprint: "fp", pending: false, backs: tx, original: { text: "10 EUR", currency: "EUR" } },
  ],
  transactions: [transaction],
} as const satisfies Extract<Command, { kind: "importFile" }>;

/** One command of every kind. A new kind fails to compile here until it has an example. */
const examples = {
  changeHousehold: { kind: "changeHousehold", changes: { name: "Home", currency: currency("NOK"), planStart: month("2026-01"), evenOutStep: money(5_000) } },
  addAccount: { kind: "addAccount", account: accountRow },
  changeAccount: { kind: "changeAccount", accountId: account, changes: { name: "Joint", kind: "bills", number: null, importRhythm: "fortnightly" } },
  addGroup: { kind: "addGroup", group: { id: group, name: "Living", order: 1, countsTowardsSavingsRate: true } },
  changeGroup: { kind: "changeGroup", groupId: group, changes: { name: "Fixed", order: 2, countsTowardsSavingsRate: false } },
  addJob: {
    kind: "addJob",
    job: { id: job, name: "Food", groupId: group, status: "active", accountId: account, essential: true, opening: money(0), kind: "spend", keepsMoney: false, plan: { mode: "evenOut", monthly: money(1_000), startMonth: month("2026-03") }, seasonality: "seasonal" },
  },
  changeJob: { kind: "changeJob", jobId: job, changes: { name: "Groceries", groupId: group, essential: false, status: "paused", ofKind: { kind: "spend", plan: { mode: "followBills" }, keepsMoney: true, seasonality: "auto" } } },
  deleteJob: { kind: "deleteJob", jobId: job },
  openMonth: { kind: "openMonth", month: month("2026-01") },
  closeMonth: { kind: "closeMonth", month: month("2026-01") },
  reopenMonth: { kind: "reopenMonth", month: month("2026-01") },
  assign: { kind: "assign", month: month("2026-01"), jobId: job, amount: money(5_000) },
  moveAssignment: { kind: "moveAssignment", month: month("2026-01"), from: job, to: jobId(testId(10)), amount: money(500) },
  addMove: { kind: "addMove", move: { id: mv, from: account, to: accountId(testId(11)), amount: money(1_000), month: month("2026-01"), reason: "Seed a bucket" } },
  setMoveStatus: { kind: "setMoveStatus", moveId: mv, status: "done", completedBy: tx },
  enterValue: { kind: "enterValue", value: { id: enteredValueId(testId(12)), kind: "figure", subject: "gross-income", value: 1.5, unit: "percent", asOf: localDate("2026-01-01"), source: "you" } },
  recordTransaction: { kind: "recordTransaction", transaction: { ...transaction, treatment: { kind: "split", allocations: [{ jobId: job, amount: money(-10_000) }] } } },
  setTreatment: { kind: "setTreatment", transactionId: tx, treatment: { kind: "income", fundsMonth: month("2026-03"), source: "recurring" } },
  setNote: { kind: "setNote", transactionId: tx, note: "Birthday" },
  importFile,
  undoImport: { kind: "undoImport", batchId },
  mergeTransactions: { kind: "mergeTransactions", keep: tx, drop: otherTx },
  pairTransfers: { kind: "pairTransfers", pairs: [{ a: tx, b: otherTx, completesMove: mv }] },
  addRule: { kind: "addRule", rule: ruleRow },
  changeRule: { kind: "changeRule", ruleId: rule, changes: { match: ruleRow.match, result: { kind: "job", jobId: job }, priority: 9 } },
  deleteRule: { kind: "deleteRule", ruleId: rule },
  setPlanStart: { kind: "setPlanStart", planStart: month("2026-02") },
  addPerson: { kind: "addPerson", person: { id: person, name: "Mia", kind: "child", birthMonth: month("2018-04") } },
  changePerson: { kind: "changePerson", personId: person, changes: { name: "Mia Rose", birthMonth: month("2018-05") } },
  deletePerson: { kind: "deletePerson", personId: person },
  addAgreement: { kind: "addAgreement", agreement: { id: agreement, personId: person, accountId: account, amount: money(900_000), day: 20, from: month("2026-10"), to: month("2027-09") } },
  changeAgreement: { kind: "changeAgreement", agreementId: agreement, changes: { amount: money(950_000), day: 21, accountId: account, to: month("2027-12") } },
  moveBucket: { kind: "moveBucket", transfer: { id: transferId, month: month("2026-11"), from: job, to: jobId(testId(10)), amount: money(410_000), reason: "Start evening out" } },
  batch: { kind: "batch", commands: [{ kind: "deleteRule", ruleId: rule }, { kind: "batch", commands: [{ kind: "setNote", transactionId: tx, note: "x" }] }] },
} as const satisfies { [K in Command["kind"]]: Extract<Command, { kind: K }> };

const moreExamples: readonly Command[] = [
  { kind: "setMoveStatus", moveId: mv, status: "skipped" },
  { kind: "changeAccount", accountId: account, changes: { number: accountNumber("98765432109") } },
  { kind: "changeAccount", accountId: account, changes: {} },
  { kind: "changeJob", jobId: job, changes: { ofKind: { kind: "saveUp", target: { kind: "amountByMonth", amount: money(1), readyBy: month("2027-01") } } } },
  { kind: "changeJob", jobId: job, changes: { ofKind: { kind: "payInto", monthly: money(2), payInto: account } } },
  { kind: "changeJob", jobId: job, changes: {} },
  { kind: "pairTransfers", pairs: [{ a: tx, b: otherTx }] },
  { kind: "setTreatment", transactionId: tx, treatment: { kind: "split", allocations: [{ jobId: job, amount: money(1) }] } },
  { kind: "setTreatment", transactionId: tx, treatment: { kind: "transfer", partner: null } },
  { kind: "setTreatment", transactionId: tx, treatment: { kind: "history", jobId: null } },
  { kind: "setTreatment", transactionId: tx, treatment: { kind: "needsYou" } },
  { kind: "changeRule", ruleId: rule, changes: {} },
  { kind: "changePerson", personId: person, changes: {} },
  { kind: "changePerson", personId: person, changes: { birthMonth: null } },
  { kind: "addPerson", person: { id: person, name: "Alex", kind: "adult" } },
  { kind: "changeAgreement", agreementId: agreement, changes: {} },
  { kind: "changeAgreement", agreementId: agreement, changes: { to: null } },
  { kind: "addAgreement", agreement: { id: agreement, personId: person, accountId: account, amount: money(1), day: 1, from: month("2026-10") } },
  { kind: "recordTransaction", transaction: { ...transaction, treatment: { kind: "income", fundsMonth: month("2026-11"), source: "contribution", agreement } } },
  { kind: "setTreatment", transactionId: tx, treatment: { kind: "income", fundsMonth: month("2026-11"), source: "contribution", agreement } },
  { kind: "batch", commands: [] },
];

const kindsOf = (list: Iterable<string>): string[] => [...list].sort();

function parsesToItself(schema: typeof CommandSchema, command: Command): void {
  const direct = schema.safeParse(command);
  expect(problems(direct)).toEqual([]);
  expect(rowsEqual(direct.data, command)).toBe(true);
  const viaJson = schema.safeParse(JSON.parse(JSON.stringify(command)));
  expect(problems(viaJson)).toEqual([]);
  expect(rowsEqual(viaJson.data, command)).toBe(true);
}

describe("the schemas know every command kind", () => {
  it("one schema per kind the handlers know, and an example of each in these tests", () => {
    expect(kindsOf(Object.keys(commandSchemas))).toEqual(kindsOf(commandKinds));
    expect(kindsOf(Object.keys(examples))).toEqual(kindsOf(commandKinds));
  });

  it("lists the family's kinds as every kind but importFile", () => {
    expect(kindsOf(familyCommandKinds)).toEqual(kindsOf(commandKinds.filter((kind) => kind !== "importFile")));
  });
});

describe("a command the app can apply", () => {
  for (const [kind, command] of Object.entries(examples)) {
    it(`of kind ${kind} comes back equal, also after a trip through JSON`, () => {
      parsesToItself(CommandSchema, command);
    });
  }

  it("also comes back equal in these further shapes", () => {
    for (const command of moreExamples) parsesToItself(CommandSchema, command);
  });

  it("is read the same by the family's schema, for every kind but importFile", () => {
    for (const command of [...Object.values(examples), ...moreExamples]) {
      if (command.kind === "importFile") continue;
      parsesToItself(FamilyCommandSchema as typeof CommandSchema, command);
    }
  });

  it("comes back equal for every command of a random script, refused ones included", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        let facts: Facts = script.start;
        for (const command of script.commands(() => facts)) {
          parsesToItself(CommandSchema, command);
          parsesToItself(FamilyCommandSchema as typeof CommandSchema, command);
          const result = apply(facts, command, { asOf: script.asOf });
          if (result.ok) facts = result.facts;
        }
      }),
    );
  });

  it("comes back equal for an import, its rules and a batch made of rows from random facts", () => {
    fc.assert(
      fc.property(arbitraryFacts(), (facts) => {
        const transactions = [...facts.transactions.values()].slice(0, 4);
        const commands: Command[] = [];
        for (const batch of facts.importBatches.values()) {
          commands.push({ kind: "importFile", batch, rows: [...facts.importRows.values()].filter((row) => row.batchId === batch.id), transactions });
          commands.push({ kind: "undoImport", batchId: batch.id });
        }
        for (const r of facts.rules.values()) {
          commands.push({ kind: "addRule", rule: r }, { kind: "changeRule", ruleId: r.id, changes: { match: r.match, result: r.result, priority: r.priority } }, { kind: "deleteRule", ruleId: r.id });
        }
        for (const account of facts.accounts.values()) commands.push({ kind: "addAccount", account });
        for (const t of transactions) commands.push({ kind: "recordTransaction", transaction: t });
        for (const command of commands) parsesToItself(CommandSchema, command);
        parsesToItself(CommandSchema, { kind: "batch", commands });
      }),
    );
  });
});

function refused(schema: typeof CommandSchema, input: unknown): string[] {
  const result = schema.safeParse(input);
  expect(result.success, JSON.stringify(input).slice(0, 200)).toBe(false);
  return problems(result);
}

describe("a command that does not belong is refused, and the problem names where it is", () => {
  it("for a kind that does not exist, or no kind", () => {
    expect(refused(CommandSchema, { kind: "dropEverything" })).toEqual(['kind: Unknown command kind "dropEverything".']);
    expect(refused(CommandSchema, { kinds: "openMonth" })).toEqual(["kind: A command needs a kind."]);
    expect(refused(CommandSchema, { kind: 5 })).toEqual(["kind: A command needs a kind."]);
    for (const value of [null, undefined, "openMonth", 7, []]) expect(CommandSchema.safeParse(value).success).toBe(false);
  });

  it("for an ID that is not a UUID", () => {
    expect(refused(CommandSchema, { kind: "deleteJob", jobId: "../etc/passwd" })).toEqual([expect.stringMatching(/^jobId: .*etc\/passwd/)]);
    expect(refused(CommandSchema, { kind: "mergeTransactions", keep: tx, drop: "x" })).toEqual([expect.stringMatching(/^drop: /)]);
  });

  it("for an amount that is negative zero or has a fraction", () => {
    expect(refused(CommandSchema, { ...examples.assign, amount: -0 })).toEqual([expect.stringMatching(/^amount: .*-0/)]);
    expect(refused(CommandSchema, { ...examples.assign, amount: 12.5 })).toEqual([expect.stringMatching(/^amount: .*12\.5/)]);
    expect(refused(CommandSchema, { ...examples.changeHousehold, changes: { evenOutStep: 0.1 } })).toEqual([expect.stringMatching(/^changes\.evenOutStep: /)]);
  });

  it("for a key the command does not have, at the top and deep inside", () => {
    expect(refused(CommandSchema, { ...examples.deleteJob, force: true })).toEqual([expect.stringMatching(/^: .*"force"/)]);
    expect(refused(CommandSchema, { ...examples.changeJob, changes: { ofKind: { kind: "spend", target: { kind: "monthly", amount: 1 } } } })).toEqual([expect.stringMatching(/^changes\.ofKind: .*"target"/)]);
    expect(refused(CommandSchema, { ...examples.addRule, rule: { ...ruleRow, secret: 1 } })).toEqual([expect.stringMatching(/^rule: .*"secret"/)]);
    expect(refused(CommandSchema, { ...examples.setMoveStatus, status: "skipped" })).toEqual([expect.stringMatching(/^: .*"completedBy"/)]);
  });

  it("for a split in a stored transaction that does not add up, while a command that carries a split leaves that check to apply, which refuses it in words for the family", () => {
    const split = { kind: "split", allocations: [{ jobId: job, amount: -9_999 }] };
    expect(refused(CommandSchema, { ...importFile, transactions: [{ ...transaction, treatment: split }] })).toEqual([expect.stringMatching(/^transactions\.0\.treatment\.allocations: .*add up/)]);
    expect(CommandSchema.safeParse({ ...examples.recordTransaction, transaction: { ...examples.recordTransaction.transaction, treatment: split } }).success).toBe(true);
    expect(CommandSchema.safeParse({ kind: "setTreatment", transactionId: tx, treatment: split }).success).toBe(true);
  });

  it("for a split with no allocations", () => {
    expect(refused(CommandSchema, { kind: "setTreatment", transactionId: tx, treatment: { kind: "split", allocations: [] } })).toEqual([expect.stringMatching(/^treatment\.allocations: .*at least one/)]);
  });

  it("for a move marked done without saying what completed it", () => {
    expect(refused(CommandSchema, { kind: "setMoveStatus", moveId: mv, status: "done" })).toEqual([expect.stringMatching(/^completedBy: /)]);
    expect(refused(CommandSchema, { kind: "setMoveStatus", moveId: mv, status: "paid" })).toEqual([expect.stringMatching(/^status: /)]);
  });

  it("for an account number that is not one, and for a missing number that was written as undefined", () => {
    expect(refused(CommandSchema, { ...examples.changeAccount, changes: { number: "abc" } })).toEqual([expect.stringMatching(/^changes\.number: /)]);
    expect(refused(CommandSchema, { ...examples.changeAccount, changes: { number: undefined } })).toEqual([expect.stringMatching(/^changes\.number: /)]);
  });

  it("for a person of a kind that does not exist, or a day or birth month that is not one", () => {
    expect(refused(CommandSchema, { ...examples.addPerson, person: { id: person, name: "Mia", kind: "pet" } })).toEqual([expect.stringMatching(/^person\.kind: /)]);
    expect(refused(CommandSchema, { ...examples.addPerson, person: { id: person, name: "Mia", kind: "child", birthMonth: "2018-13" } })).toEqual([expect.stringMatching(/^person\.birthMonth: /)]);
    expect(refused(CommandSchema, { ...examples.addAgreement, agreement: { ...examples.addAgreement.agreement, day: 20.5 } })).toEqual([expect.stringMatching(/^agreement\.day: /)]);
    expect(refused(CommandSchema, { ...examples.changeAgreement, changes: { to: undefined } })).toEqual([expect.stringMatching(/^changes\.to: /)]);
  });

  it("for an income that names an agreement without being a contribution", () => {
    const income = (source: string) => ({ kind: "setTreatment", transactionId: tx, treatment: { kind: "income", fundsMonth: "2026-11", source, agreement } });
    expect(CommandSchema.safeParse(income("contribution")).success).toBe(true);
    for (const source of ["recurring", "other"]) expect(refused(CommandSchema, income(source))).toEqual([expect.stringMatching(/^treatment\.agreement: .*contribution/)]);
  });

  it("for a bad row inside an import", () => {
    const badRow = { ...importFile.rows[0], accountId: "nope" };
    expect(refused(CommandSchema, { ...importFile, rows: [badRow] })).toEqual([expect.stringMatching(/^rows\.0\.accountId: /)]);
    const badSplit = { ...transaction, treatment: { kind: "split", allocations: [{ jobId: job, amount: -1 }] } };
    expect(refused(CommandSchema, { ...importFile, transactions: [badSplit] })).toEqual([expect.stringMatching(/^transactions\.0\.treatment\.allocations: /)]);
    expect(refused(CommandSchema, { ...importFile, rows: "all of them" })).toEqual([expect.stringMatching(/^rows: /)]);
  });
});

const leaf = { kind: "deleteRule", ruleId: rule } as const;
const batchOf = (commands: readonly unknown[]) => ({ kind: "batch", commands });
const leaves = (count: number) => Array.from({ length: count }, () => leaf);

describe("a batch", () => {
  it("holds up to 500 commands from the page", () => {
    expect(maxBatchCommands).toBe(500);
    expect(FamilyCommandSchema.safeParse(batchOf(leaves(500))).success).toBe(true);
    expect(refused(FamilyCommandSchema as typeof CommandSchema, batchOf(leaves(501)))).toEqual([expect.stringMatching(/^commands: .*at most 500 commands.* holds 501/)]);
  });

  it("counts the commands of the batches inside it, so nesting is no way round the page's limit", () => {
    expect(FamilyCommandSchema.safeParse(batchOf([batchOf(leaves(499))])).success).toBe(true);
    expect(refused(FamilyCommandSchema as typeof CommandSchema, batchOf([batchOf(leaves(500))]))).toEqual([expect.stringMatching(/^commands: .*at most 500 commands/)]);
    expect(refused(FamilyCommandSchema as typeof CommandSchema, batchOf([batchOf(leaves(300)), batchOf(leaves(300))]))).toEqual([expect.stringMatching(/^commands: .*holds 602/)]);
  });

  it("holds far more in a change the app stored itself, up to its own limit", () => {
    expect(maxStoredBatchCommands).toBeGreaterThan(10_000);
    expect(CommandSchema.safeParse(batchOf(leaves(5_000))).success).toBe(true);
    expect(CommandSchema.safeParse(batchOf([batchOf(leaves(2_500)), batchOf(leaves(2_500))])).success).toBe(true);
    expect(refused(CommandSchema, batchOf(leaves(maxStoredBatchCommands + 1)))).toEqual([expect.stringMatching(new RegExp(`^commands: .*at most ${maxStoredBatchCommands} commands.* holds ${maxStoredBatchCommands + 1}`))]);
  });

  describe("with pairs to make", () => {
    const pairs = (count: number) => Array.from({ length: count }, () => ({ a: tx, b: otherTx }));
    const pairing = (count: number) => ({ kind: "pairTransfers", pairs: pairs(count) });

    it("counts each pair as a command when it comes from the page, so a pairTransfers is no way round the limit", () => {
      expect(FamilyCommandSchema.safeParse(pairing(500)).success).toBe(true);
      expect(refused(FamilyCommandSchema as typeof CommandSchema, pairing(501))).toEqual([expect.stringMatching(/^pairs: .*at most 500 pairs/)]);
      expect(FamilyCommandSchema.safeParse(batchOf([pairing(499), leaf])).success).toBe(true);
      expect(refused(FamilyCommandSchema as typeof CommandSchema, batchOf([pairing(499), leaf, leaf]))).toEqual([expect.stringMatching(/^commands: .*at most 500 commands.* holds 501/)]);
      expect(refused(FamilyCommandSchema as typeof CommandSchema, batchOf([batchOf([pairing(300)]), batchOf([pairing(300)])]))).toEqual([expect.stringMatching(/^commands: .*holds 602/)]);
    });

    it("lets a stored change hold the thousands of pairs a first import makes, in one command or inside a batch", () => {
      expect(CommandSchema.safeParse(pairing(2_000)).success).toBe(true);
      expect(CommandSchema.safeParse(batchOf([leaf, pairing(2_000), leaf])).success).toBe(true);
      expect(refused(CommandSchema, batchOf([pairing(maxStoredBatchCommands + 1)]))).toEqual([expect.stringMatching(/^commands: .*at most/)]);
    });

    it("counts an empty pairTransfers as one command", () => {
      expect(CommandSchema.safeParse(batchOf(Array.from({ length: maxStoredBatchCommands }, () => pairing(0)))).success).toBe(true);
      expect(CommandSchema.safeParse(batchOf(Array.from({ length: maxStoredBatchCommands + 1 }, () => pairing(0)))).success).toBe(false);
    });
  });

  it("can hold a batch, which can hold commands, and no deeper", () => {
    expect(maxBatchDepth).toBe(2);
    expect(CommandSchema.safeParse(batchOf([batchOf([leaf])])).success).toBe(true);
    expect(refused(CommandSchema, batchOf([batchOf([batchOf([leaf])])]))).toEqual(["commands.0.commands.0.kind: A batch can hold other batches only 2 levels deep."]);
  });

  it("is refused at its depth however deep it goes, without reading the rest", () => {
    let deep: unknown = leaf;
    for (let level = 0; level < 20_000; level++) deep = batchOf([deep]);
    expect(CommandSchema.safeParse(deep).success).toBe(false);
    expect(FamilyCommandSchema.safeParse(deep).success).toBe(false);
  });

  it("is checked command by command", () => {
    expect(refused(CommandSchema, batchOf([leaf, { kind: "deleteRule", ruleId: "x" }]))).toEqual([expect.stringMatching(/^commands\.1\.ruleId: /)]);
    expect(refused(CommandSchema, { kind: "batch", commands: "one command" })).toEqual([expect.stringMatching(/^commands: /)]);
  });
});

describe("a command from the page", () => {
  it("cannot be importFile", () => {
    expect(refused(FamilyCommandSchema, importFile)).toEqual(["kind: The page can't send importFile. Only the app builds an import."]);
  });

  it("cannot be importFile inside a batch, at either level", () => {
    expect(refused(FamilyCommandSchema, batchOf([leaf, importFile]))).toEqual(["commands.1.kind: The page can't send importFile. Only the app builds an import."]);
    expect(refused(FamilyCommandSchema, batchOf([batchOf([importFile])]))).toEqual(["commands.0.commands.0.kind: The page can't send importFile. Only the app builds an import."]);
  });

  it("is limited in a batch the same way as the app's own", () => {
    expect(FamilyCommandSchema.safeParse(batchOf([batchOf([leaf])])).success).toBe(true);
    expect(FamilyCommandSchema.safeParse(batchOf([batchOf([batchOf([leaf])])])).success).toBe(false);
    expect(FamilyCommandSchema.safeParse(batchOf(leaves(501))).success).toBe(false);
  });

  it("is still an import when the app builds it, because the app's schema accepts it in a batch", () => {
    expect(CommandSchema.safeParse(batchOf([importFile])).success).toBe(true);
  });
});

describe("parsing", () => {
  it("never throws, whatever it is given", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything({ values: [fc.constantFrom("batch", "importFile", "openMonth", "setMoveStatus", "changeJob")] }), (a, b) => {
        for (const value of [a, b, { kind: "batch", commands: [a, b] }, { kind: "changeJob", jobId: a, changes: b }]) {
          expect(() => CommandSchema.safeParse(value)).not.toThrow();
          expect(() => FamilyCommandSchema.safeParse(value)).not.toThrow();
        }
      }),
    );
  });

  it("refuses a valid command once any key is added to it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(examples)), fc.constantFrom("extra", "__proto__", "constructor", "id", "kind2"), (command, key) => {
        if (command.kind === "importFile") return;
        const input = { ...JSON.parse(JSON.stringify(command)), [key]: 1 };
        const result = CommandSchema.safeParse(input);
        expect(result.success).toBe(false);
        expect(problems(result).join("\n")).toContain(key);
      }),
    );
  });
});
