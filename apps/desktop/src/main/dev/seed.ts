/**
 * The development seed (decision 0047, Part 2). Setup is Milestone 6, so until then a developer, `pnpm dev` and
 * the Playwright smoke tests get a synthetic household here. It exists only in builds that define
 * `__HOLT_DEV_SEED__` (every mode except production), and it refuses any folder not named `holt-dev`, so it
 * can't touch the family's data. A test searches the production bundle for the sentinel in the log line below.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { IdMint } from "../../shared/ids.ts";
import type { Clock } from "../clock.ts";
import { createFactsStore } from "../facts/index.ts";
import { createImports } from "../imports/imports.ts";
import { openDatabase } from "../storage/database.ts";
import type { DataKey } from "../storage/keys.ts";
import { migrate } from "../storage/migrations.ts";
import { seedHousehold, syntheticBankFiles } from "./household.ts";

/** Not a secret: it protects an invented household. The unlock path uses it when the seed switch is present. */
export const devPassphrase = "holt-dev-seed passphrase, not a secret";

/** The overlapping file the seed leaves for a developer to import by hand. */
const leftToImport = "bulder-later.csv";

export interface SeedDeps {
  readonly clock: Clock;
  readonly mint: IdMint;
  /** `app.isPackaged`. */
  readonly packaged: boolean;
  /** `HOLT_RESEED=1`: start again from nothing. */
  readonly reseed: boolean;
  readonly keys: {
    exists(folder: string): boolean;
    create(folder: string, passphrase: string): Promise<{ readonly key: DataKey }>;
  };
}

export type SeedResult = { readonly seeded: true; readonly imported: number } | { readonly seeded: false };

function assertSafe(folder: string, deps: SeedDeps): void {
  if (basename(folder) !== "holt-dev") throw new Error(`The development seed only writes to a folder named holt-dev, not ${folder}.`);
  if (!isAbsolute(folder)) throw new Error("The development seed needs an absolute folder.");
  if (deps.packaged) throw new Error("The development seed never runs in the packaged app.");
}

/**
 * Creates the keys, the database, the household and its history in `folder`, unless the keys are already there.
 * A failure leaves nothing behind, so the next launch tries again.
 */
export async function seedDevData(folder: string, deps: SeedDeps): Promise<SeedResult> {
  assertSafe(folder, deps);
  if (deps.reseed) rmSync(folder, { recursive: true, force: true });
  if (deps.keys.exists(folder)) return { seeded: false };

  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const { key } = await deps.keys.create(folder, devPassphrase);
    const db = openDatabase(join(folder, "holt.db"), key);
    try {
      migrate(db);
      const today = deps.clock.today();
      const store = createFactsStore(db, seedHousehold(today), { clock: deps.clock, mint: deps.mint });
      const imports = createImports(store, {
        clock: deps.clock,
        mint: deps.mint,
        pickFile: async () => null,
        readFile: async () => {
          throw new Error("The seed gives the import its bytes, not a path.");
        },
      });
      const files = syntheticBankFiles(today);
      let imported = 0;
      for (const file of files) {
        if (file.name === leftToImport) continue;
        const opened = imports.planBytes(new TextEncoder().encode(file.text), file.name);
        if (opened.kind === "blocked" && opened.block.kind === "noRows") continue;
        if (opened.kind !== "opened") throw new Error(`The seed could not plan ${file.name}: ${opened.kind}.`);
        const result = imports.commit(opened.session, { balances: [], choices: [], suggest: true });
        if (result.status !== "applied") throw new Error(`The seed could not import ${file.name}: ${result.status}.`);
        imported += 1;
      }
      const samples = join(folder, "sample-imports");
      mkdirSync(samples, { recursive: true });
      for (const file of files) writeFileSync(join(samples, file.name), file.text);
      console.log(`[holt] holt-dev-seed: made the synthetic household in ${folder} and imported ${imported} files.`);
      return { seeded: true, imported };
    } finally {
      db.close();
    }
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}
