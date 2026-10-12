const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sourceLab', {
  action: value => ipcRenderer.invoke('source-lab:action', value),
  onUpdate: callback => ipcRenderer.on('source-lab:update', (_event, value) => callback(value)),
});
