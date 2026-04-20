const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('amphubClient', {
  getConfig: () => ipcRenderer.invoke('client:get-config'),
  saveServerUrl: (serverUrl) => ipcRenderer.invoke('client:save-server-url', serverUrl),
  openConfiguredServer: () => ipcRenderer.invoke('client:open-configured-server'),
  resetServerUrl: () => ipcRenderer.invoke('client:reset-server-url'),
});
