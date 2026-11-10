import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnstorableChangeError } from "./facts/index.ts";
import { type HandlerDeps, createHandlers } from "./ipc-handlers.ts";
import { registerHandlers } from "./ipc-dispatch.ts";
import { type Rig, createRig } from "./imports/test-rig.ts";

let rig: Rig;
beforeEach(() => {
  rig = createRig();
});
afterEach(() => rig.dispose());

function page(overrides: Partial<HandlerDeps> = {}) {
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const deps: HandlerDeps = {
    appInfo: () => ({ version: "0.0.0", storageBackend: "test" }),
    databaseState: () => ({ state: "ready" }),
    store: () => rig.store,
    imports: () => rig.imports,
    ...overrides,
  };
  registerHandlers({ handle: (channel, listener) => void registered.set(channel, listener) }, createHandlers(deps));
  return (channel: string, ...args: unknown[]) => Promise.resolve(registered.get(channel)?.({}, ...args)) as Promise<{ ok: boolean; value?: any; error?: { code: string; message: string } }>;
}

const firstTransaction = () => [...rig.facts().transactions.values()][0]!;
const entry = { balances: [], choices: [], suggest: true };

async function openBulder(call: ReturnType<typeof page>) {
  rig.choose("/downloads/bulder.csv", { kind: "bytes", bytes: rig.bytes("bulder.csv") });
  const opened = await call("holt:import-open");
  expect(opened.value.kind).toBe("opened");
  return opened.value.session as string;
}

describe("the facts snapshot", () => {
  it("is empty until a household exists", async () => {
    const call = page({ store: () => null });
    expect(await call("holt:facts-snapshot")).toEqual({ ok: true, value: { kind: "empty" } });
  });

  it("carries every table and the revision once there is one", async () => {
    const call = page();
    const reply = await call("holt:facts-snapshot");
    expect(reply.value).toMatchObject({ kind: "ready", snapshot: { revision: 0, today: "2026-11-10", head: { undo: null, redo: null } } });
    expect(reply.value.snapshot.tables.accounts).toHaveLength(6);
    expect(reply.value.snapshot.tables.jobs).toHaveLength(40);
  });
});

describe("running a command from the page", () => {
  it("applies it as the family's change, and undo and redo step through it", async () => {
    const call = page();
    const session = await openBulder(call);
    expect((await call("holt:import-commit", session, entry)).value.status).toBe("applied");

    const target = firstTransaction();
    const ran = await call("holt:run", { kind: "setNote", transactionId: target.id, note: "Checked" });
    expect(ran.value).toMatchObject({ status: "applied", change: { kind: "setNote", by: { kind: "family" } } });
    expect(rig.facts().transactions.get(target.id)?.note).toBe("Checked");

    expect((await call("holt:history-step", "undo")).value.status).toBe("applied");
    expect(rig.facts().transactions.get(target.id)?.note).toBeUndefined();
    expect((await call("holt:history-step", "redo")).value.status).toBe("applied");
    expect(rig.facts().transactions.get(target.id)?.note).toBe("Checked");
  });

  it("hands back a refusal as data and changes nothing", async () => {
    const call = page();
    const before = rig.dump();
    const reply = await call("holt:run", { kind: "setNote", transactionId: "00000000-0000-7000-8000-000000000999", note: "x" });
    expect(reply).toMatchObject({ ok: true, value: { status: "refused", refusal: { code: "transactionNotFound" } } });
    expect(rig.dump()).toBe(before);
  });

  it("says there is nothing to undo as a conflict, not an error", async () => {
    const call = page();
    expect((await call("holt:history-step", "undo")).value.status).toBe("conflict");
  });
});

describe("what only the main process may do", () => {
  const importFile = { kind: "importFile", batch: {}, rows: [], transactions: [] };

  it("refuses an importFile command from the page, alone or inside a batch, and stores nothing", async () => {
    const call = page();
    const before = rig.dump();
    for (const command of [importFile, { kind: "batch", commands: [importFile] }]) {
      expect(await call("holt:run", command)).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
    }
    expect(rig.dump()).toBe(before);
  });

  it("refuses rows, paths or bytes sent along with an import", async () => {
    const call = page();
    const session = await openBulder(call);
    for (const extra of [{ rows: [] }, { path: "/etc/passwd" }, { bytes: [1, 2, 3] }]) {
      expect(await call("holt:import-commit", session, { ...entry, ...extra })).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
    }
    expect(rig.facts().importBatches.size).toBe(0);
    expect((await call("holt:import-commit", session, entry)).value.status).toBe("applied");
  });

  it("refuses a choice that is not a whole line number or a typed balance that is not whole minor units", async () => {
    const call = page();
    const session = await openBulder(call);
    const choice = { line: 1.5, treatment: { kind: "needsYou" } };
    expect(await call("holt:import-plan", session, { ...entry, choices: [choice] })).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
    const balance = { accountId: rig.account("Everyday"), value: 10.5, asOf: "2026-11-10" };
    expect(await call("holt:import-plan", session, { ...entry, balances: [balance] })).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
  });
});

describe("importing through the bridge", () => {
  it("opens, plans again with the family's balance, adds once and then expires", async () => {
    const call = page();
    const session = await openBulder(call);
    const planned = await call("holt:import-plan", session, { ...entry, suggest: false });
    expect(planned.value).toMatchObject({ kind: "planned", preview: { counts: { suggested: 0 } } });

    const added = await call("holt:import-commit", session, entry);
    expect(added.value).toMatchObject({ status: "applied", change: { kind: "batch" } });
    expect(await call("holt:import-commit", session, entry)).toEqual({ ok: true, value: { status: "expired" } });
    expect(await call("holt:import-plan", session, entry)).toEqual({ ok: true, value: { kind: "expired" } });
  });

  it("sends the page a name and a preview, and nothing from the file's path", async () => {
    const call = page();
    rig.choose("/home/someone/Downloads/bulder.csv", { kind: "bytes", bytes: rig.bytes("bulder.csv") });
    const opened = await call("holt:import-open");
    expect(JSON.stringify(opened)).not.toContain("someone");
    expect(opened.value.fileName).toBe("bulder.csv");
  });
});

describe("when the app can't do what the page asked", () => {
  it("answers handler-failed with no detail when there is no household", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const call = page({ store: () => null, imports: () => null });
    const calls: [string, ...unknown[]][] = [
      ["holt:run", { kind: "setNote", transactionId: "00000000-0000-7000-8000-000000000001", note: "x" }],
      ["holt:history-step", "undo"],
      ["holt:import-open"],
      ["holt:import-plan", "s", entry],
      ["holt:import-commit", "s", entry],
    ];
    for (const [channel, ...args] of calls) {
      const reply = await call(channel, ...args);
      expect(reply).toEqual({ ok: false, error: { code: "handler-failed", message: "The app couldn't complete that." } });
    }
    log.mockRestore();
  });

  it("answers handler-failed, without the reason, when the store can't write a change", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = { ...rig.store, run: () => { throw new UnstorableChangeError(new Error("secret detail in /home/someone")); } };
    const call = page({ store: () => store as unknown as ReturnType<HandlerDeps["store"]> });
    const reply = await call("holt:run", { kind: "setNote", transactionId: "00000000-0000-7000-8000-000000000001", note: "x" });
    expect(reply).toEqual({ ok: false, error: { code: "handler-failed", message: "The app couldn't complete that." } });
    expect(JSON.stringify(reply)).not.toContain("secret");
    log.mockRestore();
  });
});
