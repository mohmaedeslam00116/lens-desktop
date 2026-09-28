import { useEffect, useRef, useState } from 'react';
import {
  ENGINE_POLL_INTERVAL_MS,
  isFallbackPort,
  probeEngineHealth,
  type EngineProbeResult,
} from '../utils/engineHealth.mjs';

export interface EngineHealth extends EngineProbeResult {
  /** True until the first probe settles, so the surface can say "checking". */
  checking: boolean;
  /** True when the engine answered on a port other than the preferred one. */
  fallbackPort: boolean;
}

const INITIAL: EngineHealth = {
  status: 'offline',
  reason: 'unreachable',
  reportedPort: null,
  checking: true,
  fallbackPort: false,
};

/**
 * Tracks whether the embedded research engine is actually reachable.
 *
 * Without this the workspace could only discover a dead engine when the first
 * research request failed. The probe verifies the engine's own readiness report
 * rather than mere port reachability, so a foreign listener cannot be mistaken
 * for a working engine.
 */
export function useEngineHealth(
  baseUrl: string | null,
  expectedPort: number | null,
  preferredPort: number | null = null,
  pollIntervalMs: number = ENGINE_POLL_INTERVAL_MS
): EngineHealth {
  const [health, setHealth] = useState<EngineHealth>(INITIAL);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let probing = false;

    const probe = async () => {
      if (probing) return; // never let a slow probe stack up behind the interval
      probing = true;
      try {
        const result = await probeEngineHealth({ baseUrl, expectedPort });
        if (!mountedRef.current) return;
        setHealth({
          ...result,
          checking: false,
          fallbackPort: isFallbackPort(result.reportedPort, preferredPort),
        });
      } finally {
        probing = false;
      }
    };

    probe();
    timer = setInterval(probe, pollIntervalMs);

    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [baseUrl, expectedPort, preferredPort, pollIntervalMs]);

  return health;
}
