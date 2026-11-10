import { type Command, type FamilyCommand, type GroupId, groupId, tablesOf } from "@holt/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Reply } from "./bridge.ts";
import { type Replica, createReplica, localDateOf, untilNextMidnight } from "./replica.ts";
import { arbitraryScript, closeWorlds, differences, factsBuilder, fc, kr, openWorld, testId, type World } from "./test-support.ts";
import type { RunResult } from "../../../shared/ledger-types.ts";

afterEach(closeWorlds);

function smallFacts() {
  const b = factsBuilder();
  const account = b.account({ name: "Everyday", openingBalance: kr(10_000) });
  const group = b.group({ name: "Home" });
  b.history({ date: "2025-11-03", amount: kr(-400), accountId: account });
  return { facts: b.facts(), account, group };
}

const addGroup = (n: number): FamilyCommand => ({ kind: "addGroup", group: { id: groupId(testId(900_000 + n)), name: `Extra ${n}`, order: 10 + n, countsTowardsSavingsRate: false } });
const renameGroup = (id: GroupId, name: string): FamilyCommand => ({ kind: "changeGroup", groupId: id, changes: { name } });

const asFamily = (command: Command): FamilyCommand => {
  if (command.kind === "importFile") throw new Error("The script made an import.");
  return command as FamilyCommand;
};

/** What the page does with a change: ask the main process, then hand the result to the replica. */
async function deliver(replica: Replica, answer: Promise<Reply<RunResult>>): Promise<RunResult> {
  const reply = await answer;
  if (!reply.ok) throw new Error(`The call failed: ${reply.failure.message}`);
  await replica.accept(reply.value);
  return reply.value;
}

