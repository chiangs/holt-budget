import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ChangeLog, emptyChangeLog, undo } from "../change-log.ts";
import type { Facts } from "../facts.ts";
import { computeFigures } from "../figures/index.ts";
import { arbitraryScript } from "../testing/arbitrary-commands.ts";
import { changeMeta } from "../testing/command-household.ts";
import { type Command, apply, commit } from "./apply.ts";
import { checkFacts } from "./check-facts.ts";

type Script = ReturnType<typeof arbitraryScript> extends fc.Arbitrary<infer S> ? S : never;

/** Plays a script, and calls `then` for each accepted command of `kind` with the facts before and after it. Returns how many there were. */
function forEachAccepted<K extends Command["kind"]>(script: Script, kind: K, then: (before: Facts, command: Extract<Command, { kind: K }>, after: Facts) => void): number {
  let facts = script.start;
  let count = 0;
  for (const command of script.commands(() => facts)) {
    const result = apply(facts, command, { asOf: script.asOf });
    if (!result.ok) continue;
    if (command.kind === kind) {
      count += 1;
      then(facts, command as Extract<Command, { kind: K }>, result.facts);
    }
    facts = result.facts;
  }
  return count;
}

describe("random scripts reach the new commands", () => {
  it("accept a good share of people, agreements and moves between buckets, so the properties below see them", () => {
    const seen = { addPerson: 0, changePerson: 0, deletePerson: 0, addAgreement: 0, changeAgreement: 0, moveBucket: 0 };
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        for (const kind of Object.keys(seen) as (keyof typeof seen)[]) seen[kind] += forEachAccepted(script, kind, () => {});
      }),
      { numRuns: 200 },
    );
    for (const [kind, count] of Object.entries(seen)) expect(count, kind).toBeGreaterThan(5);
  });
});

describe("a move between buckets in a random script", () => {
  it("changes no month's money available or unassigned, in a month the family has opened, and no account's balance", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        forEachAccepted(script, "moveBucket", (before, _command, after) => {
          const was = computeFigures(before, script.asOf);
          const now = computeFigures(after, script.asOf);
          for (const [m, figures] of was.months) {
            if (figures.state === "planned") continue;
            const { available, unassigned, assigned, carriedIn } = figures;
            expect(now.months.get(m)).toMatchObject({ available, unassigned, assigned, carriedIn });
          }
          for (const [id, account] of was.accounts) expect(now.accounts.get(id)?.balance).toEqual(account.balance);
        });
      }),
    );
  });

  it("never leaves the job it takes money from with less than nothing, because the app refuses to take more than it holds", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        forEachAccepted(script, "moveBucket", (before, { transfer }, after) => {
          const monthsAhead = { horizonMonths: 12 };
          const held = computeFigures(before, script.asOf, monthsAhead).jobs.get(transfer.from)?.months.get(transfer.month)?.money;
          const left = computeFigures(after, script.asOf, monthsAhead).jobs.get(transfer.from)?.months.get(transfer.month)?.money;
          expect(held?.kind).toBe("bucket");
          expect(left).toMatchObject({ kind: "bucket", end: (held?.kind === "bucket" ? held.end : Number.NaN) - transfer.amount });
        });
      }),
    );
  });

  it("keeps the facts sound, and undoing it restores the facts exactly", () => {
    fc.assert(
      fc.property(arbitraryScript(), (script) => {
        let facts = script.start;
        let log: ChangeLog<Command> = emptyChangeLog();
        let n = 0;
        for (const command of script.commands(() => facts)) {
          const result = commit(facts, log, command, changeMeta(++n), { asOf: script.asOf });
          if (!result.ok) continue;
          expect(checkFacts(result.facts)).toEqual([]);
          if (command.kind === "moveBucket") {
            const undone = undo(result.facts, result.log);
            if (!undone.ok) throw new Error("undo refused");
            expect(undone.facts).toEqual(facts);
          }
          facts = result.facts;
          log = result.log;
        }
      }),
    );
  });
});
