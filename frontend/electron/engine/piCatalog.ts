import { join } from 'path';

/**
 * Pi catalog reads — tracer P0 of the Pi-only backend migration.
 *
 * The Pi `ModelRuntime` is the single source of truth for providers, models,
 * and auth status. This module exposes read-only snapshots of that truth so
 * the Settings UI can render Pi ids/models/auth instead of LENS-owned
 * provider lists. Nothing here writes: no key material, no registration, no
 * defaults mutation. Ollama arrives through the persisted `models.json`
 * overlay (tracer P4) — every runtime here loads `modelsPath`, so the file
 * entry lists exactly like a built-in.
 *
 * Auth status values come straight from `getProviderAuthStatus`: Pi's own
 * union of stored, runtime, environment, and file-overlaid credentials.
 * `source` is `null` when unconfigured (the runtime omits it) — never a key.
 */

/** One model as Pi catalogs it. */
export interface PiCatalogModel {
  id: string;
  name: string;
}

/** One provider as Pi registers it, with its models and auth standing. */
export interface PiCatalogProvider {
  id: string;
  name: string;
  models: PiCatalogModel[];
  auth: {
    configured: boolean;
    source: string | null;
  };
}

/** The read-only snapshot served on the P0 routes. */
export interface PiCatalogSnapshot {
  providers: PiCatalogProvider[];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Build a read-only snapshot of the Pi provider/model/auth truth under the
 * LENS-owned agent directory (the same directory the construction seam uses,
 * so the listing reflects exactly what sessions resolve against). The runtime
 * loads the persisted `models.json` overlay (tracer P4: Ollama) and is
 * created offline (no catalog network refresh) and discarded — reads only.
 */
export async function getPiCatalogSnapshot(agentDir?: string): Promise<PiCatalogSnapshot> {
  const { loadPiRuntime, resolveAgentDir } = await import('./agentSessionHost');
  const pi = await loadPiRuntime();
  const dir = agentDir ?? resolveAgentDir();
  const runtime = await pi.ModelRuntime.create({
    allowModelNetwork: false,
    authPath: join(dir, 'auth.json'),
    modelsPath: join(dir, 'models.json'),
  });

  const models = asArray<{ provider?: unknown; id?: unknown; name?: unknown }>(
    typeof runtime?.getModels === 'function' ? runtime.getModels() : []
  );
  const byProvider = new Map<string, PiCatalogModel[]>();
  for (const model of models) {
    if (typeof model?.provider !== 'string' || typeof model?.id !== 'string') continue;
    const list = byProvider.get(model.provider) ?? [];
    list.push({ id: model.id, name: typeof model.name === 'string' && model.name ? model.name : model.id });
    byProvider.set(model.provider, list);
  }

  const registered = asArray<{ id?: unknown; name?: unknown }>(
    typeof runtime?.getProviders === 'function' ? runtime.getProviders() : []
  );
  const ids = new Set<string>();
  for (const provider of registered) {
    if (typeof provider?.id === 'string' && provider.id) ids.add(provider.id);
  }
  for (const id of byProvider.keys()) ids.add(id);

  const nameOf = (id: string): string => {
    const entry = registered.find((p) => p.id === id);
    return typeof entry?.name === 'string' && entry.name ? entry.name : id;
  };

  const providers: PiCatalogProvider[] = [...ids].sort().map((id) => {
    let configured = false;
    let source: string | null = null;
    try {
      const status = typeof runtime?.getProviderAuthStatus === 'function' ? runtime.getProviderAuthStatus(id) : null;
      if (status && typeof status === 'object') {
        configured = status.configured === true;
        source = typeof status.source === 'string' ? status.source : null;
      }
    } catch {
      // An auth probe must never break the catalog read; unconfigured stands.
    }
    return { id, name: nameOf(id), models: byProvider.get(id) ?? [], auth: { configured, source } };
  });

  // Ollama arrives through the persisted `models.json` overlay (tracer P4),
  // loaded above via `modelsPath`: a saved entry lists here with its probed
  // models (possibly empty when the server was down at save — honest, never
  // invented). No endpoint offered means no entry at all.
  return { providers };
}

/**
 * Register the local Ollama server as a Pi provider using Pi's native
 * provider mechanism (`registerProvider` with the `openai-completions` API —
 * the same shape Pi's own built-ins use). Ollama is the one LENS-supported
 * provider Pi does not ship, so this closes that gap without any LENS-side
 * provider implementation.
 *
 * Transient by design: persistence lives in the `models.json` overlay
 * (`piOllama.saveOllamaEndpoint`, tracer P4). This seam survives only for the
 * connection test, where an explicitly supplied endpoint arms a throwaway
 * runtime without touching the file.
 */
export async function ensureOllamaProvider(
  runtime: any,
  endpoint: string
): Promise<{ id: string; name: string; models: PiCatalogModel[] }> {
  const { probeOllamaModels, normalizeOllamaEndpoint } = await import('./piOllama');
  const base = normalizeOllamaEndpoint(endpoint);
  const models = await probeOllamaModels(endpoint);
  if (typeof runtime?.registerProvider !== 'function') {
    throw new Error('Pi runtime cannot register providers.');
  }
  runtime.registerProvider('ollama', {
    name: 'Ollama',
    baseUrl: `${base}/v1`,
    api: 'openai-completions',
    models: models.map(({ id, name }) => ({ id, name })),
  });
  return { id: 'ollama', name: 'Ollama', models };
}

/** Connection-test request: Pi ids in, Pi transport throughout. */
export interface PiTestRequest {
  provider: string;
  model?: string;
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
}

export interface PiTestResult {
  success: boolean;
  latency_ms: number;
  model?: string;
  message?: string;
  error?: string;
}

function piTestFail(started: number, error: string): PiTestResult {
  return { success: false, latency_ms: Date.now() - started, error };
}

function textOfAssistantMessage(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('');
  }
  return '';
}

