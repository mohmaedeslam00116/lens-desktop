/**
 * researchDefaults.ts — research-path default resolution (ADR-0010 phase 4,
 * ticket #95, recorded as ADR-0012).
 *
 * Contract step: the standard loop defaults to the AGENCY path (Parent
 * Research Agent). The legacy single-loop remains reachable via the
 * `legacy_mode: true` escape flag pending removal (expand–contract closure).
 *
 * Resolution order: explicit request flag > settings default.
 *  - `legacy_mode: true`  → legacy single-loop (escape hatch, A/B, support)
 *  - otherwise            → agency path
 *
 * Wide mode is NEVER rerouted (unchanged phase-1 rule).
 */

export const DEFAULT_AGENCY_MODE = true;

export interface ResearchPathSettings {
  /** Settings-surface escape hatch (mirrors the request flag). */
  legacyMode?: boolean;
}

/** Resolves the effective legacy escape flag: request wins over settings. */
export function resolveLegacyMode(
  request: { legacy_mode?: boolean } | null | undefined,
  settings?: ResearchPathSettings | null
): boolean {
  if (request && typeof request.legacy_mode === 'boolean') return request.legacy_mode;
  return settings?.legacyMode === true;
}

/** True when the standard loop should run the agency path. */
export function shouldUseAgencyPath(
  request: { mode?: string; legacy_mode?: boolean } | null | undefined,
  settings?: ResearchPathSettings | null
): boolean {
  if (request?.mode === 'wide') return false; // wide is never rerouted
  return !resolveLegacyMode(request, settings);
}
