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

/** Per-request adapter options (currently the session AbortSignal). */
export interface GatewayGenerateOptions {
  signal?: AbortSignal;
}

/**
 * Loop-facing generation entry point: routes to the active AgentCore.
 * Per-request options (e.g. the session's AbortSignal) are merged over the
 * global defaults so each research session forwards its own cancellation
 * signal without mutating or sharing global abort state.
 */
export async function generate(request: LLMRequestOptions, perRequest?: GatewayGenerateOptions): Promise<string> {
  if (activeCore === 'pi') {
    const adapterOptions = { ...(activePiOptions || {}), ...(perRequest || {}) };
    return await PiAdapter.generate(request, adapterOptions);
  }
  return await ModelClient.generate(request);
}