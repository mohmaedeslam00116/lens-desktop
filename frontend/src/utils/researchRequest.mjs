export const DEFAULT_WIDE_MAX_SOURCES = 200;

export function buildResearchStartPayload(input) {
  const { query, mode, depth, perspective, language, ...configuration } = input;
  const request = {
    ...configuration,
    query,
    mode: mode === 'wide' ? 'wide' : 'standard',
    report_type: depth,
    perspective,
    language,
  };

  if (mode === 'wide') {
    request.maxSources = request.maxSources ?? DEFAULT_WIDE_MAX_SOURCES;
  }

  return request;
}
