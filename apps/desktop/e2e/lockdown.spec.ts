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
  expect(methods).toEqual(["appInfo", "databaseState"]);
});

test("a bridge call with bad arguments is refused with a code the page can read", async () => {
  const reply = await holt.page.evaluate(() =>
    (window as unknown as { holt: { appInfo: (...a: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }> } }).holt.appInfo("unexpected"),
  );
  expect(reply).toMatchObject({ ok: false, error: { code: "invalid-arguments" } });
});

test("a fresh data folder reports that Holt is not set up", async () => {
  const reply = await holt.page.evaluate(() => (window as unknown as { holt: { databaseState: () => Promise<unknown> } }).holt.databaseState());
  expect(reply).toEqual({ ok: true, value: { state: "not-set-up" } });
});
