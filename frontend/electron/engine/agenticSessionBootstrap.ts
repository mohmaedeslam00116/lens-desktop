import type { LensToolSurface } from './agentSessionHost';

/**
 * The agentic session bootstrap (ticket #142, ADR-0014): builds ONE hosted
 * Pi AgentSession through the single #140 construction seam with the
 * LENS-wrapped tool surface registered at construction. Pi owns auth
 * (tracer P2): callers pass Pi provider/model ids only — never keys.
 *
 * Kept as its own module so the HTTP layer never imports the host seam
 * statically: the pi runtime loads lazily on the first agentic start, and
 * the server boots with zero agent-runtime cost.
 */
export async function createAgenticResearchSession(
  sessionId: string,
  tools: LensToolSurface,
  auth?: { provider?: string; modelName?: string }
): Promise<any> {
  const { createResearchSession } = await import('./agentSessionHost');
  const hosted = await createResearchSession(
    {
      sessionId,
      ...(auth?.provider ? { provider: auth.provider } : {}),
      ...(auth?.modelName ? { modelName: auth.modelName } : {}),
    },
    tools
  );
  return hosted.session;
}
