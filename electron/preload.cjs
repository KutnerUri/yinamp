const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yinampDesktop', {
  readState: () => ipcRenderer.invoke('yinamp:read-state'),
  saveState: state => ipcRenderer.invoke('yinamp:save-state', state),
  player: command => ipcRenderer.invoke('yinamp:player', command),
  account: action => ipcRenderer.invoke('yinamp:account', action),
  library: value => ipcRenderer.invoke('yinamp:library', value),
  layout: bounds => ipcRenderer.send('yinamp:layout', bounds),
  onPlayer: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('yinamp:player-state', listener);
    return () => ipcRenderer.removeListener('yinamp:player-state', listener);
  },
});
