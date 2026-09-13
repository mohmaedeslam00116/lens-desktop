import { startBillionContext, disposeBillion, BillionContextHandle } from './billionContext';

/**
 * compressionRouting.ts — routes researcher long-context model traffic through
 * the supervised billion-context proxy (ADR-0010, ticket #92).
 *
 * Contract:
 *  - Opt-in via `compression_mode` (requires `researcher_mode`; dormant by
 *    default). When healthy, researcher `generate()` calls carry
 *    `proxyBaseUrl`, so the pi adapter rewrites every model's upstream
 *    baseUrl through the proxy's URL-prefix mode — upstream preserved in the
 *    path (`http://127.0.0.1:<port>/bili/<upstream>`), no MITM/CA.
 *  - Graceful degradation: an unhealthy proxy, missing binary, or startup
 *    timeout yields `null` + a `notice` — the run continues UNCOMPRESSED.
 *    Compression is a pure optimization here, never a correctness gate.
 *  - `dispose()` always reaps the supervised child (idempotent), including
 *    the degraded path where startup failed but a child may linger.
 */

export interface CompressionRoutingOptions {
  enabled?: boolean;
  port?: number;
  /** Test seam: stub the child executable (no bundled billion-context, no real network). */
  binary?: string;
  healthTimeoutMs?: number;
  /** Cancellation: forwarded into proxy startup and its health probes. */
  signal?: AbortSignal;
}

export interface CompressionRoutingResult {
  /** Proxy base URL to hand the model client, or null to run uncompressed. */
  proxyBaseUrl: string | null;
  /** Non-fatal degradation notices for telemetry. */
  notices: string[];
  /** True when the run must reap the supervisor on dispose. */
  ownsProxy: boolean;
}

/**
 * Starts the compression proxy and returns the routing decision. Never
 * throws: every failure mode degrades to the uncompressed run with a notice.
 * Cancellation is honored: an aborted signal during startup stops the wait
 * and degrades immediately instead of blocking for the full timeout.
 */
export async function routeCompression(
  options: CompressionRoutingOptions = {}
): Promise<CompressionRoutingResult> {
  if (!options.enabled) {
    return { proxyBaseUrl: null, notices: [], ownsProxy: false };
  }
  try {
    const handle: BillionContextHandle | null = await startBillionContext({
      enabled: true,
      port: options.port,
      binary: options.binary,
      healthTimeoutMs: options.healthTimeoutMs,
      signal: options.signal,
    });
    if (!handle || !handle.healthy) {
      // startBillionContext already reaped any lingering child on timeout;
      // dispose defensively anyway (idempotent) and degrade with a notice.
      await disposeBillion();
      return {
        proxyBaseUrl: null,
        notices: ['Compression proxy unavailable — continuing without compression.'],
        ownsProxy: false,
      };
    }
    return { proxyBaseUrl: handle.baseUrl(), notices: [], ownsProxy: true };
  } catch (err) {
    console.warn('[compressionRouting] proxy startup failed; degrading to uncompressed:', err);
    await disposeBillion();
    return {
      proxyBaseUrl: null,
      notices: ['Compression proxy startup failed — continuing without compression.'],
      ownsProxy: false,
    };
  }
}

/** Stop and reap the supervised proxy child. Idempotent; safe to always call. */
export async function disposeCompression(): Promise<void> {
  await disposeBillion();
}
