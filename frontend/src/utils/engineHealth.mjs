export const ENGINE_PROBE_TIMEOUT_MS = 4000;
export const ENGINE_POLL_INTERVAL_MS = 15000;

/** The engine's readiness route; see `startEmbeddedServer` in the engine. */
export const ENGINE_READINESS_PATH = '/';

/**
 * Identity the engine reports on its readiness route.
 *
 * Reachability alone proves nothing: any listener can answer on the port. The
 * engine therefore names itself in its report, and the probe requires that name
 * so an unrelated service cannot be mistaken for LENS. The engine-reachability
 * test boots the real engine and asserts its payload satisfies this contract, so
 * the two sides cannot drift apart unnoticed.
 */
export const ENGINE_IDENTITY = 'LENS embedded research engine';

/**
 * Every reason the probe can report. The interface switches on these strings to
 * choose its wording, so the set is exported as the single source of truth: a
 * new reason cannot be introduced without the interface being able to translate
 * it, and the reachability test asserts the probe never returns anything else.
 */
export const INTERPRETED_REASONS = [
  'ok',
  'invalid_report',
  'port_owner_mismatch',
  'http_error',
  'unreachable',
  'timeout',
];

/**
 * Interprets the embedded engine's readiness report.
 *
 * Returns a machine-readable `reason` so the interface can translate the
 * message instead of the util inventing prose.
 */
export function interpretEngineHealthReport(payload, expectedPort) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'invalid_report', reportedPort: null };
  }
  if (payload.status !== 'ok' || payload.engine !== ENGINE_IDENTITY) {
    return { ok: false, reason: 'invalid_report', reportedPort: null };
  }

  const reportedPort = Number.isInteger(payload.port) && payload.port > 0 ? payload.port : null;
  if (expectedPort && reportedPort && reportedPort !== expectedPort) {
    return { ok: false, reason: 'port_owner_mismatch', reportedPort };
  }

  return { ok: true, reason: 'ok', reportedPort };
}

/**
 * Probes the engine's readiness route.
 *
 * `fetchImpl` is injected so the probe stays testable without a live engine.
 * Every failure maps to a reason rather than throwing: an unreachable engine is
 * an expected state the workspace reports, not an exception.
 */
export async function probeEngineHealth({
  baseUrl,
  expectedPort = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = ENGINE_PROBE_TIMEOUT_MS,
} = {}) {
  if (!baseUrl || typeof fetchImpl !== 'function') {
    return { status: 'offline', reason: 'unreachable', reportedPort: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}${ENGINE_READINESS_PATH}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      return {
        status: 'offline',
        reason: 'http_error',
        reportedPort: null,
        httpStatus: response ? response.status : null,
      };
    }

    const payload = await response.json().catch(() => null);
    const verdict = interpretEngineHealthReport(payload, expectedPort);
    return {
      status: verdict.ok ? 'online' : 'offline',
      reason: verdict.reason,
      reportedPort: verdict.reportedPort,
      httpStatus: response.status,
    };
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
    return { status: 'offline', reason: aborted ? 'timeout' : 'unreachable', reportedPort: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when the engine is serving on a port other than the preferred one, which
 * happens when another process already holds the preferred port. Worth telling
 * the operator: it explains why the port differs from the documented default.
 */
export function isFallbackPort(port, preferredPort) {
  return Number.isInteger(port) && Number.isInteger(preferredPort) && port !== preferredPort;
}
