import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { commit } from "../commands/apply.ts";
import { type ChangeLog, emptyChangeLog } from "../change-log.ts";
import { type Command } from "../commands/apply.ts";
import { type Facts, tableNames } from "../facts.ts";
import { changeId, proposalId } from "../ids.ts";
import { diffFacts, rowsEqual } from "../patch.ts";
import { arbitraryScript } from "../testing/arbitrary-commands.ts";
import { arbitraryFacts } from "../testing/arbitrary-facts.ts";
import { testId } from "../testing/facts-builder.ts";
import { ChangeAuthorSchema, PatchSchema, StoredChangeSchema } from "./patch.ts";
import { problems } from "./test-helpers.ts";

function roundTrips(schema: { safeParse(input: unknown): Parameters<typeof problems>[0] & { data?: unknown } }, value: unknown): void {
  const direct = schema.safeParse(value);
  expect(problems(direct)).toEqual([]);
  expect(rowsEqual(direct.data, value)).toBe(true);
  const viaJson = schema.safeParse(JSON.parse(JSON.stringify(value)));
  expect(problems(viaJson)).toEqual([]);
  expect(rowsEqual(viaJson.data, value)).toBe(true);
}

describe("a patch read from storage", () => {
  it("comes back equal to the patch between any two sets of facts, in every table, also after a trip through JSON", () => {
    fc.assert(
      fc.property(arbitraryFacts(), arbitraryFacts(), (before, after) => {
        const patch = diffFacts(before, after);
        roundTrips(PatchSchema, patch);
        roundTrips(PatchSchema, diffFacts(after, before));
      }),
    );
  });

  it("covers a change in every table but the household, whose single row the generator never varies", () => {
    const seen = new Set<string>();
    for (const [before, after] of fc.sample(fc.tuple(arbitraryFacts(), arbitraryFacts()), 200)) for (const change of diffFacts(before, after)) seen.add(change.table);
    expect([...seen].sort()).toEqual(tableNames.filter((table) => table !== "household").sort());
  });

  it("reads a change to the household", () => {
    const household = { id: id(9), name: "Home", currency: "NOK", planStart: "2026-01", evenOutStep: 5_000 };
    expect(PatchSchema.safeParse([{ table: "household", key: id(9), before: household, after: { ...household, name: "Our home", currency: "EUR" } }]).success).toBe(true);
  });
});

const id = (n: number) => testId(n);
const account = { id: id(1), name: "Everyday", kind: "everyday", scope: "shared", openingBalance: 0, openingDate: "2026-01-01" };
const insert = { table: "accounts", key: id(1), before: null, after: account };

function refused(schema: { safeParse(input: unknown): Parameters<typeof problems>[0] }, value: unknown): string[] {
  const result = schema.safeParse(value);
  expect(result.success).toBe(false);
  return problems(result);
}

describe("a change in a patch that does not belong is refused, and the problem names where it is", () => {
  it("is accepted when it inserts, updates or deletes a row", () => {
    const renamed = { ...account, name: "Joint" };
    expect(PatchSchema.safeParse([insert, { table: "accounts", key: id(1), before: account, after: renamed }, { table: "accounts", key: id(1), before: renamed, after: null }]).success).toBe(true);
  });

  it("when its key is not the key of its row", () => {
    expect(refused(PatchSchema, [{ ...insert, key: id(2) }])).toEqual([expect.stringMatching(/^0\.key: .*after row in accounts/)]);
    expect(refused(PatchSchema, [{ table: "accounts", key: id(1), before: { ...account, id: id(2) }, after: account }])).toEqual([expect.stringMatching(/^0\.key: .*before row in accounts/)]);
    expect(refused(PatchSchema, [{ table: "assignments", key: "2026-01/other", before: null, after: { month: "2026-01", jobId: id(2), amount: 1 } }])).toEqual([expect.stringMatching(/^0\.key: /)]);
  });

  it("when it has no row before and no row after", () => {
    expect(refused(PatchSchema, [{ table: "accounts", key: id(1), before: null, after: null }])).toEqual([expect.stringMatching(/^0: .*needs a row before or a row after/)]);
  });

  it("when its row is not a row of its table, with the row's own problem", () => {
    expect(refused(PatchSchema, [{ ...insert, after: { ...account, openingBalance: 1.5 } }])).toEqual([expect.stringMatching(/^0\.after\.openingBalance: /)]);
    expect(refused(PatchSchema, [{ ...insert, after: { ...account, kind: "wallet" } }])).toEqual([expect.stringMatching(/^0\.after\.kind: /)]);
    expect(refused(PatchSchema, [{ ...insert, table: "groups" }])).not.toEqual([]);
  });

  it("when its table does not exist, or it has a field it should not", () => {
    expect(refused(PatchSchema, [{ ...insert, table: "ledger" }])).toEqual([expect.stringMatching(/^0\.table: /)]);
    expect(refused(PatchSchema, [{ ...insert, note: "x" }])).toEqual([expect.stringMatching(/^0: .*"note"/)]);
    expect(refused(PatchSchema, [{ table: "accounts", key: id(1), after: account }])).toEqual([expect.stringMatching(/^0\.before: /)]);
  });

  it("when the patch is not a list", () => {
    expect(refused(PatchSchema, insert)).toEqual([expect.stringMatching(/^: /)]);
  });
});

