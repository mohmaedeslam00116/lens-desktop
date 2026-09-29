import type { LensToolSurface } from './agentSessionHost';

/**
 * The agentic session bootstrap (ticket #142, ADR-0014): builds ONE hosted
 * Pi AgentSession through the single #140 construction seam with the
 * LENS-wrapped tool surface registered at construction. Request-level
 * provider keys ride as non-persisted runtime overrides — the seam stays the
 * single point that owns the key surface (keys never touch the engine's
 * logs, telemetry, or responses).
 *
 * Kept as its own module so the HTTP layer never imports the host seam
 * statically: the pi runtime loads lazily on the first agentic start, and
 * the server boots with zero agent-runtime cost.
 */
export async function createAgenticResearchSession(
  sessionId: string,
  tools: LensToolSurface,
  auth?: { provider?: string; apiKey?: string }
): Promise<any> {
  const { createResearchSession } = await import('./agentSessionHost');
  const providerOverrides: Record<string, string> = {};
  if (auth?.provider && auth.apiKey) {
    providerOverrides[auth.provider] = auth.apiKey;
  }
  const hosted = await createResearchSession({ sessionId, providerOverrides }, tools);
  return hosted.session;
}
