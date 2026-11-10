import { type Command, type FamilyCommand, FamilyCommandSchema, computeFigures, groupId, rowsEqual, tablesOf } from "@holt/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mintId } from "../../../shared/ids.ts";
import type { LedgerApi } from "./bridge.ts";
import { type ComputeFigures, type LedgerClient, createLedgerClient } from "./client.ts";
import { arbitraryScript, closeWorlds, differences, factsBuilder, fc, kr, openWorld, setAmount, testId, type World } from "./test-support.ts";

afterEach(closeWorlds);

function smallFacts() {
  const b = factsBuilder();
  const account = b.account({ name: "Everyday", openingBalance: kr(10_000) });
  const group = b.group({ name: "Home" });
  const job = b.spendJob({ name: "Food", plan: setAmount(kr(500)) });
  b.history({ date: "2025-11-03", amount: kr(-400), accountId: account });
  return { facts: b.facts(), account, group, job };
}

const addGroup = (n: number): FamilyCommand => ({ kind: "addGroup", group: { id: groupId(testId(900_000 + n)), name: `Extra ${n}`, order: 10 + n, countsTowardsSavingsRate: false } });
const nameless: FamilyCommand = { kind: "addGroup", group: { id: groupId(testId(1)), name: " ", order: 1, countsTowardsSavingsRate: false } };

const asFamily = (command: Command): FamilyCommand => {
  if (command.kind === "importFile") throw new Error("The script made an import.");
  return command as FamilyCommand;
};

async function started(world: World, compute?: ComputeFigures): Promise<LedgerClient> {
  const client = createLedgerClient(world.api, world.environment, compute);
  await client.replica.ready();
  return client;
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function expectSame(client: LedgerClient, world: World): void {
  expect(differences(client.replica.get()!.facts, world.store.facts())).toEqual([]);
  expect(client.replica.get()!.revision).toBe(world.store.revision);
}

describe("changes go through one queue", () => {
  it("sends ten changes fired together one at a time, in the order made, and settles them in that order", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    world.api.faults.delayMs = (call) => (10 - call) * 3;
    const settledOrder: number[] = [];
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        client.run(addGroup(n)).then((outcome) => {
          settledOrder.push(n);
          return outcome;
        }),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status === "applied" && outcome.revision), "the store made them in the order they were fired").toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(settledOrder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(world.api.peak, "never two in flight").toBe(1);
    expectSame(client, world);
  });

  it("keeps runs, steps and import commits in one line", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    world.api.faults.delayMs = (call) => (4 - call) * 5;
    world.api.faults.commitCommand = addGroup(2);
    const [first, commit, undo, last] = await Promise.all([client.run(addGroup(1)), client.importer.commit("session", { balances: [], choices: [], suggest: true }), client.step("undo"), client.run(addGroup(3))]);
    expect([first, commit, undo, last].map((outcome) => outcome.status === "applied" && outcome.revision)).toEqual([1, 2, 3, 4]);
    expect(world.api.peak).toBe(1);
    expect([...client.replica.get()!.facts.groups.keys()]).toContain(groupId(testId(900_001)));
    expect([...client.replica.get()!.facts.groups.keys()]).not.toContain(groupId(testId(900_002)));
    expectSame(client, world);
  });

  it("keeps the line moving after a change fails", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    world.api.faults.failNext = { code: "handler-failed", message: "The app couldn't complete that." };
    const [failed, next] = await Promise.all([client.run(addGroup(1)), client.run(addGroup(2))]);
    expect(failed).toEqual({ status: "failed", failure: { code: "handler-failed", message: "The app couldn't complete that." } });
    expect(next.status).toBe("applied");
    expectSame(client, world);
  });
});

