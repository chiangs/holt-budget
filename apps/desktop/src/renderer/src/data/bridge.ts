/**
 * The one module in the page that reaches the preload's bridge object. Every call resolves to a `Reply`: the value, or a
 * `Failure` when the call itself did not work. A refusal or a conflict is a value inside `RunResult`, never a
 * failure. `message` is English source text for the log; screens branch on `code` and show their own words.
 */

import type { FamilyCommand } from "@holt/core";
import type { HoltBridge } from "../../../shared/bridge.ts";
import type { Args, IpcErrorCode, IpcResult } from "../../../shared/channels.ts";
import type { ImportCommitted, ImportEntry, ImportOpened, ImportPlanned, SessionId } from "../../../shared/import-types.ts";
import type { RunResult, SnapshotResult, StepDirection } from "../../../shared/ledger-types.ts";

/** The first three come from the main process. The rest are the page's own. */
export type FailureCode =
  | IpcErrorCode
  /** The bridge is missing, or the call never came back. */
  | "unreachable"
  /** The main process answered with facts the page can't read. */
  | "bad-reply"
  /** The change was saved but this page couldn't catch up with it. */
  | "out-of-sync";

export interface Failure {
  readonly code: FailureCode;
  readonly message: string;
}

export type Reply<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

/** What the page needs from the main process, one method per channel it uses. */
export interface LedgerApi {
  snapshot(): Promise<Reply<SnapshotResult>>;
  run(command: FamilyCommand): Promise<Reply<RunResult>>;
  step(direction: StepDirection): Promise<Reply<RunResult>>;
  importOpen(): Promise<Reply<ImportOpened>>;
  importPlan(session: SessionId, entry: ImportEntry): Promise<Reply<ImportPlanned>>;
  importCommit(session: SessionId, entry: ImportEntry): Promise<Reply<ImportCommitted>>;
}

async function reply<T>(call: () => Promise<IpcResult<T>>): Promise<Reply<T>> {
  try {
    const result = await call();
    return result.ok ? { ok: true, value: result.value } : { ok: false, failure: { code: result.error.code, message: result.error.message } };
  } catch (error) {
    return { ok: false, failure: { code: "unreachable", message: error instanceof Error ? error.message : "The call to the app failed." } };
  }
}

/** The schema is strict, so the page sends exactly these fields. The cast only drops `readonly`, which the schema's output type doesn't carry on a split's allocations. */
const wireEntry = (entry: ImportEntry): Args<"holt:import-plan">[1] =>
  ({ balances: [...entry.balances], choices: [...entry.choices], suggest: entry.suggest }) as Args<"holt:import-plan">[1];

const unavailable = (): HoltBridge | undefined => (typeof window === "undefined" ? undefined : window.holt);

/** The page's api over the preload bridge. `bridge` is injected only so a test can stand in for the preload. */
export function windowApi(bridge: () => HoltBridge | undefined = unavailable): LedgerApi {
  const holt = (): HoltBridge => {
    const found = bridge();
    if (found === undefined) throw new Error("The app's bridge is missing.");
    return found;
  };
  return {
    snapshot: () => reply(() => holt().factsSnapshot()),
    run: (command) => reply(() => holt().run(command)),
    step: (direction) => reply(() => holt().historyStep(direction)),
    importOpen: () => reply(() => holt().importOpen()),
    importPlan: (session, entry) => reply(() => holt().importPlan(session, wireEntry(entry))),
    importCommit: (session, entry) => reply(() => holt().importCommit(session, wireEntry(entry))),
  };
}