/** Lets every promise that needs no timer finish. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function started(world: World, options: { readonly begin?: boolean } = {}) {
  const replica = createReplica(world.api, world.environment);
  if (options.begin !== false) await replica.ready();
  return replica;
}

function expectSame(replica: Replica, world: World): void {
  const view = replica.get();
  expect(view, "the replica has loaded").not.toBeNull();
  const snapshot = world.store.snapshot();
  expect(differences(view!.facts, world.store.facts()), "tables that differ").toEqual([]);
  expect(view!.revision).toBe(world.store.revision);
  expect(view!.head).toEqual(snapshot.head);
  expect(view!.today).toBe(snapshot.today);
}

describe("the replica follows the store", () => {
  it("equals the store's facts after every result of a random script, with undo and redo mixed in, and never needs a second snapshot", async () => {
    let applied = 0;
    let undone = 0;
    await fc.assert(
      fc.asyncProperty(arbitraryScript({ minSteps: 5, maxSteps: 25 }), fc.array(fc.constantFrom("none", "none", "none", "undo", "redo", "undo then redo"), { minLength: 25, maxLength: 25 }), async (script, mix) => {
        const world = openWorld(script.start, { day: script.asOf });
        try {
          const replica = await started(world);
          expectSame(replica, world);
          let n = 0;
          for (const command of script.commands(() => world.store.facts())) {
            const result = await deliver(replica, world.api.run(asFamily(command)));
            if (result.status === "applied") applied += 1;
            expectSame(replica, world);
            const steps = { none: [], undo: ["undo"], redo: ["redo"], "undo then redo": ["undo", "redo"] }[mix[n++ % mix.length]!] as ("undo" | "redo")[];
            for (const direction of steps) {
              const stepped = await deliver(replica, world.api.step(direction));
              if (stepped.status === "applied") undone += 1;
              expectSame(replica, world);
            }
          }
          expect(world.api.snapshots, "patches alone carried the replica").toBe(1);
        } finally {
          closeWorlds();
        }
      }),
      { numRuns: 25 },
    );
    expect(applied, "the scripts changed things").toBeGreaterThan(100);
    expect(undone, "the scripts undid and redid things").toBeGreaterThan(20);
  }, 120_000);

  it("moves back to the facts after each earlier change on undo, and forward again on redo", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const prefixes = [world.store.facts()];
    for (let n = 1; n <= 5; n += 1) {
      await deliver(replica, world.api.run(addGroup(n)));
      prefixes.push(world.store.facts());
    }
    for (let n = 5; n >= 1; n -= 1) {
      await deliver(replica, world.api.step("undo"));
      expect(differences(replica.get()!.facts, prefixes[n - 1]!), `after undoing change ${n}`).toEqual([]);
      expect(replica.get()!.head.redo?.kind).toBe("addGroup");
    }
    expect(replica.get()!.head.undo).toBeNull();
    for (let n = 1; n <= 5; n += 1) {
      await deliver(replica, world.api.step("redo"));
      expect(differences(replica.get()!.facts, prefixes[n]!), `after redoing change ${n}`).toEqual([]);
    }
    expect(replica.get()!.head.redo).toBeNull();
    expect(world.api.snapshots).toBe(1);
  });

  it("starts from the store's facts", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    expect(replica.status()).toEqual({ kind: "ready" });
    expectSame(replica, world);
  });
});

describe("a result the replica can't apply", () => {
  it("takes a new snapshot when a result skips a revision, and then equals the store", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    world.store.run(addGroup(1));
    const result = await deliver(replica, world.api.run(addGroup(2)));
    expect(result.status === "applied" && result.base, "the result starts past the replica").toBe(1);
    expect(world.api.snapshots).toBe(2);
    expectSame(replica, world);
    expect(replica.get()!.facts.groups.size).toBe(3);
  });

  it("takes a new snapshot when a patch no longer matches the rows, even at the right revision", async () => {
    const { facts, group } = smallFacts();
    const world = openWorld(facts);
    world.api.faults.tamper = (snapshot) => ({ ...snapshot, tables: { ...snapshot.tables, groups: snapshot.tables.groups.map((row) => (row.id === group ? { ...row, name: "Not the stored name" } : row)) } });
    const replica = await started(world);
    expect(differences(replica.get()!.facts, world.store.facts()), "the replica starts out wrong").toEqual(["groups"]);
    world.api.faults.tamper = null;

    const result = await deliver(replica, world.api.run(renameGroup(group, "Renamed")));
    expect(result.status === "applied" && result.base, "the revisions agree, so only the rows can tell").toBe(0);
    expect(world.api.snapshots).toBe(2);
    expectSame(replica, world);
    expect(replica.get()!.facts.groups.get(group)?.name).toBe("Renamed");
  });

  it("recovers on the next result after a reply was lost on the way", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    world.api.faults.loseNextReply = true;
    expect((await world.api.run(addGroup(1))).ok).toBe(false);
    expect(world.store.revision, "the store changed").toBe(1);
    expect(replica.get()!.revision, "the replica didn't hear").toBe(0);

    await deliver(replica, world.api.run(addGroup(2)));
    expectSame(replica, world);
    expect(replica.get()!.facts.groups.size).toBe(3);
  });

  it("stays as it was when the new snapshot can't be had, and catches up on the next try", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    world.store.run(addGroup(1));
    const before = replica.get();
    const reply = await world.api.run(addGroup(2));
    if (!reply.ok) throw new Error("unexpected");
    world.api.faults.failNext = { code: "handler-failed", message: "The app couldn't complete that." };
    await replica.accept(reply.value);
    expect(replica.get(), "the replica is untouched").toBe(before);
    expect(replica.reached(2)).toBe(false);

    expect(await replica.resync()).toBeNull();
    expect(replica.reached(2)).toBe(true);
    expectSame(replica, world);
  });

  it("keeps what it has when a snapshot older than its facts arrives late", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const older = world.store.snapshot();
    await deliver(replica, world.api.run(addGroup(1)));
    const view = replica.get();
    world.api.faults.tamper = () => structuredClone(older);
    expect(await replica.resync()).toBeNull();
    expect(replica.get()).toBe(view);
    expectSame(replica, world);
  });
});

describe("delivering a result twice", () => {
  it("changes nothing the second time: same view, no notice, no second snapshot", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const first = await deliver(replica, world.api.run(addGroup(1)));
    const second = await deliver(replica, world.api.run(addGroup(2)));
    const view = replica.get();
    let notices = 0;
    replica.subscribe(() => (notices += 1));

    await replica.accept(first);
    await replica.accept(second);
    expect(replica.get()).toBe(view);
    expect(notices).toBe(0);
    expect(world.api.snapshots).toBe(1);
    expectSame(replica, world);
  });

  it("ignores refused and conflicting results", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const view = replica.get();
    const refused = await deliver(replica, world.api.run({ kind: "addGroup", group: { id: groupId(testId(1)), name: " ", order: 1, countsTowardsSavingsRate: false } }));
    const conflict = await deliver(replica, world.api.step("redo"));
    expect([refused.status, conflict.status]).toEqual(["refused", "conflict"]);
    expect(replica.get()).toBe(view);
  });
});

describe("what a screen reads", () => {
  it("is the same object until something changes, and a new one each time something does", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const first = replica.get();
    expect(replica.get()).toBe(first);
    let notices = 0;
    const stop = replica.subscribe(() => (notices += 1));

    await deliver(replica, world.api.run(addGroup(1)));
    const second = replica.get();
    expect(second).not.toBe(first);
    expect(replica.get()).toBe(second);
    expect(notices).toBe(1);

    await deliver(replica, world.api.step("undo"));
    expect(replica.get()).not.toBe(second);
    expect(notices).toBe(2);

    stop();
    await deliver(replica, world.api.step("redo"));
    expect(notices, "an unsubscribed listener hears nothing").toBe(2);
  });

  it("does not touch the facts of an earlier view when a change arrives", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const before = replica.get()!;
    const rowsBefore = structuredClone(tablesOf(before.facts));
    await deliver(replica, world.api.run(addGroup(1)));
    expect(tablesOf(before.facts)).toEqual(rowsBefore);
    expect(replica.get()!.facts.groups.size).toBe(before.facts.groups.size + 1);
  });
});

describe("loading", () => {
  it("shows nothing and says it failed when the first snapshot doesn't arrive, then loads on a retry", async () => {
    const world = openWorld(smallFacts().facts);
    world.api.faults.failNext = { code: "unreachable", message: "The bridge is missing." };
    const replica = await started(world, { begin: false });
    expect(replica.status()).toEqual({ kind: "loading" });
    expect(await replica.ready()).toEqual({ kind: "failed", failure: { code: "unreachable", message: "The bridge is missing." } });
    expect(replica.get()).toBeNull();

    expect(await replica.resync()).toBeNull();
    expect(replica.status()).toEqual({ kind: "ready" });
    expectSame(replica, world);
  });

  it("asks once however many times it is told to begin", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = createReplica(world.api, world.environment);
    await Promise.all([replica.ready(), replica.ready()]);
    replica.start();
    await settled();
    expect(world.api.snapshots).toBe(1);
  });

  it("says there is no household when the store has none, and loads when one appears", async () => {
    const world = openWorld(smallFacts().facts);
    let answer: "empty" | "ready" = "empty";
    const real = world.api;
    const replica = createReplica({ snapshot: async () => (answer === "empty" ? { ok: true, value: { kind: "empty" } } : real.snapshot()) }, world.environment);
    expect(await replica.ready()).toEqual({ kind: "empty" });
    expect(replica.get()).toBeNull();
    answer = "ready";
    await replica.resync();
    expect(replica.status()).toEqual({ kind: "ready" });
    expect(replica.get()).not.toBeNull();
  });

  it("reports a snapshot it can't read as a failure instead of showing half of it", async () => {
    const world = openWorld(smallFacts().facts);
    world.api.faults.tamper = (snapshot) => ({ ...snapshot, tables: { ...snapshot.tables, groups: [...snapshot.tables.groups, ...snapshot.tables.groups] } });
    const replica = await started(world);
    expect(replica.status()).toMatchObject({ kind: "failed", failure: { code: "bad-reply" } });
    expect(replica.get()).toBeNull();
  });
});

describe("today", () => {
  const eve = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 5, day, hour, minute, second);

  it("works out the next midnight on the local clock", () => {
    expect(untilNextMidnight(eve(15, 23, 59))).toBe(60_000);
    expect(untilNextMidnight(eve(15, 12))).toBe(12 * 3_600_000);
    expect(localDateOf(eve(15, 23, 59, 59))).toBe("2026-06-15");
    expect(localDateOf(eve(16, 0))).toBe("2026-06-16");
  });

  it("moves today at midnight and changes nothing else when no fact changed", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const stop = replica.start();
    expect(world.environment.timerDelay, "wakes just after the next midnight").toBe(12 * 3_600_000 + 1_000);
    const before = replica.get()!;
    expect(before.today).toBe("2026-06-15");

    world.setStoreDay("2026-06-16");
    world.environment.setNow(eve(16, 0, 0, 2));
    world.environment.fireTimer();
    await settled();

    const after = replica.get()!;
    expect(after.today).toBe("2026-06-16");
    expect(after.facts, "the rows are the same rows").toBe(before.facts);
    expect(after.head).toBe(before.head);
    expect(after.revision).toBe(before.revision);
    expect(world.environment.timerDelay, "waits for the next midnight").toBe(24 * 3_600_000 - 2_000 + 1_000);
    stop();
  });

  it("asks again on focus only when the page's day has changed", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    replica.start();
    world.environment.focus();
    await settled();
    expect(world.api.snapshots, "same day, nothing to ask").toBe(1);

    world.setStoreDay("2026-06-16");
    world.environment.setNow(eve(16, 8));
    world.environment.focus();
    world.environment.focus();
    await settled();
    expect(replica.get()!.today).toBe("2026-06-16");
    expect(world.api.snapshots, "asked once for the new day").toBe(2);
  });

  it("keeps its day when asking fails, and asks again on the next focus", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    replica.start();
    world.setStoreDay("2026-06-16");
    world.environment.setNow(eve(16, 8));
    world.api.faults.failNext = { code: "unreachable", message: "No reply." };
    world.environment.focus();
    await settled();
    expect(replica.get()!.today).toBe("2026-06-15");

    world.environment.focus();
    await settled();
    expect(replica.get()!.today).toBe("2026-06-16");
  });

  it("stops watching when told to, and can start again", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    const stop = replica.start();
    expect(world.environment.focusListeners).toBe(1);
    expect(world.environment.timerDelay).not.toBeNull();
    stop();
    expect(world.environment.focusListeners).toBe(0);
    expect(world.environment.timerDelay).toBeNull();

    replica.start();
    expect(world.environment.focusListeners).toBe(1);
    expect(world.api.snapshots, "starting again doesn't load again").toBe(1);
  });

  it("takes today from a change made after midnight", async () => {
    const world = openWorld(smallFacts().facts);
    const replica = await started(world);
    world.setStoreDay("2026-06-16");
    await deliver(replica, world.api.run(addGroup(1)));
    expect(replica.get()!.today).toBe("2026-06-16");
    expectSame(replica, world);
  });
});
