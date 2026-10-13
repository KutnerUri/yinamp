const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yinampDesktop', {
  openMusicResult: item => ipcRenderer.invoke('yinamp:open-music-result', item),
  readState: () => ipcRenderer.invoke('yinamp:read-state'),
  saveState: state => ipcRenderer.invoke('yinamp:save-state', state),
  player: command => ipcRenderer.invoke('yinamp:player', command),
  account: action => ipcRenderer.invoke('yinamp:account', action),
  library: async value => {
    const result = await ipcRenderer.invoke('yinamp:library', value);
    if (result?.cancelled) throw Object.assign(new Error('The account changed. Try again.'), { code: 'LIBRARY_CANCELLED' });
    return result;
  },
  onSearchResults: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('yinamp:search-results', listener);
    return () => ipcRenderer.removeListener('yinamp:search-results', listener);
  },
  layout: bounds => ipcRenderer.send('yinamp:layout', bounds),
  onPlayer: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('yinamp:player-state', listener);
    return () => ipcRenderer.removeListener('yinamp:player-state', listener);
  },
});
