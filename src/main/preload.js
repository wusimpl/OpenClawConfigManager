const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (json) => ipcRenderer.invoke('config:write', json),
    onChanged: (cb) => ipcRenderer.on('config:changed', cb),
  },
  gateway: {
    status: () => ipcRenderer.invoke('gateway:status'),
    start: () => ipcRenderer.invoke('gateway:start'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    restart: () => ipcRenderer.invoke('gateway:restart'),
    health: () => ipcRenderer.invoke('gateway:health'),
  },
  agents: {
    add: (payload) => ipcRenderer.invoke('agents:add', payload),
  },
  models: {
    fetch: (opts) => ipcRenderer.invoke('models:fetch', opts),
  },
  workspace: {
    listFiles: (wsPath) => ipcRenderer.invoke('workspace:listFiles', wsPath),
    readFile: (wsPath, fileName) => ipcRenderer.invoke('workspace:readFile', wsPath, fileName),
    writeFile: (wsPath, fileName, content) => ipcRenderer.invoke('workspace:writeFile', wsPath, fileName, content),
  },
  logs: {
    read: (opts) => ipcRenderer.invoke('logs:read', opts),
  },
  skills: {
    listBundled: () => ipcRenderer.invoke('skills:listBundled'),
    listAll: () => ipcRenderer.invoke('skills:listAll'),
  },
});
