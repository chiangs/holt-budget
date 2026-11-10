/**
 * The React side of the data layer. One provider holds the client, and every screen reads the same page copy
 * of the facts through these hooks, so a change made anywhere shows everywhere with no read channel per view.
 * The hooks return null while nothing is loaded: the first snapshot is on its way, there is no household yet,
 * or the snapshot failed (`useLedgerStatus` says which).
 */

import type { Figures } from "@holt/core";
import { type ReactNode, createContext, use, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { LogHead } from "../../../shared/ledger-types.ts";
import { windowApi } from "./bridge.ts";
import { type Importer, type LedgerClient, type LedgerOutcome, createLedgerClient } from "./client.ts";
import type { FactsView, ReplicaEnvironment, ReplicaStatus } from "./replica.ts";

export function browserEnvironment(): ReplicaEnvironment {
  return {
    now: () => new Date(),
    setTimer(callback, delayMs) {
      const id = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(id);
    },
    onFocus(callback) {
      window.addEventListener("focus", callback);
      return () => window.removeEventListener("focus", callback);
    },
  };
}

const LedgerContext = createContext<LedgerClient | null>(null);

/** `client` is for a test or a preview that supplies its own. The app passes nothing. */
export function LedgerProvider({ children, client }: { readonly children: ReactNode; readonly client?: LedgerClient }) {
  const [own] = useState(() => client ?? createLedgerClient(windowApi(), browserEnvironment()));
  useEffect(() => own.start(), [own]);
  return <LedgerContext value={own}>{children}</LedgerContext>;
}

function useClient(): LedgerClient {
  const client = use(LedgerContext);
  if (client === null) throw new Error("Read the facts inside a LedgerProvider.");
  return client;
}

export function useFactsView(): FactsView | null {
  const { replica } = useClient();
  return useSyncExternalStore(replica.subscribe, replica.get);
}

export function useLedgerStatus(): ReplicaStatus {
  const { replica } = useClient();
  return useSyncExternalStore(replica.subscribe, replica.status);
}

/** Computed once for each state of the facts, however many screens ask. */
export function useFigures(): Figures | null {
  const client = useClient();
  return useSyncExternalStore(client.replica.subscribe, client.figures);
}

export interface Ledger {
  run: LedgerClient["run"];
  step: LedgerClient["step"];
  preview: LedgerClient["preview"];
  importer: Importer;
  /** The change an undo would reverse and the one a redo would apply again, or null while nothing is loaded. */
  head: LogHead | null;
  /** Takes a new snapshot, for a screen that offers to try again. */
  reload: LedgerClient["replica"]["resync"];
}

export function useLedger(): Ledger {
  const client = useClient();
  const head = useFactsView()?.head ?? null;
  return useMemo(
    () => ({ run: client.run, step: client.step, preview: client.preview, importer: client.importer, head, reload: client.replica.resync }),
    [client, head],
  );
}

export type { Failure, FailureCode } from "./bridge.ts";
export type { FactsView, Importer, LedgerOutcome, ReplicaStatus };
