import { contextBridge, ipcRenderer } from "electron";

/**
 * The only door between the sandboxed interface and the main process.
 * Keep it small and typed. Every new call needs a handler in src/main and a
 * type in src/renderer/src/env.d.ts.
 */
const holt = {
  appInfo: (): Promise<{ version: string; storageBackend: string }> => ipcRenderer.invoke("holt:app-info"),
};

export type HoltBridge = typeof holt;

contextBridge.exposeInMainWorld("holt", holt);
