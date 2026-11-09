import { contextBridge, ipcRenderer } from "electron";
import { createBridge } from "../shared/bridge.ts";

export type { HoltBridge } from "../shared/bridge.ts";

contextBridge.exposeInMainWorld("holt", createBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)));
