import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { HoltBridge } from "../src/shared/bridge.ts";
import { type HoltApp, launchHolt } from "./launch.ts";

type Reply<M extends keyof HoltBridge> = Awaited<ReturnType<HoltBridge[M]>>;

let holt: HoltApp;
let launchedIn = 0;

test.describe.serial("the app on the synthetic household", () => {
  test.beforeAll(async () => {
    const started = Date.now();
    holt = await launchHolt({ seed: true, pickFile: (folder) => join(folder, "sample-imports", "bulder-later.csv") });
    launchedIn = Date.now() - started;
  });
  test.afterAll(async () => {
    await holt.close();
  });

  const snapshot = () => holt.page.evaluate(() => (window as unknown as { holt: HoltBridge }).holt.factsSnapshot());

  test("opens a ready household with transactions and things waiting for the family", async () => {
    const database = await holt.page.evaluate(() => (window as unknown as { holt: HoltBridge }).holt.databaseState());
    expect(database).toEqual({ ok: true, value: { state: "ready" } });

    const reply = (await snapshot()) as Reply<"factsSnapshot">;
    if (!reply.ok || reply.value.kind !== "ready") throw new Error(`Expected a ready snapshot, got ${JSON.stringify(reply).slice(0, 200)}`);
    const { tables } = reply.value.snapshot;
    expect(tables.transactions.length).toBeGreaterThan(50);
    expect(tables.transactions.filter((t) => t.treatment.kind === "needsYou").length).toBeGreaterThan(10);
    expect(tables.accounts.filter((a) => a.scope === "shared")).toHaveLength(6);
    expect(tables.accounts.filter((a) => a.scope === "paidInto")).toHaveLength(4);
    console.log(`seeded launch to ready snapshot: ${launchedIn} ms`);
  });

  test("refuses an importFile command from the page", async () => {
    const before = (await snapshot()) as Reply<"factsSnapshot">;
    const reply = await holt.page.evaluate(() =>
      (window as unknown as { holt: HoltBridge }).holt.run({ kind: "importFile", batch: {}, rows: [], transactions: [] } as never),
    );
    expect(reply).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
    const after = (await snapshot()) as Reply<"factsSnapshot">;
    expect(after).toEqual(before);
  });

  test("picks a file, checks it, adds it, and takes it back", async () => {
    const bridge = () => holt.page.evaluate(async () => {
      const api = (window as unknown as { holt: HoltBridge }).holt;
      const opened = await api.importOpen();
      if (!opened.ok || opened.value.kind !== "opened") return { opened } as const;
      const entry = { balances: [], choices: [], suggest: true };
      const added = await api.importCommit(opened.value.session, entry);
      const again = await api.importCommit(opened.value.session, entry);
      const undone = await api.historyStep("undo");
      return { opened, added, again, undone } as const;
    });
    const before = (await snapshot()) as Reply<"factsSnapshot">;
    const done = await bridge();
    if (!("added" in done)) throw new Error(`The file did not open: ${JSON.stringify(done).slice(0, 300)}`);

    if (!done.opened.ok || done.opened.value.kind !== "opened") throw new Error("unreachable");
    expect(done.opened.value.fileName).toBe("bulder-later.csv");
    expect(done.opened.value.preview.counts.matched).toBeGreaterThan(0);
    expect(done.opened.value.preview.counts.created).toBeGreaterThan(0);
    expect(JSON.stringify(done.opened)).not.toContain(holt.dataFolder);
    expect(done.added).toMatchObject({ ok: true, value: { status: "applied" } });
    expect(done.again).toEqual({ ok: true, value: { status: "expired" } });
    expect(done.undone).toMatchObject({ ok: true, value: { status: "applied" } });

    const after = (await snapshot()) as Reply<"factsSnapshot">;
    if (!before.ok || before.value.kind !== "ready" || !after.ok || after.value.kind !== "ready") throw new Error("Expected ready snapshots");
    expect(after.value.snapshot.tables.transactions).toHaveLength(before.value.snapshot.tables.transactions.length);
    expect(after.value.snapshot.tables.importBatches.filter((b) => !b.undone)).toHaveLength(3);
  });
});
