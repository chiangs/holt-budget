/**
 * The page's copy of the family's facts. The main process owns them and writes them (decision 0047, part 2);
 * this copy is read-only. It starts from a snapshot and moves forward only by the patch each applied change
 * carries, and only when that patch starts from the revision the copy holds. A gap in revisions and a patch
 * that no longer matches the rows both end the same way: take a new snapshot. Delivering the same result
 * twice does nothing.
 */

import { type Facts, type LocalDate, PatchConflict, applyPatch, factsOf, localDate } from "@holt/core";
import type { LogHead, RunResult, Snapshot } from "../../../shared/ledger-types.ts";
import type { Failure, LedgerApi } from "./bridge.ts";

/** What a screen reads. A new object whenever something in it changes, and the same object until then. */
export interface FactsView {
  readonly revision: number;
  /** The main process's day, so a preview here agrees with the change the main process would make. */
  readonly today: LocalDate;
  readonly facts: Facts;
  readonly head: LogHead;
}

export type ReplicaStatus =
  | { readonly kind: "loading" }
  /** No household exists yet. */
  | { readonly kind: "empty" }
  | { readonly kind: "ready" }
  /** The first snapshot didn't arrive. There is nothing to show until a later one does. */
  | { readonly kind: "failed"; readonly failure: Failure };

/** The page's clock and focus, passed in so a test controls them. */
export interface ReplicaEnvironment {
  now(): Date;
  /** Calls back once after `delayMs`. Returns the way to cancel it. */
  setTimer(callback: () => void, delayMs: number): () => void;
  /** Calls back whenever the window gains focus. Returns the way to stop. */
  onFocus(callback: () => void): () => void;
}

export interface Replica {
  /** Resolves once the first snapshot has arrived or failed. Starts it if nothing has. */
  ready(): Promise<ReplicaStatus>;
  get(): FactsView | null;
  status(): ReplicaStatus;
  subscribe(listener: () => void): () => void;
  /**
   * Moves the copy to the result's revision. Resolves once the copy is there, or once a new snapshot has
   * been tried. A refused or conflicting result, and one the copy already has, change nothing.
   */
  accept(result: RunResult): Promise<void>;
  /** Whether the copy is at this revision or past it. */
  reached(revision: number): boolean;
  /** Takes a new snapshot and replaces the copy. Resolves to why it couldn't, or null. */
  resync(): Promise<Failure | null>;
  /** Begins the first snapshot if nothing has, and refreshes `today` at midnight and on focus. Returns the way to stop. */
  start(): () => void;
}

const loadingStatus: ReplicaStatus = { kind: "loading" };
const emptyStatus: ReplicaStatus = { kind: "empty" };
const readyStatus: ReplicaStatus = { kind: "ready" };

/** A moment after midnight, so the timer never wakes before the day has changed. */
const midnightMargin = 1_000;

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

export function localDateOf(moment: Date): LocalDate {
  return localDate(`${pad(moment.getFullYear(), 4)}-${pad(moment.getMonth() + 1, 2)}-${pad(moment.getDate(), 2)}`);
}

export function untilNextMidnight(moment: Date): number {
  return new Date(moment.getFullYear(), moment.getMonth(), moment.getDate() + 1).getTime() - moment.getTime();
}

const noop = (): void => undefined;

export function createReplica(api: Pick<LedgerApi, "snapshot">, environment: ReplicaEnvironment): Replica {
  let view: FactsView | null = null;
  let status: ReplicaStatus = loadingStatus;
  /** The page's day when `today` last came from the main process. A new day on the page's clock is the cue to ask again. */
  let seenDay = localDateOf(environment.now());
  const listeners = new Set<() => void>();

  function publish(nextView: FactsView | null, nextStatus: ReplicaStatus): void {
    if (nextView === view && nextStatus === status) return;
    view = nextView;
    status = nextStatus;
    for (const listener of [...listeners]) listener();
  }

  /** `replace` takes the snapshot's rows even when the copy is already at that revision. */
  function adopt(snapshot: Snapshot, replace: boolean): void {
    const current = view;
    if (current !== null && snapshot.revision < current.revision) return;
    if (current !== null && snapshot.revision === current.revision && !replace) {
      if (snapshot.today !== current.today) publish({ ...current, today: snapshot.today }, readyStatus);
      return;
    }
    publish({ revision: snapshot.revision, today: snapshot.today, facts: factsOf(snapshot.tables), head: snapshot.head }, readyStatus);
  }

  async function takeSnapshot(replace: boolean): Promise<Failure | null> {
    const asked = localDateOf(environment.now());
    const answer = await api.snapshot();
    let failure: Failure | null = null;
    if (!answer.ok) failure = answer.failure;
    else {
      try {
        if (answer.value.kind === "empty") publish(null, emptyStatus);
        else adopt(answer.value.snapshot, replace);
        seenDay = asked;
      } catch (error) {
        failure = { code: "bad-reply", message: error instanceof Error ? error.message : "The facts could not be read." };
      }
    }
    if (failure !== null && view === null) publish(null, { kind: "failed", failure });
    return failure;
  }

  let chain: Promise<unknown> = Promise.resolve();
  /** One snapshot at a time, so a late reply can't overtake a newer one. */
  function load(replace: boolean): Promise<Failure | null> {
    const result = chain.then(() => takeSnapshot(replace));
    chain = result.then(noop, noop);
    return result;
  }

  let refreshing: Promise<Failure | null> | null = null;
  /** A focus and the midnight timer can arrive together, and one snapshot answers both. */
  function refreshToday(): Promise<Failure | null> {
    if (refreshing !== null) return refreshing;
    if (view === null && status.kind === "loading") return Promise.resolve(null);
    if (view !== null && localDateOf(environment.now()) === seenDay) return Promise.resolve(null);
    const refresh = load(view === null).finally(() => void (refreshing = null));
    refreshing = refresh;
    return refresh;
  }

  let first: Promise<ReplicaStatus> | null = null;
  const ready = (): Promise<ReplicaStatus> => (first ??= load(true).then(() => status));

  let cancelTimer: (() => void) | null = null;
  function arm(): void {
    cancelTimer?.();
    cancelTimer = environment.setTimer(() => void refreshToday().then(arm, arm), untilNextMidnight(environment.now()) + midnightMargin);
  }

  return {
    ready,
    get: () => view,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    accept(result) {
      if (result.status !== "applied") return Promise.resolve();
      const current = view;
      if (current !== null && result.revision <= current.revision) return Promise.resolve();
      if (current !== null && result.base === current.revision) {
        try {
          publish({ revision: result.revision, today: result.today, facts: applyPatch(current.facts, result.patch), head: result.head }, readyStatus);
          seenDay = localDateOf(environment.now());
          return Promise.resolve();
        } catch (error) {
          if (!(error instanceof PatchConflict)) return Promise.reject(error);
        }
      }
      return load(true).then(noop);
    },

    reached: (revision) => view !== null && view.revision >= revision,
    resync: () => load(true),

    start() {
      void ready();
      const stopWatchingFocus = environment.onFocus(() => void refreshToday());
      arm();
      return () => {
        stopWatchingFocus();
        cancelTimer?.();
        cancelTimer = null;
      };
    },
  };
}