/**
 * Test a provider connection through the Pi runtime itself: the key arms the
 * Pi provider transiently (Ollama: an explicitly supplied endpoint arms a
 * throwaway registration, otherwise the persisted `models.json` overlay
 * serves), the model resolves from the Pi catalog, and a minimal "Say OK"
 * turn runs on Pi transport. Keys are never persisted; an explicit Ollama
 * endpoint never touches the file either. This replaces the native
 * `ModelClient.testConnection` path for chat providers.
 */
export async function testPiProvider(request: PiTestRequest, agentDir?: string): Promise<PiTestResult> {
  const started = Date.now();
  const timeoutMs = typeof request.timeoutMs === 'number' && request.timeoutMs > 0 ? request.timeoutMs : 20000;
  try {
    const { loadPiRuntime, resolveAgentDir } = await import('./agentSessionHost');
    const pi = await loadPiRuntime();
    const dir = agentDir ?? resolveAgentDir();
    const runtime = await pi.ModelRuntime.create({
      allowModelNetwork: false,
      authPath: join(dir, 'auth.json'),
      modelsPath: join(dir, 'models.json'),
    });

    const providerId = (request.provider ?? '').trim();
    if (!providerId) return piTestFail(started, 'No provider selected.');
    if (providerId === 'gemini') {
      return piTestFail(started, 'Unknown Pi provider "gemini" — the Pi id is "google".');
    }
    if (providerId === 'ollama') {
      // P4: an explicitly supplied endpoint arms a throwaway registration
      // (preview without touching the file); otherwise the persisted
      // `models.json` overlay serves — absent both, the honest no-endpoint
      // failure (never invented models, never a guessed server).
      if (request.endpoint?.trim()) {
        await ensureOllamaProvider(runtime, request.endpoint);
      } else {
        const { readOllamaOverlay } = await import('./piOllama');
        const overlay = readOllamaOverlay(dir);
        if (!overlay.configured || overlay.models.length === 0) {
          return piTestFail(
            started,
            'No Ollama endpoint configured. Open Settings → add your Ollama server URL, then retry.'
          );
        }
      }
    } else {
      // P2: a supplied key arms the provider transiently (never persisted);
      // absent a key, the stored Pi credential (if any) drives the probe —
      // so Test proves the saved configuration without re-entering the key.
      const supplied = request.apiKey?.trim();
      if (supplied) {
        if (typeof runtime?.setRuntimeApiKey !== 'function') {
          return piTestFail(started, 'Pi runtime cannot accept keys.');
        }
        runtime.setRuntimeApiKey(providerId, supplied);
      } else if (
        typeof runtime?.hasConfiguredAuth !== 'function' ||
        runtime.hasConfiguredAuth(providerId) !== true
      ) {
        return piTestFail(started, `No API key for "${providerId}". Paste a key, then retry.`);
      }
    }

    const cataloged = asArray<{ provider?: unknown; id?: unknown }>(
      typeof runtime?.getModels === 'function' ? runtime.getModels() : []
    ).filter(
      (m): m is { provider: string; id: string } =>
        m?.provider === providerId && typeof m?.id === 'string'
    );
    if (cataloged.length === 0) {
      return piTestFail(started, `Pi has no models for provider "${providerId}".`);
    }
    const wanted = (request.model ?? '').trim();
    const match = wanted
      ? cataloged.find((m) => m.id === wanted || `${m.provider}/${m.id}` === wanted)
      : undefined;
    const picked = match ?? cataloged[0];
    const model =
      typeof runtime?.getModel === 'function' ? (runtime.getModel(picked.provider, picked.id) ?? picked) : picked;

    const stream = runtime.streamSimple(
      model,
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'Say OK' }] }] },
      {}
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const drain = (async () => {
        for await (const _event of stream) {
          // Discard deltas; the terminal result carries the answer.
        }
        return stream.result();
      })();
      const message = await Promise.race([
        drain,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms.`)), timeoutMs);
        }),
      ]);
      const text = textOfAssistantMessage(message).trim();
      if (!text) return piTestFail(started, 'The provider answered with no text.');
      const latency = Date.now() - started;
      return {
        success: true,
        latency_ms: latency,
        model: `${picked.provider}/${picked.id}`,
        message: `Connected to ${providerId} (${picked.id}) in ${latency}ms.`,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err: any) {
    return piTestFail(started, err?.message ?? String(err));
  }
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = { getPiCatalogSnapshot, ensureOllamaProvider, testPiProvider };
