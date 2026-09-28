import type { Language, ResearchDepth, ResearchMode } from '../types';

/** Default source ceiling applied when a wide research run omits `maxSources`. */
export declare const DEFAULT_WIDE_MAX_SOURCES: number;

/** Request body accepted by `POST /api/research/start`. */
export interface ResearchStartPayload {
  query: string;
  mode: ResearchMode;
  report_type: ResearchDepth;
  perspective: string;
  language: Language;
  maxSources?: number;
  [key: string]: unknown;
}

/**
 * Normalizes the renderer's research controls into the engine request body:
 * `mode` collapses to `standard` unless it is exactly `wide`, and wide runs
 * receive the declared default source ceiling when none is supplied.
 */
export declare function buildResearchStartPayload(input: {
  query: string;
  mode: ResearchMode;
  depth: ResearchDepth;
  perspective: string;
  language: Language;
  [key: string]: unknown;
}): ResearchStartPayload;
