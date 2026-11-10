/**
 * What the screens do with the facts, without React so it can be tested without a browser. A change goes to
 * the main process through one queue, one call in flight at a time and in the order made, and its promise
 * settles only once the page's copy has moved. Figures are worked out here from that copy, once for each
 * state of it. Core's `Figures` holds Maps, so they never cross the bridge.
 */

import { type ApplyResult, type FamilyCommand, type Facts, type Figures, type LocalDate, apply, computeFigures } from "@holt/core";
import type { ImportCommitted, ImportEntry, ImportOpened, ImportPlanned, SessionId } from "../../../shared/import-types.ts";
import type { RunResult, StepDirection } from "../../../shared/ledger-types.ts";
import type { Failure, LedgerApi, Reply } from "./bridge.ts";
import { type Replica, type ReplicaEnvironment, createReplica } from "./replica.ts";

/** The call didn't work. Nothing is known to have changed, except under `out-of-sync`, where the change was saved. */
export interface Failed {
  readonly status: "failed";
  readonly failure: Failure;
}

/** Applied, refused (with core's refusal), conflict (an undo or redo that found the rows changed), or failed. */
export type LedgerOutcome = RunResult | Failed;

export interface ImportFailed {
  readonly kind: "failed";
  readonly failure: Failure;
}

export interface Importer {
  open(): Promise<ImportOpened | ImportFailed>;
  plan(session: SessionId, entry: ImportEntry): Promise<ImportPlanned | ImportFailed>;
  /** A change like any other, so it joins the queue. */
  commit(session: SessionId, entry: ImportEntry): Promise<ImportCommitted | Failed>;
}

export interface LedgerClient {
  readonly replica: Replica;
  run(command: FamilyCommand): Promise<LedgerOutcome>;
  step(direction: StepDirection): Promise<LedgerOutcome>;
  /** Core's `apply` on the page's copy, as of the main process's day. Changes nothing. Null while nothing is loaded. */
  preview(command: FamilyCommand): ApplyResult | null;
  /** The figures for the page's copy, or null while nothing is loaded. The same object until the copy or the day changes. */
  figures(): Figures | null;
  readonly importer: Importer;
  start(): () => void;
}

export type ComputeFigures = (facts: Facts, asOf: LocalDate) => Figures;

type Applied = Extract<RunResult, { readonly status: "applied" }>;
const isApplied = (value: { readonly status: string }): value is Applied => value.status === "applied";

const failed = (failure: Failure): Failed => ({ status: "failed", failure });
const savedButBehind: Failure = { code: "out-of-sync", message: "The change was saved, but this page could not catch up with it." };

export function createLedgerClient(api: LedgerApi, environment: ReplicaEnvironment, compute: ComputeFigures = computeFigures): LedgerClient {
  const replica = createReplica(api, environment);

  let tail: Promise<unknown> = Promise.resolve();
  function inOrder<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function settle<T extends { readonly status: string }>(answer: Reply<T>): Promise<T | Failed> {
    if (!answer.ok) return failed(answer.failure);
    const value = answer.value;
    if (isApplied(value)) {
      await replica.accept(value);
      if (!replica.reached(value.revision)) return failed(savedButBehind);
    }
    return value;
  }

  let cached: { readonly facts: Facts; readonly today: LocalDate; readonly figures: Figures } | null = null;

  const unwrap = <T extends { readonly kind: string }>(answer: Reply<T>): T | ImportFailed => (answer.ok ? answer.value : { kind: "failed", failure: answer.failure });

  return {
    replica,
    run: (command) => inOrder(async () => settle(await api.run(command))),
    step: (direction) => inOrder(async () => settle(await api.step(direction))),

    preview(command) {
      const view = replica.get();
      return view === null ? null : apply(view.facts, command, { asOf: view.today });
    },

    // Keyed on the facts object as well as the day: it is new whenever the revision moves or the copy is replaced.
    figures() {
      const view = replica.get();
      if (view === null) return null;
      if (cached === null || cached.facts !== view.facts || cached.today !== view.today) {
        cached = { facts: view.facts, today: view.today, figures: compute(view.facts, view.today) };
      }
      return cached.figures;
    },

    importer: {
      open: async () => unwrap(await api.importOpen()),
      plan: async (session, entry) => unwrap(await api.importPlan(session, entry)),
      commit: (session, entry) => inOrder(async () => settle(await api.importCommit(session, entry))),
    },

    start: () => replica.start(),
  };
}
