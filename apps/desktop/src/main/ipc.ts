import { app, ipcMain, safeStorage } from "electron";
import { mintId } from "../shared/ids.ts";
import { systemClock } from "./clock.ts";
import type { FactsStore } from "./facts/index.ts";
import { appStore, databaseState } from "./storage/app-database.ts";
import { type Imports, createImports } from "./imports/imports.ts";
import { chooseStatementFile } from "./imports/dialog.ts";
import { readStatementFile } from "./imports/files.ts";
import { createHandlers } from "./ipc-handlers.ts";
import { registerHandlers } from "./ipc-dispatch.ts";

export function registerIpc(): void {
  let held: { readonly store: FactsStore; readonly imports: Imports } | null = null;
  registerHandlers(
    ipcMain,
    createHandlers({
      appInfo: () => ({
        version: app.getVersion(),
        storageBackend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os",
      }),
      databaseState,
      store: appStore,
      imports: () => {
        const store = appStore();
        if (store === null) return null;
        if (held?.store !== store) {
          held = { store, imports: createImports(store, { clock: systemClock, mint: mintId, pickFile: chooseStatementFile, readFile: readStatementFile }) };
        }
        return held.imports;
      },
    }),
  );
}
