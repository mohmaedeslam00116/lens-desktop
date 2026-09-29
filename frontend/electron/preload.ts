import { contextBridge, ipcRenderer, shell } from 'electron';

interface EngineEndpointSnapshot {
  port: number | null;
  baseUrl: string | null;
  wsBaseUrl: string | null;
  status: 'ready' | 'failed';
  error: string | null;
}

/**
 * Read once, synchronously, while the bridge is built: the renderer needs the
 * engine's real port before it issues its first request, because the preferred
 * port may have been taken and the engine then binds an ephemeral one.
 */
const engineEndpoint: EngineEndpointSnapshot = ipcRenderer.sendSync('engine-endpoint');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  engine: {
    endpoint: engineEndpoint,
  },
  secureStore: {
    set: (key: string, value: string) => ipcRenderer.invoke('secure-store-set', key, value),
    get: (key: string) => ipcRenderer.invoke('secure-store-get', key),
  },
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url);
  }
});
