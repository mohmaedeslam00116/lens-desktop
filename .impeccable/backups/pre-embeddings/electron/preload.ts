import { contextBridge, ipcRenderer, shell } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  secureStore: {
    set: (key: string, value: string) => ipcRenderer.invoke('secure-store-set', key, value),
    get: (key: string) => ipcRenderer.invoke('secure-store-get', key),
  },
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url);
  }
});
