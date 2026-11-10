import { expect, test } from "@playwright/test";
import { launchHolt, type HoltApp } from "./launch.ts";

let holt: HoltApp;
test.beforeAll(async () => {
  holt = await launchHolt();
});
test.afterAll(async () => {
  await holt.close();
});

test("N6: the page cannot reach an outside host or loopback", async () => {
  const outcome = await holt.page.evaluate(async () => {
    const attempt = (url: string) =>
      fetch(url, { signal: AbortSignal.timeout(3000) }).then(
        () => "reached",
        () => "refused",
      );
    return { outside: await attempt("https://example.com/"), loopback: await attempt("http://127.0.0.1:1/") };
  });
  expect(outcome).toEqual({ outside: "refused", loopback: "refused" });
});

test("the bridge exposes only the registered calls", async () => {
  const methods = await holt.page.evaluate(() => Object.keys((window as unknown as { holt: object }).holt).sort());
  expect(methods).toEqual(["appInfo", "databaseState", "factsSnapshot", "historyStep", "importCommit", "importOpen", "importPlan", "run"]);
});

test("a bridge call with bad arguments is refused with a code the page can read", async () => {
  const reply = await holt.page.evaluate(() =>
    (window as unknown as { holt: { appInfo: (...a: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }> } }).holt.appInfo("unexpected"),
  );
  expect(reply).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
});

test("the page cannot send an import through the bridge, alone or inside a batch", async () => {
  const replies = await holt.page.evaluate(async () => {
    const run = (window as unknown as { holt: { run: (command: unknown) => Promise<{ ok: boolean; error?: { code: string } }> } }).holt.run;
    const importFile = { kind: "importFile", batch: {}, rows: [], transactions: [] };
    return [await run(importFile), await run({ kind: "batch", commands: [importFile] })];
  });
  for (const reply of replies) expect(reply).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
});

test("the page's language is British English, so date fields are written day first", async () => {
  // Chromium draws a date field in the page's language: "09/11/2026" for en-GB, "11/09/2026" for en-US.
  expect(await holt.page.evaluate(() => navigator.language)).toBe("en-GB");
});

test("a fresh data folder reports that Holt is not set up", async () => {
  const reply = await holt.page.evaluate(() => (window as unknown as { holt: { databaseState: () => Promise<unknown> } }).holt.databaseState());
  expect(reply).toEqual({ ok: true, value: { state: "not-set-up" } });
});
