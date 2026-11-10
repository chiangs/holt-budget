import type { AppInfo, DatabaseState } from "../shared/channels.ts";
import type { FactsStore } from "./facts/index.ts";
import type { Handlers } from "./ipc-dispatch.ts";
import type { Imports } from "./imports/imports.ts";

export interface HandlerDeps {
  appInfo(): AppInfo;
  databaseState(): DatabaseState;
  /** The store and the import exist once the database is open and holds a household. */
  store(): FactsStore | null;
  imports(): Imports | null;
}

function household<T>(service: T | null): T {
  if (service === null) throw new Error("There is no household yet.");
  return service;
}

/** One line per channel. The dispatcher has already checked every argument. */
export function createHandlers(deps: HandlerDeps): Handlers {
  return {
    "holt:app-info": () => deps.appInfo(),
    "holt:database-state": () => deps.databaseState(),
    "holt:facts-snapshot": () => {
      const store = deps.store();
      return store === null ? { kind: "empty" } : { kind: "ready", snapshot: store.snapshot() };
    },
    "holt:run": (command) => household(deps.store()).run(command),
    "holt:history-step": (direction) => household(deps.store()).step(direction),
    "holt:import-open": () => household(deps.imports()).open(),
    "holt:import-plan": (session, entry) => household(deps.imports()).plan(session, entry),
    "holt:import-commit": (session, entry) => household(deps.imports()).commit(session, entry),
  };
}
