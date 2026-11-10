import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Facts, checkFacts, computeFigures, localDate } from "@holt/core";
import { syntheticAccounts } from "@holt/importers/synthetic";
import { createMint } from "../../shared/ids.ts";
import type { Clock } from "../clock.ts";
import { openFactsStore } from "../facts/index.ts";
import { createImports } from "../imports/imports.ts";
import { openDatabase } from "../storage/database.ts";
import { type DataKey, newDataKey } from "../storage/keys.ts";
import { type SeedDeps, devPassphrase, seedDevData } from "./seed.ts";

let parent: string;
beforeEach(() => {
  parent = mkdtempSync(join(tmpdir(), "holt-seed-"));
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

const clockOn = (date: string): Clock => ({ today: () => localDate(date), now: () => new Date(`${date}T09:30:00.000Z`) });

/** The real key store needs Electron's keyring, so the tests stand in a marker file and remember the key. */
function setup(overrides: Partial<SeedDeps> = {}, date = "2026-11-10") {
  const clock = clockOn(date);
  const issued: { key: DataKey | null; passphrase: string | null; created: number } = { key: null, passphrase: null, created: 0 };
  const deps: SeedDeps = {
    clock,
    mint: createMint(),
    packaged: false,
    reseed: false,
    keys: {
      exists: (folder) => existsSync(join(folder, "keys.json")),
      create: async (folder, passphrase) => {
        writeFileSync(join(folder, "keys.json"), "{}");
        issued.key = newDataKey();
        issued.passphrase = passphrase;
        issued.created += 1;
        return { key: issued.key };
      },
    },
    ...overrides,
  };
  const folder = join(parent, "holt-dev");
  const load = (): Facts => {
    const db = openDatabase(join(folder, "holt.db"), issued.key!);
    try {
      return openFactsStore(db, { clock, mint: deps.mint })!.facts();
    } finally {
      db.close();
    }
  };
  return { deps, folder, issued, clock, load };
}

describe("where the seed will write", () => {
  it("refuses a folder not named holt-dev, and touches nothing", async () => {
    const { deps, issued } = setup();
    for (const name of ["holt", "holt-dev-copy", "Holt-Dev", "family"]) {
      const folder = join(parent, name);
      await expect(seedDevData(folder, deps)).rejects.toThrow(/holt-dev/);
      expect(existsSync(folder)).toBe(false);
    }
    expect(issued.created).toBe(0);
  });

  it("refuses to run in the packaged app", async () => {
    const { deps, folder, issued } = setup({ packaged: true });
    await expect(seedDevData(folder, deps)).rejects.toThrow(/packaged/);
    expect(existsSync(folder)).toBe(false);
    expect(issued.created).toBe(0);
  });

  it("refuses to clear a folder it would refuse to seed", async () => {
    const family = join(parent, "holt");
    mkdirSync(family);
    writeFileSync(join(family, "holt.db"), "the family's data");
    const { deps } = setup({ reseed: true });
    await expect(seedDevData(family, deps)).rejects.toThrow();
    expect(readFileSync(join(family, "holt.db"), "utf8")).toBe("the family's data");

    const packaged = setup({ reseed: true, packaged: true });
    mkdirSync(packaged.folder);
    writeFileSync(join(packaged.folder, "holt.db"), "kept");
    await expect(seedDevData(packaged.folder, packaged.deps)).rejects.toThrow();
    expect(readFileSync(join(packaged.folder, "holt.db"), "utf8")).toBe("kept");
  });
});

describe("the household it makes", () => {
  it("is a household in kroner with six accounts, forty jobs and a plan that starts three months before today", async () => {
    const { deps, folder, load } = setup();
    expect(await seedDevData(folder, deps)).toMatchObject({ seeded: true, imported: 3 });
    const facts = load();
    const household = [...facts.household.values()][0]!;
    expect(household).toMatchObject({ currency: "NOK", planStart: "2026-08" });
    expect(facts.jobs.size).toBe(40);
    expect(checkFacts(facts)).toEqual([]);
    const numbers = [...facts.accounts.values()].map((a) => a.number).sort();
    const { bulder, sparebank1 } = syntheticAccounts;
    expect(numbers).toEqual([bulder.everyday, bulder.bills, bulder.food, bulder.holiday, sparebank1.loanPayments, sparebank1.deposit].map((a) => a.number).sort());
  });

  it("has things waiting for the family and an account that is due, as the real import left them", async () => {
    const { deps, folder, load, clock } = setup();
    await seedDevData(folder, deps);
    const facts = load();
    const figures = computeFigures(facts, clock.today());
    expect(figures.needsYou.length).toBeGreaterThan(10);
    expect(figures.importStatus.due).toBeGreaterThan(0);
    expect([...facts.importBatches.values()].map((b) => b.fileName).sort()).toEqual(["bulder.csv", "sparebank1-deposit.csv", "sparebank1-loan-payments.csv"]);
    expect([...facts.transactions.values()].some((t) => t.ruleId !== undefined)).toBe(true);
    expect([...facts.budgetMonths.values()].map((m) => m.state)).toEqual(["closed", "closed", "open", "open"]);
  });

  it("still has them years from now, because the bank files follow the clock", async () => {
    const { deps, folder, load, clock } = setup({}, "2029-05-20");
    await seedDevData(folder, deps);
    const figures = computeFigures(load(), clock.today());
    expect(figures.needsYou.length).toBeGreaterThan(10);
    expect(figures.importStatus.due).toBeGreaterThan(0);
  });

  it("leaves one overlapping bank file for a developer to import by hand", async () => {
    const { deps, folder, load, issued, clock } = setup();
    await seedDevData(folder, deps);
    const samples = readdirSync(join(folder, "sample-imports")).sort();
    expect(samples).toEqual(["bulder-later.csv", "bulder.csv", "sparebank1-deposit.csv", "sparebank1-loan-payments.csv"]);

    const db = openDatabase(join(folder, "holt.db"), issued.key!);
    const store = openFactsStore(db, { clock, mint: deps.mint })!;
    const imports = createImports(store, { clock, mint: deps.mint, pickFile: async () => null, readFile: async () => ({ kind: "unreadable", reason: "missing" }) });
    const bytes = readFileSync(join(folder, "sample-imports", "bulder-later.csv"));
    const opened = imports.planBytes(bytes, "bulder-later.csv");
    db.close();
    expect(opened).toMatchObject({ kind: "opened", preview: { counts: { matched: expect.any(Number) } } });
    if (opened.kind !== "opened") return;
    expect(opened.preview.counts.matched).toBeGreaterThan(0);
    expect(opened.preview.counts.created).toBeGreaterThan(0);
    expect(load().importBatches.size).toBe(3);
  });

  it("protects the keys with the development passphrase", async () => {
    const { deps, folder, issued } = setup();
    await seedDevData(folder, deps);
    expect(issued.passphrase).toBe(devPassphrase);
  });
});

describe("starting again", () => {
  it("does nothing when the keys are already there", async () => {
    const { deps, folder, issued, load } = setup();
    await seedDevData(folder, deps);
    const before = JSON.stringify([...load().transactions.keys()]);
    expect(await seedDevData(folder, deps)).toEqual({ seeded: false });
    expect(issued.created).toBe(1);
    expect(JSON.stringify([...load().transactions.keys()])).toBe(before);
  });

  it("clears the folder and seeds again when asked", async () => {
    const first = setup();
    await seedDevData(first.folder, first.deps);
    writeFileSync(join(first.folder, "stale.txt"), "left over");
    const again = setup({ reseed: true });
    expect(await seedDevData(again.folder, again.deps)).toMatchObject({ seeded: true });
    expect(existsSync(join(again.folder, "stale.txt"))).toBe(false);
    expect(again.load().jobs.size).toBe(40);
  });

  it("leaves nothing behind when it fails, so the next launch tries again", async () => {
    const { deps, folder } = setup();
    const failing: SeedDeps = {
      ...deps,
      keys: {
        ...deps.keys,
        create: async (where, passphrase) => {
          await deps.keys.create(where, passphrase);
          throw new Error("the keyring went away");
        },
      },
    };
    await expect(seedDevData(folder, failing)).rejects.toThrow("keyring");
    expect(existsSync(folder)).toBe(false);
    expect(await seedDevData(folder, deps)).toMatchObject({ seeded: true });
  });
});
