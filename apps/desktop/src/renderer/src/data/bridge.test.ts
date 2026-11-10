import { describe, expect, it, vi } from "vitest";
import type { HoltBridge } from "../../../shared/bridge.ts";
import type { IpcResult } from "../../../shared/channels.ts";
import { windowApi } from "./bridge.ts";

function fakeBridge(overrides: Partial<Record<keyof HoltBridge, (...args: never[]) => Promise<IpcResult<unknown>>>> = {}): HoltBridge {
  const ok = async () => ({ ok: true as const, value: { kind: "empty" } });
  const base = { appInfo: ok, databaseState: ok, factsSnapshot: ok, run: ok, historyStep: ok, importOpen: ok, importPlan: ok, importCommit: ok };
  return { ...base, ...overrides } as unknown as HoltBridge;
}

describe("the page's api over the preload bridge", () => {
  it("hands back the value of a call that worked", async () => {
    const api = windowApi(() => fakeBridge());
    expect(await api.snapshot()).toEqual({ ok: true, value: { kind: "empty" } });
  });

  it("turns an error from the main process into a failure with its code", async () => {
    const api = windowApi(() =>
      fakeBridge({ run: async () => ({ ok: false, error: { code: "invalid-arguments", message: "The app can't read that." } }), historyStep: async () => ({ ok: false, error: { code: "handler-failed", message: "The app couldn't complete that." } }) }),
    );
    expect(await api.run({ kind: "closeMonth", month: "2026-01" as never })).toEqual({ ok: false, failure: { code: "invalid-arguments", message: "The app can't read that." } });
    expect(await api.step("undo")).toEqual({ ok: false, failure: { code: "handler-failed", message: "The app couldn't complete that." } });
  });

  it("turns a call that never comes back into an unreachable failure", async () => {
    const api = windowApi(() => fakeBridge({ factsSnapshot: async () => Promise.reject(new Error("The window closed.")) }));
    expect(await api.snapshot()).toEqual({ ok: false, failure: { code: "unreachable", message: "The window closed." } });
  });

  it("reports a missing bridge as unreachable instead of throwing", async () => {
    const api = windowApi(() => undefined);
    for (const call of [api.snapshot(), api.run({ kind: "closeMonth", month: "2026-01" as never }), api.step("redo"), api.importOpen(), api.importPlan("s", { balances: [], choices: [], suggest: true }), api.importCommit("s", { balances: [], choices: [], suggest: true })]) {
      expect(await call).toMatchObject({ ok: false, failure: { code: "unreachable" } });
    }
  });

  it("sends an import entry as exactly its three fields, however it was built", async () => {
    const importPlan = vi.fn(async () => ({ ok: true as const, value: { kind: "expired" } }));
    const api = windowApi(() => fakeBridge({ importPlan }));
    const entry = { balances: [], choices: [], suggest: false, stray: "not for the main process" };
    await api.importPlan("session", entry);
    expect(importPlan).toHaveBeenCalledWith("session", { balances: [], choices: [], suggest: false });
  });
});
