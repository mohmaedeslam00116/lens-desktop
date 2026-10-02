import { join } from 'path';

/**
 * Pi-owned chat auth + defaults — tracer P2 of the Pi-only backend migration.
 *
 * Pi is the single source of truth for provider credentials (`auth.json`
 * under the LENS-owned agent directory) and for the default provider/model
 * (`settings.json` under the same directory, via Pi's file-backed
 * `SettingsManager`). Nothing here keeps a parallel LENS registry: keys are
 * never held in request envelopes or localStorage after the one-time
 * migration, and defaults are never a LENS-owned constant.
 *
 * - `savePiChatKey`: persiste a chat API key through Pi's native `login`
 *   (`api_key` type, `prompt` supplies the key) so `auth.json` holds
 *   `{ provider: { type: "api_key", key } }`. An empty key logs out
 *   (`logout` deletes the entry). Transient test probes (`testPiProvider`)
 *   never touch this path.
 * - `savePiDefaults` / `getPiDefaults`: persist/read
 *   `defaultProvider`/`defaultModel` through Pi's file-backed
 *   `SettingsManager` — the same store sessions resolve against.
 *
 * Only Pi provider ids are accepted (`google`, never LENS `gemini`).
 * Ollama carries no key: saving a key for it is rejected; its endpoint stays
 * a per-call probe until the P4 `models.json` overlay persists it.
 */

export interface PiAuthSaveResult {
  provider: string;
  configured: boolean;
  source: string | null;
}

export interface PiDefaults {
  provider?: string;
  model?: string;
}

function assertPiProviderId(provider: string): string {
  const id = (provider ?? '').trim();
  if (!id) throw new Error('No provider selected.');
  if (id === 'gemini') {
    throw new Error('Unknown Pi provider "gemini" — the Pi id is "google".');
  }
  return id;
}

export async function savePiChatKey(
  provider: string,
  apiKey: string | undefined,
  agentDir?: string
): Promise<PiAuthSaveResult> {
  const providerId = assertPiProviderId(provider);
  if (providerId === 'ollama') {
    throw new Error('Ollama carries no API key — configure its endpoint instead.');
  }
  const { loadPiRuntime, resolveAgentDir } = await import('./agentSessionHost');
  const pi = await loadPiRuntime();
  const dir = agentDir ?? resolveAgentDir();
  const runtime = await pi.ModelRuntime.create({
    allowModelNetwork: false,
    authPath: join(dir, 'auth.json'),
    modelsPath: join(dir, 'models.json'),
  });

  const key = (apiKey ?? '').trim();
  if (!key) {
    try {
      await runtime.logout(providerId);
    } catch (err: any) {
      // Logging out an unknown/never-configured provider is a benign no-op:
      // the end state (unconfigured) already holds.
      const msg = err?.message ?? String(err);
      if (!/unknown provider|credential store delete failed|no credential/i.test(msg)) throw err;
    }
    return { provider: providerId, configured: false, source: null };
  }

  if (typeof runtime?.login !== 'function') {
    throw new Error('Pi runtime cannot persist credentials.');
  }
  const controller = new AbortController();
  try {
    await runtime.login(providerId, 'api_key', {
      signal: controller.signal,
      prompt: async () => key,
      notify: () => {},
    });
  } finally {
    controller.abort();
  }

  let configured = false;
  let source: string | null = null;
  try {
    const status = typeof runtime?.getProviderAuthStatus === 'function'
      ? runtime.getProviderAuthStatus(providerId)
      : null;
    if (status && typeof status === 'object') {
      configured = status.configured === true;
      source = typeof status.source === 'string' ? status.source : null;
    }
  } catch {
    // Status probe must never break the save; the file holds the truth.
  }
  return { provider: providerId, configured, source };
}

export async function savePiDefaults(
  provider: string | undefined,
  model: string | undefined,
  agentDir?: string
): Promise<PiDefaults> {
  const { loadPiRuntime, resolveAgentDir } = await import('./agentSessionHost');
  const pi = await loadPiRuntime();
  const dir = agentDir ?? resolveAgentDir();
  const cwd = process.cwd();
  const manager = pi.SettingsManager.create(cwd, dir);

  const nextProvider = (provider ?? '').trim();
  const nextModel = (model ?? '').trim();
  if (!nextProvider) throw new Error('No provider selected.');
  const canonical = assertPiProviderId(nextProvider);
  if (nextModel) {
    manager.setDefaultModelAndProvider(canonical, nextModel);
  } else {
    manager.setDefaultProvider(canonical);
  }
  return {
    provider: manager.getDefaultProvider() ?? canonical,
    ...(manager.getDefaultModel() || nextModel ? { model: manager.getDefaultModel() ?? nextModel } : {}),
  };
}

export async function getPiDefaults(agentDir?: string): Promise<PiDefaults> {
  const { loadPiRuntime, resolveAgentDir } = await import('./agentSessionHost');
  const pi = await loadPiRuntime();
  const dir = agentDir ?? resolveAgentDir();
  const manager = pi.SettingsManager.create(process.cwd(), dir);
  const provider = manager.getDefaultProvider();
  const model = manager.getDefaultModel();
  return {
    ...(typeof provider === 'string' && provider ? { provider } : {}),
    ...(typeof model === 'string' && model ? { model } : {}),
  };
}

/** Test seams — the suite imports the compiled engine and probes these. */
export const __testSeams = { savePiChatKey, savePiDefaults, getPiDefaults };