describe("who made a change", () => {
  it("is the family or a proposal that has an ID", () => {
    roundTrips(ChangeAuthorSchema, { kind: "family" });
    roundTrips(ChangeAuthorSchema, { kind: "proposal", proposalId: proposalId(id(3)) });
  });

  it("is nobody else, and has nothing more", () => {
    expect(refused(ChangeAuthorSchema, { kind: "page" })).toEqual([expect.stringMatching(/^kind: /)]);
    expect(refused(ChangeAuthorSchema, { kind: "proposal", proposalId: "x" })).toEqual([expect.stringMatching(/^proposalId: /)]);
    expect(refused(ChangeAuthorSchema, { kind: "family", proposalId: id(3) })).toEqual([expect.stringMatching(/"proposalId"/)]);
  });
});

describe("a change record read back from storage", () => {
  it("comes back equal for every change a random script commits, also after a trip through JSON", () => {
    fc.assert(
      fc.property(arbitraryScript(), fc.boolean(), (script, byProposal) => {
        let facts: Facts = script.start;
        let log: ChangeLog<Command> = emptyChangeLog();
        let n = 0;
        for (const command of script.commands(() => facts)) {
          const by = byProposal ? ({ kind: "proposal", proposalId: proposalId(id(900 + n)) } as const) : ({ kind: "family" } as const);
          const result = commit(facts, log, command, { id: changeId(id(1_000 + n++)), at: "2026-11-09T10:00:00.000Z", by }, { asOf: script.asOf });
          if (!result.ok) continue;
          facts = result.facts;
          log = result.log;
          roundTrips(StoredChangeSchema, result.record);
        }
      }),
    );
  });

  it("is refused for a time that is not one, an author who does not exist, a command that does not exist, or a patch that is not a patch", () => {
    const record = { id: id(1), at: "2026-11-09T10:00:00Z", by: { kind: "family" }, command: { kind: "deleteRule", ruleId: id(2) }, patch: [] };
    expect(StoredChangeSchema.safeParse(record).success).toBe(true);
    expect(refused(StoredChangeSchema, { ...record, at: "9 November" })).toEqual([expect.stringMatching(/^at: /)]);
    expect(refused(StoredChangeSchema, { ...record, by: { kind: "robot" } })).toEqual([expect.stringMatching(/^by\.kind: /)]);
    expect(refused(StoredChangeSchema, { ...record, command: { kind: "dropEverything" } })).toEqual(['command.kind: Unknown command kind "dropEverything".']);
    expect(refused(StoredChangeSchema, { ...record, patch: [{ ...insert, key: id(2) }] })).toEqual([expect.stringMatching(/^patch\.0\.key: /)]);
    expect(refused(StoredChangeSchema, { ...record, status: "done" })).toEqual([expect.stringMatching(/"status"/)]);
    const { patch: _, ...withoutPatch } = record;
    expect(refused(StoredChangeSchema, withoutPatch)).toEqual([expect.stringMatching(/^patch: /)]);
  });
});
