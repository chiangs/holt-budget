const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("s1", {
  control: (action) => ipcRenderer.send("s1:control", action),
});
