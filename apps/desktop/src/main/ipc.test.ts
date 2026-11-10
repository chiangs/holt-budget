import { describe, expect, it, vi } from "vitest";
import { channelMethods, channelNames } from "../shared/channel-names.ts";
import { createBridge } from "../shared/bridge.ts";
import { channels } from "../shared/channels.ts";
import { type Handlers, createDispatcher, registerHandlers } from "./ipc-dispatch.ts";

function handlers(): { [K in keyof Handlers]: ReturnType<typeof vi.fn> } {
  return {
    "holt:app-info": vi.fn(() => ({ version: "1.0.0", storageBackend: "test" })),
    "holt:database-state": vi.fn(() => ({ state: "ready" as const })),
    "holt:facts-snapshot": vi.fn(() => ({ kind: "empty" as const })),
    "holt:run": vi.fn(),
    "holt:history-step": vi.fn(),
    "holt:import-open": vi.fn(() => ({ kind: "cancelled" as const })),
    "holt:import-plan": vi.fn(() => ({ kind: "expired" as const })),
    "holt:import-commit": vi.fn(() => ({ status: "expired" as const })),
  };
}

function fakeIpcMain() {
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    registered,
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void registered.set(channel, listener),
    invoke: async (channel: string, ...args: unknown[]) => {
      const listener = registered.get(channel);
      if (listener === undefined) throw new Error(`No handler registered for '${channel}'`);
      return listener({}, ...args);
    },
  };
}

describe("B1: arguments are checked in the main process", () => {
  it("rejects bad arguments and does not run the handler body", async () => {
    const h = handlers();
    const ipc = fakeIpcMain();
    registerHandlers(ipc, h as unknown as Handlers);
    const result = await ipc.invoke("holt:app-info", "unexpected");
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
    expect(h["holt:app-info"]).not.toHaveBeenCalled();
  });

  it("runs the handler with parsed arguments when they are valid", async () => {
    const h = handlers();
    const ipc = fakeIpcMain();
    registerHandlers(ipc, h as unknown as Handlers);
    expect(await ipc.invoke("holt:app-info")).toEqual({ ok: true, value: { version: "1.0.0", storageBackend: "test" } });
    expect(h["holt:app-info"]).toHaveBeenCalledOnce();
  });

  it("reports a throwing handler without leaking its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = { ...handlers(), "holt:app-info": () => { throw new Error("secret path /home/x"); } };
    const result = await createDispatcher(h as unknown as Handlers)("holt:app-info", []);
    expect(result).toMatchObject({ ok: false, error: { code: "handler-failed" } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("B2: unregistered channels are rejected", () => {
  it("the dispatcher refuses a channel that is not in the shared table", async () => {
    const h = handlers();
    const result = await createDispatcher(h as unknown as Handlers)("holt:delete-everything", []);
    expect(result).toMatchObject({ ok: false, error: { code: "unknown-channel" } });
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });

  it("registers exactly the shared channels, so any other name has no handler", async () => {
    const ipc = fakeIpcMain();
    registerHandlers(ipc, handlers() as unknown as Handlers);
    expect([...ipc.registered.keys()].sort()).toEqual([...channelNames].sort());
    await expect(ipc.invoke("holt:other")).rejects.toThrow();
  });
});

describe("B3: the preload exposes exactly the shared channels", () => {
  it("builds one method per channel, calling that channel", async () => {
    const calls: string[] = [];
    const bridge = createBridge(async (channel) => {
      calls.push(channel);
      return { ok: true, value: null };
    });
    expect(Object.keys(bridge).sort()).toEqual(Object.values(channelMethods).sort());
    for (const method of Object.keys(bridge)) await (bridge as unknown as Record<string, () => Promise<unknown>>)[method]?.();
    expect(calls.sort()).toEqual([...channelNames].sort());
  });

  it("hands the page a refusal as data, with the code it can branch on", async () => {
    const bridge = createBridge(async () => ({ ok: false, error: { code: "invalid-arguments", message: "bad" } }));
    await expect(bridge.appInfo()).resolves.toEqual({ ok: false, error: { code: "invalid-arguments", message: "bad" } });
  });

  it("has a schema for every channel and none extra", () => {
    expect(Object.keys(channels).sort()).toEqual([...channelNames].sort());
  });
});

describe("the page cannot send what only the main process may", () => {
  const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  const note = { kind: "setNote", transactionId: id(1), note: "Present" };

  async function call(channel: string, ...args: unknown[]) {
    const h = handlers();
    const ipc = fakeIpcMain();
    registerHandlers(ipc, h as unknown as Handlers);
    return { result: await ipc.invoke(channel, ...args), h };
  }

  it("runs a command from the family", async () => {
    const { result, h } = await call("holt:run", note);
    expect(result).toMatchObject({ ok: true });
    expect(h["holt:run"]).toHaveBeenCalledWith(note);
  });

  it("refuses an importFile command, alone or inside a batch, and never runs the handler", async () => {
    const importFile = { kind: "importFile", batch: {}, rows: [], transactions: [] };
    for (const command of [importFile, { kind: "batch", commands: [note, importFile] }]) {
      const { result, h } = await call("holt:run", command);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
      expect(h["holt:run"]).not.toHaveBeenCalled();
    }
  });

  it("refuses a batch over 500 commands, an unknown kind and an unknown key", async () => {
    const tooMany = { kind: "batch", commands: Array.from({ length: 501 }, () => note) };
    for (const command of [tooMany, { kind: "deleteEverything" }, { ...note, extra: true }]) {
      const { result, h } = await call("holt:run", command);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
      expect(h["holt:run"]).not.toHaveBeenCalled();
    }
  });

  it("accepts only undo and redo as a history step", async () => {
    expect((await call("holt:history-step", "undo")).result).toMatchObject({ ok: true });
    const bad = await call("holt:history-step", "rewind");
    expect(bad.result).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
    expect(bad.h["holt:history-step"]).not.toHaveBeenCalled();
  });

  it("checks what the family typed into an import before the main process sees it", async () => {
    const entry = { balances: [{ accountId: id(2), value: 2_496_000, asOf: "2026-11-06" }], choices: [], suggest: true };
    expect((await call("holt:import-plan", "session-1", entry)).result).toMatchObject({ ok: true });
    const bad = [
      { ...entry, balances: [{ accountId: "not-an-id", value: 1, asOf: "2026-11-06" }] },
      { ...entry, balances: [{ accountId: id(2), value: 1.5, asOf: "2026-11-06" }] },
      { ...entry, balances: [{ accountId: id(2), value: 1, asOf: "6 November" }] },
      { ...entry, choices: [{ line: 0, treatment: { kind: "needsYou" } }] },
      { ...entry, suggest: "yes" },
    ];
    for (const e of bad) {
      const { result, h } = await call("holt:import-commit", "session-1", e);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
      expect(h["holt:import-commit"]).not.toHaveBeenCalled();
    }
  });
});
