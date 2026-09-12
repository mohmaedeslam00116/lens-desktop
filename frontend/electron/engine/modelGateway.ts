import { LLMRequestOptions } from './models';
import { PiAdapter, PiAdapterOptions } from './piAdapter';

/**
 * The AgentCore generation gateway (ADR-0009, spec #66, tickets #71/#72, retired in #73).
 *
 * All research-loop LLM calls route here. The legacy `ModelClient.generate`
 * path is retired: the gateway forwards every generation request to the
 * pi-backed adapter, whose per-request options (provider overrides for tests,
 * session AbortSignal) merge over the module defaults.
 *
 * Tests keep the legacy seam alive the cheap way: `setActiveCore('pi',
 * { overrideFactory })` with a faux provider — no real network anywhere.
 */

let activePiOptions: PiAdapterOptions | undefined;

export function setActiveCore(core: 'modelclient' | 'pi', piOptions?: PiAdapterOptions): void {
  if (core !== 'pi') {
    throw new Error(`[modelGateway] '${core}' retired: only the pi core remains. Loanword kept for test call-sites.`);
  }
  activePiOptions = piOptions;
}

export function getActiveCore(): 'modelclient' | 'pi' {
  return 'pi';
}

export function resetActiveCore(): void {
  activePiOptions = undefined;
}

/** Per-request adapter options (currently the session AbortSignal). */
export interface GatewayGenerateOptions {
  signal?: AbortSignal;
}

/**
 * Loop-facing generation entry point: every loop call lands on the pi core.
 * Per-request options (e.g. the session's AbortSignal) are merged over the
 * module defaults so each research session forwards its own cancellation
 * signal without mutating or sharing global abort state.
 */
export async function generate(request: LLMRequestOptions, perRequest?: GatewayGenerateOptions): Promise<string> {
  const adapterOptions = { ...(activePiOptions || {}), ...(perRequest || {}) };
  return await PiAdapter.generate(request, adapterOptions);
}