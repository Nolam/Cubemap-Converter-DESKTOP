const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectSavePath: (defaultName, ext) =>
    ipcRenderer.invoke("select-save-path", defaultName, ext),
});
