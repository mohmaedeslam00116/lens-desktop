export interface EngineEndpoint {
  /** TCP port the embedded engine is bound to. */
  port: number;
  /**
   * HTTP origin, e.g. `http://127.0.0.1:8000` — `null` when the main process
   * could not start the engine, so no address is routable.
   */
  baseUrl: string | null;
  /** WebSocket origin, e.g. `ws://127.0.0.1:8000` — `null` on startup failure. */
  wsBaseUrl: string | null;
  /** `failed` when the main process could not start the engine at all. */
  status: 'ready' | 'failed';
  /** Operator-facing failure reason, present only when `status` is `failed`. */
  error: string | null;
}

export declare const DEFAULT_ENGINE_PORT: number;
export declare const DEFAULT_ENGINE_BASE_URL: string;
export declare const DEFAULT_ENGINE_WS_URL: string;

/**
 * Prefers the endpoint the Electron main process bound (it may be an ephemeral
 * port when the preferred one was taken) and falls back to the declared
 * preference when no bridge is present.
 */
export declare function resolveEngineEndpoint(engineApi?: unknown): EngineEndpoint;

/** Reads the endpoint the preload bridge exposed on `window`, if any. */
export declare function resolveEngineEndpointFromWindow(hostWindow?: unknown): EngineEndpoint;
