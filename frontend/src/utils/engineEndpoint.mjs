export const DEFAULT_ENGINE_PORT = 8000;
export const DEFAULT_ENGINE_BASE_URL = `http://127.0.0.1:${DEFAULT_ENGINE_PORT}`;
export const DEFAULT_ENGINE_WS_URL = `ws://127.0.0.1:${DEFAULT_ENGINE_PORT}`;

/**
 * Resolves the embedded engine endpoint the renderer must talk to.
 *
 * The Electron main process binds the engine and hands the resolved endpoint to
 * the preload bridge, because the preferred port can be taken by another
 * process and the engine then binds an ephemeral one. In the browser dev
 * server (no bridge) the declared preference is used.
 */
export function resolveEngineEndpoint(engineApi) {
  const reported = engineApi && typeof engineApi === 'object' ? engineApi.endpoint : null;

  const port = Number.isInteger(reported?.port) && reported.port > 0
    ? reported.port
    : DEFAULT_ENGINE_PORT;
  const baseUrl = trimTrailingSlash(reported?.baseUrl) || `http://127.0.0.1:${port}`;
  const wsBaseUrl = trimTrailingSlash(reported?.wsBaseUrl) || `ws://127.0.0.1:${port}`;

  return {
    port,
    baseUrl,
    wsBaseUrl,
    status: reported?.status === 'failed' ? 'failed' : 'ready',
    error: typeof reported?.error === 'string' && reported.error ? reported.error : null,
  };
}

/** Reads the endpoint the preload bridge exposed on `window`, if any. */
export function resolveEngineEndpointFromWindow(hostWindow) {
  return resolveEngineEndpoint(hostWindow?.electronAPI?.engine);
}

function trimTrailingSlash(value) {
  return typeof value === 'string' && value ? value.replace(/\/+$/, '') : '';
}
