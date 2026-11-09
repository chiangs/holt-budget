import { app, ipcMain, safeStorage } from "electron";
import { databaseState } from "./storage/app-database.ts";
import { registerHandlers } from "./ipc-dispatch.ts";

export function registerIpc(): void {
  registerHandlers(ipcMain, {
    "holt:app-info": () => ({
      version: app.getVersion(),
      storageBackend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os",
    }),
    "holt:database-state": () => databaseState(),
  });
}
