import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devPassphrase } from "./seed.ts";

const desktop = join(import.meta.dirname, "../../..");
const builder = join(desktop, "node_modules/.bin/electron-vite");

const outputs: string[] = [];
afterAll(() => {
  for (const dir of outputs) rmSync(dir, { recursive: true, force: true });
});

/** Builds the app in a mode into its own folder and returns the text of the main process and preload bundles. */
function bundleOf(mode: "production" | "development" | "e2e"): string {
  const out = mkdtempSync(join(tmpdir(), `holt-bundle-${mode}-`));
  outputs.push(out);
  execFileSync(builder, ["build", "--mode", mode, "--outDir", out, "--logLevel", "error"], { cwd: desktop, stdio: "pipe" });
  const files = ["main", "preload"].flatMap((part) =>
    readdirSync(join(out, part), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  expect(files.length).toBeGreaterThan(1);
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

/** What exists only to run the app on invented data. */
const seedMarkers = ["holt-dev-seed", devPassphrase, "HOLT_RESEED", "sample-imports", "Nærbutikken Fjord", "97101110001", "Barnesparing", "Konfirmasjon", "Christmas and gifts"];
const pickerMarker = "HOLT_E2E_PICK_FILE";

describe("what the shipped app holds", () => {
  it("has no development seed, no development passphrase and no test file picker in a production build", { timeout: 120_000 }, () => {
    const bundle = bundleOf("production");
    for (const marker of [...seedMarkers, pickerMarker]) expect(bundle, marker).not.toContain(marker);
  });

  it("has the seed but not the test file picker in a development build, so the check above can see what it looks for", { timeout: 120_000 }, () => {
    const bundle = bundleOf("development");
    for (const marker of seedMarkers) expect(bundle, marker).toContain(marker);
    expect(bundle).not.toContain(pickerMarker);
  });

  it("has both in the end-to-end build", { timeout: 120_000 }, () => {
    const bundle = bundleOf("e2e");
    for (const marker of [...seedMarkers, pickerMarker]) expect(bundle, marker).toContain(marker);
  });
});