describe("what a change resolves to", () => {
  it("resolves only once the page's copy has caught up, even when it had to take a new snapshot", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    world.store.run(addGroup(1));
    world.api.faults.snapshotDelayMs = 20;
    const outcome = await client.run(addGroup(2));
    expect(outcome.status).toBe("applied");
    expect(client.replica.reached(outcome.status === "applied" ? outcome.revision : Infinity)).toBe(true);
    expectSame(client, world);
    expect(client.replica.get()!.facts.groups.size).toBe(3);
  });

  it("is applied with the change and the heads", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    const outcome = await client.run(addGroup(1));
    expect(outcome).toMatchObject({ status: "applied", base: 0, revision: 1, change: { kind: "addGroup", by: { kind: "family" } }, head: { redo: null } });
    expect(client.replica.get()!.head.undo?.kind).toBe("addGroup");
  });

  it("is refused with core's refusal, and nothing changes", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    const view = client.replica.get();
    const outcome = await client.run(nameless);
    expect(outcome).toMatchObject({ status: "refused", refusal: { code: "nameMissing" } });
    expect(client.replica.get()).toBe(view);
    expect(world.store.revision).toBe(0);
    expect(world.api.snapshots).toBe(1);
  });

  it("is a conflict when there is nothing to undo or redo, and nothing changes", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    const view = client.replica.get();
    expect(await client.step("undo")).toMatchObject({ status: "conflict", conflict: { kind: "nothingToUndo" } });
    expect(await client.step("redo")).toMatchObject({ status: "conflict", conflict: { kind: "nothingToRedo" } });
    expect(client.replica.get()).toBe(view);
  });

  it("is failed with the code when the call doesn't work, and the copy stays as it was", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    const view = client.replica.get();
    world.api.faults.failNext = { code: "invalid-arguments", message: "The app can't read that." };
    expect(await client.run(addGroup(1))).toEqual({ status: "failed", failure: { code: "invalid-arguments", message: "The app can't read that." } });
    world.api.faults.failNext = { code: "unreachable", message: "No reply." };
    expect(await client.step("undo")).toMatchObject({ status: "failed", failure: { code: "unreachable" } });
    expect(client.replica.get()).toBe(view);
    expect(world.store.revision).toBe(0);
  });

  it("is failed when the reply is lost, though the store changed, and the next change puts the page right", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    world.api.faults.loseNextReply = true;
    expect(await client.run(addGroup(1))).toMatchObject({ status: "failed", failure: { code: "unreachable" } });
    expect(world.store.revision).toBe(1);
    expect(client.replica.get()!.revision).toBe(0);

    expect((await client.run(addGroup(2))).status).toBe("applied");
    expectSame(client, world);
  });

  it("says the change was saved when it can't catch up with it", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    world.store.run(addGroup(1));
    world.api.faults.failSnapshots = { code: "unreachable", message: "No reply." };
    const outcome = await client.run(addGroup(2));
    expect(outcome).toMatchObject({ status: "failed", failure: { code: "out-of-sync" } });
    expect(world.store.revision, "the change was made").toBe(2);
    expect(client.replica.get()!.revision, "the page is behind").toBe(0);

    world.api.faults.failSnapshots = null;
    expect(await client.replica.resync()).toBeNull();
    expectSame(client, world);
  });

  it("passes through an import that was blocked or expired, and changes nothing", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    const view = client.replica.get();
    const api: LedgerApi = { ...world.api, importCommit: async () => ({ ok: true, value: { status: "expired" } }) };
    const importing = createLedgerClient(api, world.environment);
    await importing.replica.ready();
    expect(await importing.importer.commit("gone", { balances: [], choices: [], suggest: true })).toEqual({ status: "expired" });
    expect(client.replica.get()).toBe(view);
  });
});

describe("importing", () => {
  it("passes the opening and the plan through, and names a failed call", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    expect(await client.importer.open()).toEqual({ kind: "cancelled" });
    expect(await client.importer.plan("session", { balances: [], choices: [], suggest: true })).toEqual({ kind: "expired" });
    const failure = { code: "handler-failed", message: "The app couldn't complete that." } as const;
    const failing = createLedgerClient({ ...world.api, importOpen: async () => ({ ok: false, failure }), importPlan: async () => ({ ok: false, failure }) }, world.environment);
    expect(await failing.importer.open()).toEqual({ kind: "failed", failure });
    expect(await failing.importer.plan("session", { balances: [], choices: [], suggest: true })).toEqual({ kind: "failed", failure });
  });
});

