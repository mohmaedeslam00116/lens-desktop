export interface EngineProbeResult {
  status: 'online' | 'offline';
  reason:
    | 'ok'
    | 'unreachable'
    | 'http_error'
    | 'timeout'
    | 'invalid_report'
    | 'port_owner_mismatch';
  reportedPort: number | null;
  httpStatus?: number | null;
}

/** Milliseconds a single readiness probe may take before it is abandoned. */
export declare const ENGINE_PROBE_TIMEOUT_MS: number;

/** Interval between readiness probes while the workspace is open. */
export declare const ENGINE_POLL_INTERVAL_MS: number;

/** The engine's readiness route. */
export declare const ENGINE_READINESS_PATH: string;

/** Identity the engine must report to be recognised as the LENS engine. */
export declare const ENGINE_IDENTITY: string;

/**
 * Every reason the probe can report, exported as the source of truth the
 * interface translates from.
 */
export declare const INTERPRETED_REASONS: readonly EngineProbeResult['reason'][];

/**
 * Interprets the engine's readiness report, rejecting a payload that does not
 * identify itself as the LENS engine or that reports a different bound port.
 */
export declare function interpretEngineHealthReport(
  payload: unknown,
  expectedPort: number | null
): { ok: boolean; reason: EngineProbeResult['reason']; reportedPort: number | null };

/** Probes the engine's readiness route; never throws. */
export declare function probeEngineHealth(options?: {
  baseUrl: string | null;
  expectedPort?: number | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<EngineProbeResult>;

/** True when the engine bound a port other than the preferred one. */
export declare function isFallbackPort(port: number | null, preferredPort: number | null): boolean;
