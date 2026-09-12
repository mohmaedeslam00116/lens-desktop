import { LLMRequestOptions, ModelClient } from './models';
import { PiAdapter } from './piAdapter';

/**
 * The AgentCore generation gateway (ADR-0009, spec #66, tickets #71/#72).
 *
 * The research loops call `generate(request)` instead of `ModelClient.generate`
 * directly. The active core defaults to the legacy hand-rolled client, so
 * existing behaviour is untouched; switching to the pi core routes every loop
 * LLM call through the pi-backed adapter (dormant seam work from tickets
 * #68/#69). Tests flip the core with `setActiveCore('pi', { overrideFactory })`
 * and a faux provider — no real network anywhere.
 */

export type AgentCoreKind = 'modelclient' | 'pi';

let activeCore: AgentCoreKind = 'modelclient';
let activePiOptions: Parameters<typeof PiAdapter.generate>[1] | undefined;

export function setActiveCore(core: AgentCoreKind, piOptions?: Parameters<typeof PiAdapter.generate>[1]): void {
  activeCore = core;
  activePiOptions = piOptions;
}

export function getActiveCore(): AgentCoreKind {
  return activeCore;
}

export function resetActiveCore(): void {
  activeCore = 'modelclient';
  activePiOptions = undefined;
}

/** Loop-facing generation entry point: routes to the active AgentCore. */
export async function generate(request: LLMRequestOptions): Promise<string> {
  if (activeCore === 'pi') {
    return await PiAdapter.generate(request, activePiOptions);
  }
  return await ModelClient.generate(request);
}