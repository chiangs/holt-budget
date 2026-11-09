import { describe, expect, it, vi } from "vitest";
import { channelMethods, channelNames } from "../shared/channel-names.ts";
import { createBridge } from "../shared/bridge.ts";
import { channels } from "../shared/channels.ts";
import { type Handlers, createDispatcher, registerHandlers } from "./ipc-dispatch.ts";

function handlers(): { [K in keyof Handlers]: ReturnType<typeof vi.fn> } {
  return {
    "holt:app-info": vi.fn(() => ({ version: "1.0.0", storageBackend: "test" })),
    "holt:database-state": vi.fn(() => ({ state: "ready" as const })),
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
    for (const method of Object.keys(bridge)) await (bridge as Record<string, () => Promise<unknown>>)[method]?.();
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
