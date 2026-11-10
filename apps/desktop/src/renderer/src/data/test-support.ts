/**
 * What the data layer's tests share: a real encrypted store in a temporary folder, an api over it that answers
 * as the bridge does (replies are structured-cloned, as IPC does), and a clock and window focus the test moves.
 * `main/facts/test-support.ts` is private to the facts folder (`pnpm lint:facts`), so the few lines this needs
 * from the storage layer are repeated here.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Command, type Facts, type TableName, localDate, rowsEqual, tableNames, tablesOf } from "@holt/core";
import { type FactsStore, type StoreDeps, createFactsStore } from "../../../main/facts/index.ts";
import { type Db, openDatabase } from "../../../main/storage/database.ts";
import { newDataKey } from "../../../main/storage/keys.ts";
import { migrate } from "../../../main/storage/migrations.ts";
import { createMint } from "../../../shared/ids.ts";
import type { Snapshot } from "../../../shared/ledger-types.ts";
import type { Failure, LedgerApi, Reply } from "./bridge.ts";
import type { ReplicaEnvironment } from "./replica.ts";

export { default as fc } from "fast-check";
export { arbitraryScript } from "../../../../../../packages/core/src/testing/arbitrary-commands.ts";
export { factsBuilder, kr, setAmount, testId } from "../../../../../../packages/core/src/testing/facts-builder.ts";

/** The tables whose rows differ, empty when the facts are the same. Compares rows by value, so a Map's order doesn't count. */
export function differences(a: Facts, b: Facts): TableName[] {
  const left = tablesOf(a);
  const right = tablesOf(b);
  return tableNames.filter((name) => !rowsEqual(left[name], right[name]));
}

export interface FakeEnvironment extends ReplicaEnvironment {
  setNow(moment: Date): void;
  /** How long the waiting timer was set for, or null when none waits. */
  readonly timerDelay: number | null;
  fireTimer(): void;
  focus(): void;
  readonly focusListeners: number;
}

export function fakeEnvironment(start: Date): FakeEnvironment {
  let moment = start;
  let timer: { readonly callback: () => void; readonly delayMs: number } | null = null;
  const listeners = new Set<() => void>();
  return {
    now: () => moment,
    setTimer(callback, delayMs) {
      const mine = { callback, delayMs };
      timer = mine;
      return () => {
        if (timer === mine) timer = null;
      };
    },
    onFocus(callback) {
      listeners.add(callback);
      return () => void listeners.delete(callback);
    },
    setNow: (next) => void (moment = next),
    get timerDelay() {
      return timer?.delayMs ?? null;
    },
    fireTimer() {
      const waiting = timer;
      timer = null;
      waiting?.callback();
    },
    focus: () => listeners.forEach((listener) => listener()),
    get focusListeners() {
      return listeners.size;
    },
  };
}

export interface Faults {
  /** The next call fails before it reaches the store. */
  failNext: Failure | null;
  /** Every snapshot fails until this is cleared. */
  failSnapshots: Failure | null;
  /** How long a snapshot takes to come back. */
  snapshotDelayMs: number;
  /** The next run or step reaches the store and changes it, but the reply is lost. */
  loseNextReply: boolean;
  /** Rewrites every snapshot on its way out. */
  tamper: ((snapshot: Snapshot) => Snapshot) | null;
  /** How long run, step and commit wait before the store sees them, by call number. */
  delayMs: (call: number) => number;
  /** What `importCommit` makes the store do. */
  commitCommand: Command | null;
}

export interface StoreApi extends LedgerApi {
  readonly faults: Faults;
  /** Snapshots asked for. */
  readonly snapshots: number;
  /** A label for each run, step and commit, in the order the call began. */
  readonly started: readonly string[];
  /** Most run, step and commit calls in flight at once. */
  readonly peak: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function storeApi(store: FactsStore): StoreApi {
  const counts = { snapshots: 0, calls: 0, inFlight: 0, peak: 0 };
  const started: string[] = [];
  const faults: Faults = { failNext: null, failSnapshots: null, snapshotDelayMs: 0, loseNextReply: false, tamper: null, delayMs: () => 0, commitCommand: null };

  function fail<T>(): Reply<T> | null {
    if (faults.failNext === null) return null;
    const failure = faults.failNext;
    faults.failNext = null;
    return { ok: false, failure };
  }

  async function change<T>(label: string, work: () => T): Promise<Reply<T>> {
    const call = counts.calls++;
    started.push(label);
    counts.inFlight += 1;
    counts.peak = Math.max(counts.peak, counts.inFlight);
    try {
      const wait = faults.delayMs(call);
      await (wait > 0 ? sleep(wait) : Promise.resolve());
      const failed = fail<T>();
      if (failed !== null) return failed;
      const value = work();
      if (faults.loseNextReply) {
        faults.loseNextReply = false;
        return { ok: false, failure: { code: "unreachable", message: "The reply was lost." } };
      }
      return { ok: true, value: structuredClone(value) };
    } finally {
      counts.inFlight -= 1;
    }
  }

  return {
    faults,
    get snapshots() {
      return counts.snapshots;
    },
    started,
    get peak() {
      return counts.peak;
    },

    async snapshot() {
      counts.snapshots += 1;
      await (faults.snapshotDelayMs > 0 ? sleep(faults.snapshotDelayMs) : Promise.resolve());
      if (faults.failSnapshots !== null) return { ok: false, failure: faults.failSnapshots };
      const failed = fail<never>();
      if (failed !== null) return failed;
      const snapshot = structuredClone(store.snapshot());
      return { ok: true, value: { kind: "ready", snapshot: faults.tamper === null ? snapshot : faults.tamper(snapshot) } };
    },
    run: (command) => change(`run ${command.kind}`, () => store.run(command)),
    step: (direction) => change(direction, () => store.step(direction)),
    importOpen: async () => ({ ok: true, value: { kind: "cancelled" } }),
    importPlan: async () => ({ ok: true, value: { kind: "expired" } }),
    importCommit: (session) =>
      change(`commit ${session}`, () => {
        if (faults.commitCommand === null) throw new Error("The test gave the commit nothing to do.");
        return store.run(faults.commitCommand);
      }),
  };
}

export interface World {
  readonly store: FactsStore;
  readonly api: StoreApi;
  readonly environment: FakeEnvironment;
  /** Moves the day the store works from. */
  setStoreDay(day: string): void;
}

const folders: string[] = [];
const databases: Db[] = [];

const noonOn = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date, 12);
};

/** A store over `facts` in a fresh encrypted database. Call `closeWorlds` after each test. */
export function openWorld(facts: Facts, options: { readonly day?: string } = {}): World {
  const folder = mkdtempSync(join(tmpdir(), "holt-data-"));
  folders.push(folder);
  const db = openDatabase(join(folder, "facts-test.sqlite"), newDataKey());
  databases.push(db);
  migrate(db);
  let day = options.day ?? "2026-06-15";
  let tick = 0;
  const deps: StoreDeps = { clock: { today: () => localDate(day), now: () => new Date(Date.parse("2026-06-15T09:00:00Z") + tick++ * 1000) }, mint: createMint() };
  const store = createFactsStore(db, facts, deps);
  return { store, api: storeApi(store), environment: fakeEnvironment(noonOn(day)), setStoreDay: (next) => void (day = next) };
}

export function closeWorlds(): void {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
}
