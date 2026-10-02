/**
 * Pi-owned Ollama persistence — tracer P4 of the Pi-only backend migration.
 *
 * Ollama is the one LENS-supported provider Pi does not ship, so LENS closes
 * the gap through Pi's native file mechanism: the local server (endpoint +
 * probed models) persists as an ordinary provider entry in the `models.json`
 * overlay under the LENS-owned agent directory — the same file every Pi
 * `ModelRuntime` in this engine loads via `modelsPath`. No parallel LENS
 * registry, no per-request endpoints: Settings saves the endpoint once,
 * sessions/embeddings/listings resolve it from the file.
 *
 * File shape (Pi's own `ModelsConfigSchema`):
 * `{ providers: { ollama: { name, baseUrl: "<endpoint>/v1", api:
 * "openai-completions", models: [{ id, name }] } } }` — other providers in
 * the file are preserved merge-safely on every write. A saved-but-unreachable
 * server persists with an empty model list (honest: listed, never invented).
 */

export const OLLAMA_PROVIDER_ID = 'ollama';
export const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434';

/** Normalize + validate a user-supplied endpoint (throws bilingual-ready Error). */
export function normalizeOllamaEndpoint(endpoint: string): string {
  const base = (endpoint ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(`Ollama endpoint must be an http(s) URL (got "${endpoint ?? ''}").`);
  }
  return base;
}

export interface OllamaOverlayModels {
  id: string;
  name: string;
}

export interface OllamaOverlayStatus {
  /** Base server URL without the `/v1` suffix, or null when never saved. */
  endpoint: string | null;
  models: OllamaOverlayModels[];
  /** True when an endpoint was saved (even with an empty model list). */
  configured: boolean;
}

function defaultAgentDir(): string {
  // Compiled to CJS: resolve through the host seam without a static import
  // (this module sits beneath every import closure that uses it).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const host = require('./agentSessionHost') as { resolveAgentDir?: () => string };
    if (typeof host.resolveAgentDir === 'function') return host.resolveAgentDir();
  } catch {
    // Fall through to the LENS-owned home path.
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { homedir } = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('path') as typeof import('path');
  return join(homedir(), '.lens', 'pi-agent');
}

function overlayPath(agentDir?: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('path') as typeof import('path');
  return join(agentDir ?? defaultAgentDir(), 'models.json');
}

/** Probe the local server's model catalog (throws when unreachable). */
export async function probeOllamaModels(endpoint: string): Promise<OllamaOverlayModels[]> {
  const base = normalizeOllamaEndpoint(endpoint);
  let tags: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      tags = await fetch(`${base}/api/tags`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    throw new Error(`Ollama unreachable at ${base}: ${err?.message ?? String(err)}`);
  }
  if (!tags.ok) {
    throw new Error(`Ollama unreachable at ${base} (HTTP ${tags.status}).`);
  }
  const data: any = await tags.json().catch(() => ({}));
  return ((data?.models ?? []) as any[])
    .map((m) => String(m?.name ?? m?.model ?? '').trim())
    .filter((id) => id.length > 0)
    .map((id) => ({ id, name: id }));
}

/** Read the persisted Ollama overlay (tolerant: missing/invalid → unconfigured). */
export function readOllamaOverlay(agentDir?: string): OllamaOverlayStatus {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync, existsSync } = require('fs') as typeof import('fs');
    const path = overlayPath(agentDir);
    if (!existsSync(path)) return { endpoint: null, models: [], configured: false };
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    const entry = parsed?.providers?.[OLLAMA_PROVIDER_ID];
    if (!entry || typeof entry !== 'object') return { endpoint: null, models: [], configured: false };
    const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl.trim().replace(/\/+$/, '') : '';
    if (!baseUrl) return { endpoint: null, models: [], configured: false };
    const models = Array.isArray(entry.models)
      ? entry.models
          .filter((m: any) => typeof m?.id === 'string' && m.id)
          .map((m: any) => ({ id: m.id, name: typeof m.name === 'string' && m.name ? m.name : m.id }))
      : [];
    return { endpoint: baseUrl.replace(/\/v1$/, ''), models, configured: true };
  } catch {
    return { endpoint: null, models: [], configured: false };
  }
}

/**
 * Persist the Ollama endpoint, probing the server first. The probe must
 * succeed — an unreachable server throws and nothing is written. (The
 * `/api/pi/ollama` route owns the lenient policy: on probe failure it still
 * records the base URL with an empty model list so the endpoint is
 * remembered; use `writeOllamaOverlay` for that path.)
 */
export async function saveOllamaEndpoint(
  endpoint: string,
  agentDir?: string
): Promise<OllamaOverlayStatus> {
  const models = await probeOllamaModels(endpoint);
  return writeOllamaOverlay(normalizeOllamaEndpoint(endpoint), models, agentDir);
}

/** Write the overlay entry merge-safely (other providers preserved). */
export function writeOllamaOverlay(
  endpoint: string,
  models: OllamaOverlayModels[],
  agentDir?: string
): OllamaOverlayStatus {
  const base = normalizeOllamaEndpoint(endpoint);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join, dirname } = require('path') as typeof import('path');
  const dir = agentDir ?? defaultAgentDir();
  const path = join(dir, 'models.json');
  let doc: any = { providers: {} };
  try {
    if (fs.existsSync(path)) {
      const parsed = JSON.parse(fs.readFileSync(path, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) doc = parsed;
    }
  } catch {
    doc = { providers: {} };
  }
  if (!doc.providers || typeof doc.providers !== 'object' || Array.isArray(doc.providers)) {
    doc.providers = {};
  }
  doc.providers[OLLAMA_PROVIDER_ID] = {
    name: 'Ollama',
    baseUrl: `${base}/v1`,
    api: 'openai-completions',
    models: models.map(({ id, name }) => ({ id, name })),
  };
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(doc, null, 2), 'utf-8');
  return readOllamaOverlay(agentDir);
}

/** Remove the Ollama entry, preserving every other provider. */
export function clearOllamaEndpoint(agentDir?: string): OllamaOverlayStatus {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join, dirname } = require('path') as typeof import('path');
  const dir = agentDir ?? defaultAgentDir();
  const path = join(dir, 'models.json');
  try {
    if (fs.existsSync(path)) {
      const parsed = JSON.parse(fs.readFileSync(path, 'utf-8'));
      if (parsed?.providers && typeof parsed.providers === 'object') {
        delete parsed.providers[OLLAMA_PROVIDER_ID];
        fs.mkdirSync(dirname(path), { recursive: true });
        fs.writeFileSync(path, JSON.stringify(parsed, null, 2), 'utf-8');
      }
    }
  } catch {
    // Clearing is best-effort; the read below reports the truth.
  }
  return readOllamaOverlay(agentDir);
}

/** The persisted server URL, or the local default when never saved. */
export function resolveOllamaEndpoint(agentDir?: string): string {
  return readOllamaOverlay(agentDir).endpoint ?? OLLAMA_DEFAULT_ENDPOINT;
}

/** The persisted provider base URL (`<endpoint>/v1`) for transports. */
export function resolveOllamaBaseUrl(agentDir?: string): string {
  return `${resolveOllamaEndpoint(agentDir)}/v1`;
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = {
  saveOllamaEndpoint,
  writeOllamaOverlay,
  readOllamaOverlay,
  clearOllamaEndpoint,
  resolveOllamaEndpoint,
  probeOllamaModels,
  normalizeOllamaEndpoint,
};
