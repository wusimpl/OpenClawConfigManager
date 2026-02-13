const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (json) => ipcRenderer.invoke('config:write', json),
  },
  gateway: {
    status: () => ipcRenderer.invoke('gateway:status'),
    start: () => ipcRenderer.invoke('gateway:start'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    restart: () => ipcRenderer.invoke('gateway:restart'),
    health: () => ipcRenderer.invoke('gateway:health'),
  },
  models: {
    fetch: (opts) => ipcRenderer.invoke('models:fetch', opts),
  },
  workspace: {
    listFiles: (wsPath) => ipcRenderer.invoke('workspace:listFiles', wsPath),
    readFile: (filePath) => ipcRenderer.invoke('workspace:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('workspace:writeFile', filePath, content),
  },
});