describe("preview", () => {
  it("shows what a change would do without changing anything or asking the main process", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    const view = client.replica.get()!;
    const rows = structuredClone(tablesOf(view.facts));
    const startedBefore = world.api.started.length;

    const dry = client.preview(addGroup(1));
    expect(dry).toMatchObject({ ok: true });
    expect(dry?.ok && dry.facts.groups.size).toBe(view.facts.groups.size + 1);
    expect(client.replica.get(), "the same view").toBe(view);
    expect(tablesOf(view.facts), "the same rows").toEqual(rows);
    expect(world.store.revision).toBe(0);
    expect(world.api.started.length, "no call to the main process").toBe(startedBefore);

    const outcome = await client.run(addGroup(1));
    expect(outcome.status === "applied" && dry?.ok && rowsEqual(outcome.patch, dry.patch), "the real change is the one previewed").toBe(true);
  });

  it("gives core's refusal for a change it would refuse", async () => {
    const world = openWorld(smallFacts().facts);
    const client = await started(world);
    expect(client.preview(nameless)).toMatchObject({ ok: false, refusal: { code: "nameMissing" } });
  });

  it("is null while nothing is loaded", async () => {
    const world = openWorld(smallFacts().facts);
    const client = createLedgerClient(world.api, world.environment);
    expect(client.preview(addGroup(1))).toBeNull();
  });

  it("agrees with the main process on every command of a random script, as of the main process's day", async () => {
    let compared = 0;
    let refusedBoth = 0;
    await fc.assert(
      fc.asyncProperty(arbitraryScript({ minSteps: 5, maxSteps: 25 }), async (script) => {
        const world = openWorld(script.start, { day: script.asOf });
        try {
          const client = await started(world);
          for (const command of script.commands(() => world.store.facts())) {
            const view = client.replica.get();
            const dry = client.preview(asFamily(command));
            expect(client.replica.get(), "a preview leaves the view alone").toBe(view);
            const outcome = await client.run(asFamily(command));
            compared += 1;
            if (dry?.ok) expect(outcome.status === "applied" && rowsEqual(outcome.patch, dry.patch), `${command.kind} patch`).toBe(true);
            else {
              refusedBoth += 1;
              expect(outcome.status === "refused" && outcome.refusal.code, `${command.kind} refusal`).toBe(dry && !dry.ok ? dry.refusal.code : undefined);
            }
            expectSame(client, world);
          }
        } finally {
          closeWorlds();
        }
      }),
      { numRuns: 20 },
    );
    expect(compared).toBeGreaterThan(100);
    expect(refusedBoth, "some commands were refused").toBeGreaterThan(0);
  }, 120_000);
});

describe("figures", () => {
  it("are null until the facts are here, then computed once for each state of them", async () => {
    const world = openWorld(smallFacts().facts);
    const compute = vi.fn<ComputeFigures>(computeFigures);
    const client = createLedgerClient(world.api, world.environment, compute);
    expect(client.figures()).toBeNull();
    expect(compute).not.toHaveBeenCalled();
    await client.replica.ready();

    const first = client.figures();
    for (let n = 0; n < 10; n += 1) expect(client.figures()).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(first).toEqual(computeFigures(world.store.facts(), world.store.snapshot().today));

    await client.run(addGroup(1));
    const second = client.figures();
    expect(second).not.toBe(first);
    expect(client.figures()).toBe(second);
    expect(compute).toHaveBeenCalledTimes(2);

    await client.run(nameless);
    await client.step("redo");
    expect(client.figures(), "a refused change and a conflict leave the figures alone").toBe(second);
    expect(compute).toHaveBeenCalledTimes(2);

    await client.step("undo");
    expect(client.figures()).not.toBe(second);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("are worked out again when the day changes though no fact did", async () => {
    const world = openWorld(smallFacts().facts);
    const compute = vi.fn<ComputeFigures>(computeFigures);
    const client = await started(world, compute);
    const stop = client.start();
    const before = client.figures()!;
    expect(before.asOf).toBe("2026-06-15");

    world.setStoreDay("2026-07-02");
    world.environment.setNow(new Date(2026, 6, 2, 8));
    world.environment.focus();
    await settled();

    const after = client.figures()!;
    expect(after.asOf).toBe("2026-07-02");
    expect(after.current).toBe("2026-07");
    expect(compute).toHaveBeenCalledTimes(2);
    expect(after).toEqual(computeFigures(world.store.facts(), world.store.snapshot().today));
    stop();
  });

  it("follow the facts through undo and redo", async () => {
    const { facts, job } = smallFacts();
    const world = openWorld(facts);
    const client = await started(world);
    const month = facts.household.values().next().value!.planStart;
    const initial = client.figures()!.months.get(month)!.jobs.get(job)!;

    await client.run({ kind: "openMonth", month });
    expect(client.figures()).toEqual(computeFigures(world.store.facts(), world.store.snapshot().today));
    await client.step("undo");
    expect(client.figures()!.months.get(month)!.jobs.get(job)).toEqual(initial);
    await client.step("redo");
    expect(client.figures()).toEqual(computeFigures(world.store.facts(), world.store.snapshot().today));
  });
});

describe("ids", () => {
  it("lets the page make a rule's ID, and the main process takes the command", async () => {
    const { facts, job } = smallFacts();
    const world = openWorld(facts);
    const client = await started(world);
    const id = mintId("rule");
    const command: FamilyCommand = { kind: "addRule", rule: { id, match: { counterparty: "Corner shop" }, result: { kind: "job", jobId: job }, origin: "set", priority: 1 } };
    expect(FamilyCommandSchema.safeParse(command).success).toBe(true);
    expect(await client.run(command)).toMatchObject({ status: "applied", change: { kind: "addRule" } });
    expect(client.replica.get()!.facts.rules.get(id)?.match.counterparty).toBe("Corner shop");
    expectSame(client, world);
  });

  it("makes IDs that sort in the order they were made", () => {
    const ids = Array.from({ length: 200 }, () => mintId("rule"));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(200);
  });
});
