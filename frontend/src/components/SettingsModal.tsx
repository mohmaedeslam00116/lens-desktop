import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Cpu, 
  Search, 
  HardDrive, 
  Sliders, 
  Check, 
  Eye, 
  EyeOff, 
  ExternalLink, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  ShieldCheck,
  Zap,
  Key,
  RotateCcw,
  Sparkles,
  Layers
} from 'lucide-react';
import { Language, ApiSettings, EmbeddingProvider, ModelOption } from '../types';
import { version as APP_VERSION } from '../../package.json';
import {
  ProviderPills,
  SearchProviderKeyField,
  type CatalogProviderEntry as PiCatalogEntry,
  type CatalogSearchProviderEntry as PiSearchProviderEntry,
} from './SettingsCatalog';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface SettingsModalProps {
  language: Language;
  isOpen: boolean;
  onClose: () => void;
  settings: ApiSettings;
  onSave: (settings: ApiSettings) => void;
  /** Resolved engine base URL from the preload bridge; null when the engine failed to start (no guessed port). */
  apiBase: string | null;
}

/**
 * Known key-console URLs by Pi provider id — a convenience map, NOT a gate
 * (Track A, SPEC #155). Lookup may miss: an unlisted id simply renders no
 * console button. The configured provider set comes from the Pi catalog.
 */
const PROVIDER_CONSOLES: Record<string, string> = {
  google: 'https://aistudio.google.com/app/apikey',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  groq: 'https://console.groq.com/keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  openrouter: 'https://openrouter.ai/keys',
  mistral: 'https://console.mistral.ai/api-keys',
  ollama: 'https://ollama.ai',
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  language,
  isOpen,
  onClose,
  settings,
  onSave,
  apiBase,
}) => {
  const isArabic = language === 'ar';
  const dialogRef = useDialogFocus(isOpen, onClose);
  const [activeTab, setActiveTab] = useState<'models' | 'embeddings' | 'search' | 'local' | 'preferences'>('models');

  const ensureEmbedding = (s: ApiSettings): ApiSettings => {
    if (!s.embedding) {
      const p = s.llm_provider === 'openai' ? 'openai' : s.llm_provider === 'ollama' ? 'ollama' : 'google';
      const m = p === 'google' ? 'text-embedding-004' : p === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text';
      return {
        ...s,
        embedding: {
          enabled: true,
          provider: p,
          model_name: m,
        }
      };
    }
    // P3/P4: scrub legacy plaintext (`api_key`, `use_chat_key`, `endpoint`)
    // and the legacy `gemini` provider id — Pi owns embedding credentials
    // under `google` and the endpoint under the `models.json` overlay.
    const raw = s.embedding as unknown as Record<string, unknown>;
    const cleaned: ApiSettings['embedding'] = {
      enabled: raw.enabled !== false,
      provider: ((raw.provider as string) === 'gemini' ? 'google' : raw.provider) as EmbeddingProvider,
      model_name: typeof raw.model_name === 'string' ? raw.model_name : 'text-embedding-004',
      ...(typeof raw.custom_model_name === 'string' ? { custom_model_name: raw.custom_model_name } : {}),
    };
    return { ...s, embedding: cleaned };
  };

  const [current, setCurrent] = useState<ApiSettings>(() => ensureEmbedding(settings));
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Model discovery & filtering state
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [allowCustomModel, setAllowCustomModel] = useState(false);

  // Pi catalog state (tracer P1): providers, models, and auth standing come
  // from the Pi runtime, never from LENS-owned lists or catalog fetchers.
  // Shapes live in `./SettingsCatalog` (shared with the pure components).
  const [piProviders, setPiProviders] = useState<PiCatalogEntry[]>([]);
  const [isLoadingPi, setIsLoadingPi] = useState(false);
  const [piError, setPiError] = useState('');

  // P2: state speaks Pi ids directly (`google`, never LENS `gemini`) —
  // requests carry Pi ids only and keys never enter `ApiSettings`.
  // Track A (SPEC #155): the provider set is the live Pi catalog
  // (`piProviders` below) — no hardcoded allowlist survives. A catalog id
  // Pi does not know renders no pill; a Pi id without a console URL renders
  // no console button. Nothing here may gate the catalog.

  // Transient key inputs (tracer P2): chat keys live in Pi's `auth.json`,
  // never in `ApiSettings` or localStorage. The inputs hold the key only
  // until Save persists it via `POST /api/pi/auth`, then clear.
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [isSavingPi, setIsSavingPi] = useState(false);
  const [piSaveError, setPiSaveError] = useState('');

  // Persisted Ollama overlay status (tracer P4): the endpoint + probed
  // models from Pi's `models.json` — the file truth Save writes and the
  // catalog, guards, and transports read.
  const [piOllama, setPiOllama] = useState<{ endpoint: string | null; models: { id: string; name: string }[] } | null>(null);

  // Eligible search providers from engine truth (Track A, SPEC #155):
  // `GET /api/pi/search-providers` — rendered verbatim, never hardcoded.
  // Shape lives in `./SettingsCatalog` (shared with the pure components).
  const [piSearchProviders, setPiSearchProviders] = useState<PiSearchProviderEntry[]>([]);

  // Engine identity for the footer (Track A, SPEC #155): the readiness
  // probe names the engine that bound the port — the footer reports app
  // version + engine identity, never a hardcoded string.
  const [engineIdentity, setEngineIdentity] = useState<string | null>(null);

  /** (Re)load the Pi catalog snapshot plus the persisted Ollama overlay. */
  const refreshPiCatalog = async () => {
    if (!apiBase) {
      setPiProviders([]);
      setPiOllama(null);
      setPiSearchProviders([]);
      setEngineIdentity(null);
      setIsLoadingPi(false);
      setPiError('Research engine unavailable.');
      return [];
    }
    setIsLoadingPi(true);
    setPiError('');
    try {
      const [catalogRes, authRes, ollamaRes, searchRes, readyRes] = await Promise.all([
        fetch(`${apiBase}/api/pi/providers`),
        fetch(`${apiBase}/api/pi/auth-status`),
        fetch(`${apiBase}/api/pi/ollama`),
        fetch(`${apiBase}/api/pi/search-providers`),
        fetch(`${apiBase}/`),
      ]);
      if (!catalogRes.ok || !authRes.ok) throw new Error(`Pi catalog answered ${catalogRes.status}/${authRes.status}.`);
      const catalog = await catalogRes.json();
      const auth = await authRes.json();
      const standing = new Map((auth.providers || []).map((e: any) => [e.id, e]));
      const entries: PiCatalogEntry[] = (catalog.providers || [])
        .filter((p: any) => typeof p?.id === 'string')
        .map((p: any) => ({
          id: p.id,
          name: typeof p.name === 'string' && p.name ? p.name : p.id,
          models: Array.isArray(p.models) ? p.models.filter((m: any) => typeof m?.id === 'string') : [],
          auth: (() => {
            const s: any = standing.get(p.id);
            return {
              configured: s?.configured === true,
              source: typeof s?.source === 'string' ? s.source : null,
            };
          })(),
        }));
      setPiProviders(entries);
      try {
        const ready = readyRes.ok ? await readyRes.json() : null;
        setEngineIdentity(
          ready && typeof ready.engine === 'string' && ready.engine ? ready.engine : null
        );
      } catch {
        setEngineIdentity(null);
      }
      try {
        const search = searchRes.ok ? await searchRes.json() : null;
        setPiSearchProviders(
          Array.isArray(search?.providers)
            ? search.providers
                .filter((p: any) => typeof p?.id === 'string')
                .map((p: any) => ({
                  id: p.id,
                  name: typeof p.name === 'string' && p.name ? p.name : p.id,
                  badge: typeof p.badge === 'string' ? p.badge : '',
                  descEn: typeof p.descEn === 'string' ? p.descEn : '',
                  descAr: typeof p.descAr === 'string' ? p.descAr : '',
                  ...(typeof p.keyField === 'string' ? { keyField: p.keyField } : {}),
                }))
            : []
        );
      } catch {
        setPiSearchProviders([]);
      }
      try {
        const ollama = ollamaRes.ok ? await ollamaRes.json() : null;
        setPiOllama(
          ollama && typeof ollama === 'object'
            ? { endpoint: typeof ollama.endpoint === 'string' ? ollama.endpoint : null, models: Array.isArray(ollama.models) ? ollama.models : [] }
            : null
        );
      } catch {
        setPiOllama(null);
      }
      return entries;
    } catch (err: any) {
      setPiProviders([]);
      setPiSearchProviders([]);
      setEngineIdentity(null);
      setPiError(err?.message || 'Pi catalog unavailable.');
      return [];
    } finally {
      setIsLoadingPi(false);
    }
  };

  // Embedding discovery & test state
  const [availableEmbeddingModels, setAvailableEmbeddingModels] = useState<ModelOption[]>([]);
  const [isLoadingEmbeddingModels, setIsLoadingEmbeddingModels] = useState(false);
  const [allowCustomEmbeddingModel, setAllowCustomEmbeddingModel] = useState(false);
  const [isTestingEmbedding, setIsTestingEmbedding] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{
    success: boolean;
    latency_ms?: number;
    dimensions?: number;
    message?: string;
    error?: string;
  } | null>(null);

  // Latency connection testing
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency_ms?: number; message?: string; error?: string } | null>(null);

  // Keep current in sync with props
  useEffect(() => {
    setCurrent(ensureEmbedding(settings));
  }, [settings, isOpen]);

  const activeApiKey = useMemo(() => {
    return (keyInputs[current.llm_provider] || '').trim();
  }, [keyInputs, current.llm_provider]);

  // P3: embedding credentials live in Pi (`auth.json`) under the Pi provider
  // id — the tab holds no key input and sends no key. Standing comes from the
  // Pi catalog snapshot (`piProviders` below) by direct id match.
  const fetchEmbeddingModelsDynamically = async (provider: string) => {
    if (!apiBase) {
      setAvailableEmbeddingModels([]);
      setIsLoadingEmbeddingModels(false);
      return;
    }
    setIsLoadingEmbeddingModels(true);
    try {
      const res = await fetch(`${apiBase}/api/models?type=embedding&provider=${provider}`);
      if (res.ok) {
        const data = await res.json();
        const models: ModelOption[] = data.models || [];
        setAvailableEmbeddingModels(models);
        if (models.length > 0) {
          const modelExists = models.some(m => m.id === current.embedding?.model_name);
          if (!modelExists || !current.embedding?.model_name) {
            const defaultModel = models.find(m => m.recommended) || models[0];
            setCurrent(prev => ({
              ...prev,
              embedding: {
                ...(prev.embedding || { enabled: true, provider: provider as EmbeddingProvider }),
                model_name: defaultModel.id
              }
            }));
          }
        }
      } else {
        setAvailableEmbeddingModels([]);
      }
    } catch {
      setAvailableEmbeddingModels([]);
    } finally {
      setIsLoadingEmbeddingModels(false);
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'embeddings') return;
    const provider = current.embedding?.provider || 'google';
    // Keyless listing (tracer P4): the provider decides the list — cloud
    // providers resolve Pi-stored auth server-side, Ollama probes the
    // persisted Pi endpoint. No endpoint travels the query string.
    fetchEmbeddingModelsDynamically(provider);
    setEmbeddingTestResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.embedding?.provider, isOpen, activeTab]);

  const handleTestEmbeddingConnection = async () => {
    setIsTestingEmbedding(true);
    setEmbeddingTestResult(null);
    if (!apiBase) {
      setEmbeddingTestResult({ success: false, error: isArabic ? 'محرك البحث غير متاح.' : 'Research engine unavailable.' });
      setIsTestingEmbedding(false);
      return;
    }
    try {
      const provider = current.embedding?.provider || 'google';
      const modelName = current.embedding?.custom_model_name || current.embedding?.model_name;
      // Pi ids on the wire; the credential and endpoint resolve from Pi
      // truth server-side — the body carries no keys or endpoints, ever.
      const res = await fetch(`${apiBase}/api/models/test-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model_name: modelName
        })
      });
      const data = await res.json();
      setEmbeddingTestResult(data);
    } catch (err: any) {
      setEmbeddingTestResult({ success: false, error: err.message || 'Connection test failed' });
    } finally {
      setIsTestingEmbedding(false);
    }
  };

  // Chat models come from the Pi catalog snapshot (keyless, offline) — the
  // provider the user picked decides the list, never a per-key fetch.
  // Ollama lists from the persisted Pi overlay (tracer P4).
  useEffect(() => {
    if (!isOpen) return;
    refreshPiCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Derive the model list from the Pi entry; auto-select the first model
  // when the stored one is absent from the Pi catalog (e.g. retired id).
  useEffect(() => {
    const entry = piProviders.find((p) => p.id === current.llm_provider);
    const models: ModelOption[] = (entry?.models || []).map((m) => ({ id: m.id, name: m.name }));
    setAvailableModels(models);
    setIsLoadingModels(false);
    if (models.length > 0) {
      const exists = models.some((m) => m.id === current.model_name);
      if (!exists || !current.model_name) {
        const first = models[0];
        setCurrent((prev) => ({ ...prev, model_name: first.id }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piProviders, current.llm_provider]);

  // Filter models by search query only — Pi catalogs carry no LENS tag
  // metadata (recommended/reasoning/fast pills retired with the old fetcher).
  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return availableModels;
    const q = modelSearch.toLowerCase().trim();
    return availableModels.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [availableModels, modelSearch]);

  if (!isOpen) return null;

  const piEntryFor = (piId: string) => piProviders.find((p) => p.id === piId);
  const currentProviderName = piEntryFor(current.llm_provider)?.name || current.llm_provider;
  // The selected search catalog entry (Track A): drives the generic key
  // input below — a missing entry (or keyless provider) renders no input.
  const selectedSearchProvider =
    piSearchProviders.find((s) => s.id === current.search_provider) ?? null;
  // Narrowed once, as a const, so the keyField stays `string` (never a
  // cast) through the input and the write below.
  const selectedSearchKeyField = selectedSearchProvider?.keyField ?? null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    if (!apiBase) {
      setTestResult({ success: false, error: isArabic ? 'محرك البحث غير متاح.' : 'Research engine unavailable.' });
      setIsTesting(false);
      return;
    }
    try {
      // Pi ids on the wire: the test proves the exact provider+model the
      // runtime will use, on Pi transport. A typed key arms the probe
      // transiently; absent a key, the stored Pi credential drives it — so
      // Test proves the saved configuration too. Ollama resolves the
      // persisted Pi endpoint (tracer P4) — the body carries no endpoint.
      const res = await fetch(`${apiBase}/api/pi/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: current.llm_provider,
          model: current.model_name || undefined,
          apiKey: activeApiKey || undefined,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || 'Connection test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setPiSaveError('');
    if (!apiBase) {
      setPiSaveError(isArabic ? 'محرك البحث غير متاح.' : 'Research engine unavailable.');
      return;
    }
    setIsSavingPi(true);
    // Local (not state): whether the Ollama persist warned — state setters
    // do not re-render synchronously, so the close decision reads this.
    let ollamaWarned = false;
    try {
      // Pi owns chat auth + defaults (tracer P2): the typed key persists via
      // `POST /api/pi/auth` (empty = leave stored), the provider/model via
      // `POST /api/pi/defaults`. `onSave` persists only the slimmed
      // `ApiSettings` (no chat keys, Pi ids).
      const typedKey = activeApiKey;
      if (typedKey && current.llm_provider !== 'ollama') {
        const authRes = await fetch(`${apiBase}/api/pi/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: current.llm_provider, apiKey: typedKey }),
        });
        const authData = await authRes.json().catch(() => ({}));
        if (!authRes.ok || authData.success === false) {
          throw new Error(authData.error || `Pi rejected the ${current.llm_provider} key.`);
        }
      }
      // Pi owns the Ollama endpoint (tracer P4): persist the Local-tab value
      // into the `models.json` overlay. Only when it differs from Pi truth
      // (avoids re-probing an unchanged server); a down server warns without
      // blocking the rest of the save.
      const ollamaEndpoint = (current.ollama_endpoint || '').trim();
      if (ollamaEndpoint && ollamaEndpoint !== (piOllama?.endpoint || '').trim()) {
        try {
          const olRes = await fetch(`${apiBase}/api/pi/ollama`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: ollamaEndpoint }),
          });
          const olData = await olRes.json().catch(() => ({}));
          if (!olRes.ok || olData.success === false) {
            throw new Error(olData.error || 'Pi rejected the Ollama endpoint.');
          }
          if (olData.warning) {
            ollamaWarned = true;
            setPiSaveError(
              isArabic
                ? `تم حفظ الإعدادات، لكن Ollama غير reachable: ${olData.warning}`
                : `Settings saved, but Ollama is unreachable: ${olData.warning}`
            );
          }
        } catch (err: any) {
          // A down/probe-failing server must never block saving everything
          // else — the admission guard reports it bilingually at run time.
          ollamaWarned = true;
          setPiSaveError(
            isArabic
              ? `تم حفظ الإعدادات، لكن تعذر حفظ Ollama: ${err?.message || 'unknown error'}`
              : `Settings saved, but the Ollama endpoint did not persist: ${err?.message || 'unknown error'}`
          );
        }
      }
      const defRes = await fetch(`${apiBase}/api/pi/defaults`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: current.llm_provider,
          model: current.model_name || undefined,
        }),
      });
      const defData = await defRes.json().catch(() => ({}));
      if (!defRes.ok || defData.success === false) {
        throw new Error(defData.error || 'Pi rejected the default provider/model.');
      }
      onSave(current);
      setKeyInputs((prev) => ({ ...prev, [current.llm_provider]: '' }));
      // Settings → web-search.json write-through (ADR-0013 D2/D7, #112): keyed
      // search providers become opt-in via the vendored config the engine reads.
      // Track A (SPEC #155): the forwarded fields derive from the engine
      // search catalog (`keyField`), never from two literals — a fourth
      // keyed provider is typed, rendered, AND saved. When the catalog is
      // unloaded (engine unreachable at open), fall back to the known
      // plane fields so a typed key is never dropped silently. The engine
      // ignores fields its config seam does not know yet (Track C opens it).
      // Fire-and-forget: the local write must not block or fail the settings
      // save; the response carries only a redacted summary — never key material.
      const searchKeyFields =
        piSearchProviders.length > 0
          ? piSearchProviders.flatMap((s) => (s.keyField ? [s.keyField] : []))
          : ['tavily', 'serper'];
      const searchKeys: Record<string, string> = {};
      for (const field of searchKeyFields) {
        searchKeys[field] = current.keys[field] || '';
      }
      fetch(`${apiBase}/api/settings/search-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: searchKeys }),
      }).catch(() => { /* engine unreachable: keys persist in LENS settings only */ });
      setSavedSuccess(true);
      // Refresh Pi truth so pills/standing reflect the save; an Ollama
      // warning keeps the dialog open so it is actually read.
      refreshPiCatalog().catch(() => { /* best-effort */ });
      if (!ollamaWarned) {
        setTimeout(() => {
          setSavedSuccess(false);
          onClose();
        }, 500);
      }
    } catch (err: any) {
      setPiSaveError(err?.message || 'Pi save failed.');
    } finally {
      setIsSavingPi(false);
    }
  };

  const navItems = [
    { id: 'models' as const, label: isArabic ? 'مزودو الذكاء الاصطناعي' : 'AI Models & Providers', icon: Cpu },
    { id: 'embeddings' as const, label: isArabic ? 'نماذج التضمين الدلالي' : 'Embedding Models', icon: Layers },
    { id: 'search' as const, label: isArabic ? 'محرك البحث' : 'Search Engine', icon: Search },
    { id: 'local' as const, label: isArabic ? 'الذكاء الاصطناعي المحلي' : 'Local Ollama', icon: HardDrive },
    { id: 'preferences' as const, label: isArabic ? 'التفضيلات والنظام' : 'Preferences', icon: Sliders },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80  select-none animate-fadeIn">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={isArabic ? "إعدادات LENS" : "LENS settings"} className="settings-dialog w-full max-w-4xl h-[620px] bg-canvas border border-line rounded-xl flex flex-col overflow-hidden">
        
        {/* Main Body (2 Columns) */}
        <div className="settings-body flex-1 flex overflow-hidden">
          
          {/* Left Navigation Column */}
          <div className="settings-navigation w-56 bg-panel border-e border-white/5 p-3.5 flex flex-col justify-between shrink-0">
            <div className="space-y-4">
              <div className="px-3 pt-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                    <Sliders className="w-3.5 h-3.5" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                    {isArabic ? 'إعدادات المنظومة' : 'Studio Settings'}
                  </h3>
                </div>
              </div>

              <div className="settings-navigation-items space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition ${
                        isActive 
                          ? 'bg-panel text-accent border border-white/10 shadow-sm font-semibold' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-panel/50'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'text-accent' : 'text-slate-500'}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-brand-footer p-3 border-t border-white/5 text-[11px] text-slate-500 font-mono flex items-center justify-between">
              <span>LENS</span>
              {/* Track A (SPEC #155): app version + engine identity — never
                  a hardcoded string. The engine name comes from the readiness
                  probe; absent/unreachable renders honestly. */}
              <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-400">
                v{APP_VERSION} · {engineIdentity ?? (isArabic ? 'المحرك غير reachable' : 'engine unreachable')}
              </span>
            </div>
          </div>

          {/* Right Content Area */}
          <div className="settings-content flex-1 flex flex-col bg-canvas overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  {navItems.find(n => n.id === activeTab)?.label}
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {activeTab === 'models' && (isArabic ? 'أدخل مفتاح المزود لسحب كافة النماذج المتاحة من حسابك فورياً وبشكل ديناميكي.' : 'Enter your provider API key to pull all active models directly from your account.')}
                  {activeTab === 'embeddings' && (isArabic ? 'تضمين المتجهات لتقطيع فقرات المصادر المستكشفة وترتيبها دلالياً قبل صياغة التقرير.' : 'Vector embedding models for semantic passage chunking and ranking before synthesis.')}
                  {activeTab === 'search' && (isArabic ? 'محرك البحث المجاني المدمج دون الحاجة لأي مفاتيح أو برامج مساعدة.' : 'Built-in multi-search retriever with instant DuckDuckGo fallback.')}
                  {activeTab === 'local' && (isArabic ? 'ربط نماذج Ollama المحلية على جهازك. بحث الويب يحتاج اتصالًا بالإنترنت.' : 'Connect models running on your device. Web research still requires internet access.')}
                  {activeTab === 'preferences' && (isArabic ? 'معلومات حفظ إعدادات التطبيق على جهازك.' : 'How this app saves settings on your device.')}
                </p>
              </div>

              <button
                onClick={onClose}
                aria-label={isArabic ? "إغلاق الإعدادات" : "Close settings"}
                className="w-8 h-8 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Form Content */}
            <div className="flex-1 p-5 overflow-y-auto space-y-5 text-xs">
              
              {/* TAB 1: AI MODELS & PROVIDERS */}
              {activeTab === 'models' && (
                <div className="space-y-4">
                  {/* Provider Pills — the live Pi catalog (Track A, SPEC #155) */}
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-medium">{isArabic ? 'اختر المزود' : 'Select Provider'}</label>
                    {piError && (
                      <p className="text-[11px] text-rose-400" role="alert">
                        {isArabic ? `تعذر تحميل مزودي Pi: ${piError}` : `Pi catalog unavailable: ${piError}`}
                      </p>
                    )}
                    {/* Provider Pills — the full Pi catalog, named by Pi
                        (Track A, SPEC #155): every catalog entry renders;
                        standing comes from the auth-status snapshot. */}
                    <ProviderPills
                      entries={piProviders}
                      selectedId={current.llm_provider}
                      isArabic={isArabic}
                      onSelect={(id) => {
                        setCurrent((prev) => ({ ...prev, llm_provider: id }));
                        setModelSearch('');
                      }}
                    />
                  </div>

                  {/* API Key Input Box */}
                  {current.llm_provider !== 'ollama' && (
                    <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Key className="w-3.5 h-3.5 text-accent" />
                          <label className="text-slate-200 font-medium">
                            {isArabic ? `مفتاح API الخاص بـ ${currentProviderName}` : `${currentProviderName} API Key`}
                          </label>
                        </div>
                        <div className="flex items-center gap-3">
                          {PROVIDER_CONSOLES[current.llm_provider] && (
                            <button
                              type="button"
                              onClick={() => window.open(PROVIDER_CONSOLES[current.llm_provider], '_blank')}
                              className="text-accent hover:text-accent text-[11px] flex items-center gap-1 transition"
                            >
                              <span>{isArabic ? 'الحصول على مفتاح' : 'Get API Key'}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="text-slate-400 hover:text-slate-200 text-[11px] flex items-center gap-1"
                          >
                            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            <span>{showKey ? (isArabic ? 'إخفاء' : 'Hide') : (isArabic ? 'إظهار' : 'Show')}</span>
                          </button>
                        </div>
                      </div>

                      <div className="relative">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={keyInputs[current.llm_provider] || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setKeyInputs((prev) => ({ ...prev, [current.llm_provider]: val }));
                          }}
                          placeholder={(() => {
                            const standing = piEntryFor(current.llm_provider)?.auth.configured === true;
                            if (standing) {
                              return isArabic
                                ? 'المفتاح محفوظ في Pi — اتركه فارغًا للإبقاء، أو الصق مفتاحًا جديدًا للاستبدال...'
                                : 'Key stored in Pi — leave empty to keep, or paste a new key to replace...';
                            }
                            return isArabic ? 'الصق مفتاح الـ API هنا...' : 'Paste your API key here...';
                          })()}
                          aria-label={isArabic ? 'مفتاح API' : 'API key'}
                          className="w-full bg-canvas border border-white/10 rounded-xl px-3.5 py-2.5 text-slate-200 placeholder:text-muted font-mono text-xs focus:outline-none focus:border-accent/50 transition pr-24 rtl:pr-3.5 rtl:pl-24"
                        />
                        <button
                          type="button"
                          disabled={isLoadingPi}
                          onClick={() => refreshPiCatalog()}
                          className="absolute right-2 rtl:right-auto rtl:left-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-[10px] font-medium text-slate-300 flex items-center gap-1 transition"
                        >
                          <RotateCcw className={`w-3 h-3 ${isLoadingPi ? 'animate-spin text-accent' : ''}`} />
                          <span>{isArabic ? 'تحديث' : 'Refresh'}</span>
                        </button>
                      </div>

                      <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <Key className="w-3 h-3 text-muted shrink-0" />
                        <span>{isArabic ? 'تُحفظ المفاتيح في مخزن Pi الآمن (auth.json)، ولا تغادر جهازك أو تُخزن في الإعدادات.' : 'Keys persist in Pi\u2019s secure store (auth.json) — never in app settings or localStorage.'}</span>
                      </p>
                      {piSaveError && (
                        <p className="text-[11px] text-rose-400" role="alert">{piSaveError}</p>
                      )}
                    </div>
                  )}

                  {/* DYNAMIC MODEL SELECTION AREA */}
                  <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-accent" />
                        <label className="text-slate-200 font-medium">
                          {isArabic ? 'النماذج المتاحة من المزود' : 'Available Models from Provider'}
                        </label>
                      </div>
                      
                      {availableModels.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{availableModels.length} {isArabic ? 'نموذج تم سحبه' : 'models active'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setAllowCustomModel(!allowCustomModel)}
                            className="text-slate-400 hover:text-slate-200 text-[10px] underline underline-offset-2"
                          >
                            {allowCustomModel ? (isArabic ? 'إخفاء التخصيص' : 'Hide custom') : (isArabic ? 'إدخال يدوي' : 'Custom ID')}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Loading State */}
                    {isLoadingModels ? (
                      <div className="py-8 text-center space-y-2 border border-dashed border-white/10 rounded-xl bg-canvas/40">
                        <Loader2 className="w-6 h-6 animate-spin text-accent mx-auto" />
                        <p className="text-xs text-slate-300 font-medium">
                          {isArabic ? `جاري الاتصال بـ ${currentProviderName} وسحب النماذج...` : `Connecting to ${currentProviderName} and pulling models...`}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {isArabic ? 'استكشاف نماذج الحساب وحدود السياق المتاحة' : 'Discovering account models and token limits'}
                        </p>
                      </div>
                    ) : availableModels.length === 0 ? (
                      /* Empty: the Pi entry holds no models (Ollama unreachable/empty,
                         or the catalog failed) — never an invented list. */
                      <div className="py-8 px-4 rounded-xl border border-dashed border-white/10 bg-canvas/40 text-center space-y-3">
                        <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
                          <Key className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-200">
                            {current.llm_provider === 'ollama'
                              ? (isArabic ? 'لا توجد نماذج Ollama محلية مكتشفة' : 'No local Ollama models found')
                              : (isArabic ? 'لا توجد نماذج في كتالوج Pi لهذا المزود' : 'Pi catalog holds no models for this provider')}
                          </h4>
                          <p className="text-[11px] text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                            {current.llm_provider === 'ollama'
                              ? (isArabic ? 'تأكد من تشغيل Ollama على جهازك وسحب النماذج عبر الأمر `ollama run llama3.1`.' : 'Ensure Ollama is running locally and pull models via `ollama run llama3.1`.')
                              : (isArabic
                                  ? `أدخل مفتاح API الخاص بـ ${currentProviderName} أعلاه لتمكين التشغيل — قائمة النماذج تأتي من Pi مباشرة.`
                                  : `Enter your ${currentProviderName} API key above to enable runs — the model list itself comes straight from Pi.`)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* POPULATED MODELS EXPLORER */
                      <div className="space-y-3 animate-fadeIn">
                        {/* Search (Pi catalogs carry no tag metadata) */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              placeholder={isArabic ? 'تصفية وبحث في النماذج (مثال: flash, pro)...' : 'Filter models (e.g. flash, pro)...'}
                              className="w-full bg-canvas border border-white/10 rounded-lg pl-8 pr-3 rtl:pl-3 rtl:pr-8 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-accent/40"
                            />
                            {modelSearch && (
                              <button
                                onClick={() => setModelSearch('')}
                                className="absolute right-2 rtl:right-auto rtl:left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Models Grid Cards */}
                        <div className="max-h-60 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
                          {filteredModels.length === 0 ? (
                            <div className="py-6 text-center text-slate-500 text-xs">
                              {isArabic ? 'لا توجد نماذج مطابقة للبحث' : 'No models match your search'}
                            </div>
                          ) : (
                            filteredModels.map((m) => {
                              const isSelected = current.model_name === m.id;
                              return (
                                <div
                                  key={m.id}
                                  onClick={() => setCurrent({ ...current, model_name: m.id })}
                                  className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                                    isSelected
                                      ? 'bg-accent/10 border-accent/60  ring-1 ring-accent/30'
                                      : 'bg-canvas border-white/5 hover:border-white/20 hover:bg-hover/60'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                                          {m.name}
                                        </span>
                                        {m.recommended && (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/10 border border-amber-500/20 text-amber-300 shrink-0">
                                            ★ Flagship
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[10px] font-mono text-slate-400 truncate mt-0.5">{m.id}</p>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 shrink-0">
                                      {m.context && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-white/5 border border-white/10 text-slate-300">
                                          {m.context}
                                        </span>
                                      )}
                                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                                        isSelected ? 'border-accent bg-accent text-black' : 'border-slate-600'
                                      }`}>
                                        {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                      </div>
                                    </div>
                                  </div>

                                  {m.tags && m.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-white/[0.04]">
                                      {m.tags.map(t => (
                                        <span key={t} className="px-1.5 py-0.2 rounded text-[9px] bg-white/[0.03] text-slate-400">
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Optional Custom Model Input */}
                        {allowCustomModel && (
                          <div className="p-3 rounded-xl bg-canvas border border-white/10 space-y-1.5">
                            <label className="text-[11px] text-slate-300 font-medium">
                              {isArabic ? 'معرف نموذج يدوي (Custom Model ID)' : 'Manual Custom Model ID'}
                            </label>
                            <input
                              type="text"
                              value={current.model_name || ''}
                              onChange={(e) => setCurrent({ ...current, model_name: e.target.value })}
                              placeholder="e.g. gemini-2.0-flash, gpt-4o, claude-3-7-sonnet"
                              className="w-full bg-surface border border-white/10 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-accent/50"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Diagnostic Connection Test Button */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface border border-white/5">
                    <div>
                      <p className="text-xs font-semibold text-slate-200">
                        {isArabic ? 'فحص جاهزية الاتصال وزمن الاستجابة' : 'Test Provider Latency & Access'}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {isArabic ? 'فحص صحة المفتاح وسرعة الرد بالمللي ثانية' : 'Verifies credentials and measures response latency in ms'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {testResult && (
                        <div className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 ${
                          testResult.success ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                          <span className="font-mono text-[11px]">
                            {testResult.success ? `${testResult.latency_ms}ms (OK)` : (isArabic ? 'فشل' : 'Failed')}
                          </span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={isTesting || (current.llm_provider !== 'ollama' && !activeApiKey && piEntryFor(current.llm_provider)?.auth.configured !== true)}
                        className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 disabled:opacity-30 flex items-center gap-1.5 transition"
                      >
                        {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                        <span>{isTesting ? (isArabic ? 'جاري الفحص...' : 'Pinging...') : (isArabic ? 'اختبار الاتصال' : 'Test Connection')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: EMBEDDING MODELS */}
              {activeTab === 'embeddings' && (
                <div className="space-y-4 animate-fadeIn">
                  {/* Master Toggle */}
                  <div className="p-4 rounded-xl bg-surface border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-slate-200">
                          {isArabic ? 'تفعيل الاسترجاع الدلالي (Vector Embeddings)' : 'Enable Semantic Vector Retrieval'}
                        </h4>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                          current.embedding?.enabled !== false
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                        }`}>
                          {current.embedding?.enabled !== false ? (isArabic ? 'مفعّل' : 'Active') : (isArabic ? 'معطّل' : 'Disabled')}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 max-w-xl">
                        {isArabic
                          ? 'يقوم الوكيل بتقطيع صفحات الويب المستكشفة إلى مقاطع، واستخراج وتنسيق أكثرها مطابقة دلالياً لسؤال البحث مع المحافظة على الاستشهادات المرقمة [1] [2].'
                          : 'Chunks discovered web pages and ranks passages by cosine vector similarity against your research topic, providing focused evidence to final synthesis.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setCurrent(prev => ({
                        ...prev,
                        embedding: {
                          ...(prev.embedding || { provider: 'google' as EmbeddingProvider, model_name: 'text-embedding-004' }),
                          enabled: prev.embedding?.enabled === false ? true : false
                        }
                      }))}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        current.embedding?.enabled !== false ? 'bg-accent' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          current.embedding?.enabled !== false ? (isArabic ? '-translate-x-4' : 'translate-x-4') : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Provider Pills */}
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-medium">
                      {isArabic ? 'مزود نموذج التضمين' : 'Embedding Provider'}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { id: 'google', name: 'Google', desc: 'text-embedding-004 (768 dims)', tag: 'Recommended' },
                        { id: 'openai', name: 'OpenAI', desc: 'text-embedding-3-small (1536 dims)', tag: 'Cloud' },
                        { id: 'ollama', name: 'Ollama (Local)', desc: 'nomic-embed-text (Local)', tag: 'Private' },
                      ].map((p) => {
                        const isSelected = (current.embedding?.provider || 'google') === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              const defaultModel = p.id === 'google' ? 'text-embedding-004' : p.id === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text';
                              setCurrent(prev => ({
                                ...prev,
                                embedding: {
                                  ...(prev.embedding || { enabled: true }),
                                  provider: p.id as EmbeddingProvider,
                                  model_name: defaultModel,
                                }
                              }));
                            }}
                            className={`p-3 rounded-xl border text-start transition flex flex-col justify-between ${
                              isSelected
                                ? 'bg-accent/10 border-accent/60 text-white shadow-sm'
                                : 'bg-surface border-white/5 text-slate-300 hover:bg-hover'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold">{p.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono">{p.tag}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">{p.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Pi Auth Standing / Endpoint Configuration (tracer P4):
                      cloud embedding credentials live in Pi (`auth.json`) under
                      the Pi provider id — the same key the chat tab saves — and
                      the Ollama endpoint lives in Pi's `models.json` overlay,
                      edited once under the Local tab. No key or endpoint input
                      here, ever. */}
                  <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-medium">
                        {isArabic ? 'إعداد المصادقة ونقطة الاتصال' : 'Authentication & Connection'}
                      </label>
                    </div>

                    {current.embedding?.provider === 'ollama' ? (
                      <div className="p-2.5 rounded-lg bg-canvas/60 border border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>
                            {piOllama?.endpoint
                              ? (isArabic
                                  ? `يستخدم التضمين خادم Pi ‏${piOllama.endpoint}‏ — يُحرر من تبويب Ollama المحلي.`
                                  : `Embeddings use the Pi server ${piOllama.endpoint} — edited under Local Ollama.`)
                              : (isArabic
                                  ? 'لم يُحفظ خادم Ollama في Pi بعد — أضفه من تبويب Ollama المحلي.'
                                  : 'No Ollama server saved in Pi yet — add it under Local Ollama.')}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-canvas/60 border border-white/5 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>
                            {(() => {
                              const standing = piProviders.find((p) => p.id === (current.embedding?.provider || 'google'))?.auth;
                              if (standing?.configured) {
                                return isArabic
                                  ? `مفتاح Pi لـ ${current.embedding?.provider} جاهز${standing.source ? ` (${standing.source})` : ''} — يُستخدم للتضمين أيضًا.`
                                  : `Pi key for ${current.embedding?.provider} is ready${standing.source ? ` (${standing.source})` : ''} — shared with embeddings.`;
                              }
                              return isArabic
                                ? `لا يوجد مفتاح Pi لـ ${current.embedding?.provider} — أضفه من تبويب النماذج والمزودات.`
                                : `No Pi key for ${current.embedding?.provider} — add it under AI Models & Providers.`;
                            })()}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Model Selection & Discovery */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-slate-300 font-medium">
                          {isArabic ? 'نموذج التضمين المتجهي' : 'Vector Embedding Model'}
                        </label>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {isArabic
                            ? 'نماذج التضمين الدلالي المكتشفة من حسابك (مستبعد منها نماذج الدردشة تلقائياً).'
                            : 'Discovered embedding models from provider catalog (chat models strictly excluded).'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const p = current.embedding?.provider || 'google';
                            fetchEmbeddingModelsDynamically(p);
                          }}
                          disabled={isLoadingEmbeddingModels}
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-accent text-[11px] flex items-center gap-1 border border-white/10 transition"
                        >
                          {isLoadingEmbeddingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          <span>{isArabic ? 'فحص النماذج' : 'Scan Models'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setAllowCustomEmbeddingModel(prev => !prev)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 text-[11px] border border-white/10"
                        >
                          {allowCustomEmbeddingModel ? (isArabic ? 'القائمة' : 'Catalog') : (isArabic ? 'تخصيص' : 'Custom')}
                        </button>
                      </div>
                    </div>

                    {allowCustomEmbeddingModel ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={current.embedding?.custom_model_name || ''}
                          onChange={(e) => setCurrent(prev => ({
                            ...prev,
                            embedding: {
                              ...(prev.embedding || { enabled: true, provider: 'google', model_name: 'text-embedding-004' }),
                              custom_model_name: e.target.value
                            }
                          }))}
                          placeholder={current.embedding?.provider === 'google' ? 'text-embedding-004' : current.embedding?.provider === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text'}
                          className="w-full bg-surface border border-white/10 rounded-xl px-3.5 py-2.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-accent/50"
                        />
                        <span className="text-[10px] text-slate-500">
                          {isArabic ? 'أدخل اسم أي نموذج تضمين يدعمه المزود مباشرة.' : 'Enter exact model identifier supported by the provider.'}
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(availableEmbeddingModels.length > 0
                          ? availableEmbeddingModels
                          : ((current.embedding?.provider || 'google') === 'google'
                            ? [{ id: 'text-embedding-004', name: 'text-embedding-004', context: '768 dimensions', recommended: true }]
                            : current.embedding?.provider === 'openai'
                            ? [{ id: 'text-embedding-3-small', name: 'text-embedding-3-small', context: '1536 dimensions', recommended: true }, { id: 'text-embedding-3-large', name: 'text-embedding-3-large', context: '3072 dimensions' }]
                            : [{ id: 'nomic-embed-text', name: 'nomic-embed-text:latest', context: '768 dimensions', recommended: true }, { id: 'mxbai-embed-large', name: 'mxbai-embed-large:latest', context: '1024 dimensions' }])
                        ).map((m) => {
                          const isSelected = (current.embedding?.model_name || '') === m.id;
                          return (
                            <div
                              key={m.id}
                              onClick={() => setCurrent(prev => ({
                                ...prev,
                                embedding: {
                                  ...(prev.embedding || { enabled: true, provider: 'google' }),
                                  model_name: m.id,
                                  custom_model_name: undefined
                                }
                              }))}
                              className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                                isSelected
                                  ? 'bg-accent/10 border-accent/60 text-white shadow-sm'
                                  : 'bg-surface border-white/5 text-slate-300 hover:bg-hover'
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-mono font-medium">{m.name}</span>
                                  {m.recommended && (
                                    <span className="text-[9px] px-1 py-0.2 rounded bg-accent/20 text-accent font-sans">
                                      {isArabic ? 'موصى به' : 'Recommended'}
                                    </span>
                                  )}
                                </div>
                                {m.context && <span className="text-[10px] text-slate-500 font-mono">{m.context}</span>}
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Connection Test Box */}
                  <div className="p-3.5 rounded-xl bg-surface border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {embeddingTestResult ? (
                        embeddingTestResult.success ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-rose-400" />
                        )
                      ) : (
                        <Zap className="w-4 h-4 text-slate-500" />
                      )}
                      <div>
                        <span className="text-xs text-slate-300 block">
                          {embeddingTestResult
                            ? (embeddingTestResult.success
                              ? `${isArabic ? 'نجح الاتصال بنموذج التضمين' : 'Connected to embedding model'}${embeddingTestResult.dimensions ? ` (${embeddingTestResult.dimensions} dims)` : ''} — ${embeddingTestResult.latency_ms}ms`
                              : (embeddingTestResult.error || (isArabic ? 'فشل الاتصال' : 'Connection failed')))
                            : (isArabic ? 'التحقق من جاهزية نموذج التضمين وأبعاد المتجهات' : 'Verify embedding model readiness and vector dimensions')}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleTestEmbeddingConnection}
                      disabled={isTestingEmbedding}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 disabled:opacity-30 flex items-center gap-1.5 transition text-xs"
                    >
                      {isTestingEmbedding ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                      <span>{isTestingEmbedding ? (isArabic ? 'جاري الفحص...' : 'Testing...') : (isArabic ? 'اختبار نموذج التضمين' : 'Test Embeddings')}</span>
                    </button>
                  </div>

                  {/* Reference & Architecture Policy Card */}
                  <div className="p-3.5 rounded-xl bg-canvas/40 border border-white/5 text-[11px] text-slate-400 space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      <span>{isArabic ? 'سياسة المزودات والاسترجاع الدلالي' : 'Adapter Support & Architecture Notes'}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400 text-[10px] leading-relaxed">
                      <li>{isArabic ? 'المزودات المدعومة: Google Gemini (text-embedding-004)، OpenAI (text-embedding-3)، Ollama محلياً.' : 'Supported: Google Gemini (text-embedding-004), OpenAI (text-embedding-3), Local Ollama.'}</li>
                      <li>{isArabic ? 'المزودات المستبعدة: Anthropic و Groq لا توفران نقطة تضمين متجهات في واجهتهما البرمجية.' : 'Omitted: Anthropic and Groq APIs do not provide embedding endpoints.'}</li>
                      <li>{isArabic ? 'محول Transformers محلياً تم استبعاده لتجنب تحميل أوزان ضخمة بعدة غيغابايتات دون حاجة.' : 'Omitted: Local Transformers pipeline avoided to prevent mandatory multi-GB weight downloads.'}</li>
                      <li>{isArabic ? 'الرجوع التلقائي: في حال انقطاع الاتصال أو تجاوز المهلة، يستمر البحث عبر الاستخراج القياسي دون توقف.' : 'Graceful Fallback: If embeddings timeout or fail, the research agent seamlessly falls back to standard excerpts.'}</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* TAB 2: SEARCH ENGINE */}
              {activeTab === 'search' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-slate-300 font-medium">{isArabic ? 'محرك البحث النشط' : 'Search Retriever'}</label>
                    {/* Search providers are engine truth (Track A, SPEC #155):
                        `GET /api/pi/search-providers`, rendered verbatim.
                        An empty catalog with a live engine is an honest
                        error state, never a silent empty tab. */}
                    {apiBase && piSearchProviders.length === 0 && !isLoadingPi && (
                      <p className="text-[11px] text-rose-400" role="alert">
                        {isArabic ? 'تعذر تحميل كتالوج البحث من المحرك.' : 'Search catalog unavailable from the engine.'}
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {piSearchProviders.map((s) => {
                        const isSelected = current.search_provider === s.id;
                        return (
                          <div
                            key={s.id}
                            onClick={() => setCurrent({ ...current, search_provider: s.id })}
                            className={`p-3.5 rounded-xl border cursor-pointer transition ${
                              isSelected
                                ? 'bg-accent/10 border-accent/60 text-white shadow-sm'
                                : 'bg-surface border-white/5 text-slate-300 hover:bg-hover'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold">{s.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono">{s.badge}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-relaxed">{isArabic ? s.descAr : s.descEn}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {selectedSearchProvider && selectedSearchKeyField && (
                    <SearchProviderKeyField
                      entry={selectedSearchProvider}
                      value={current.keys[selectedSearchKeyField] || ''}
                      isArabic={isArabic}
                      onChange={(value) =>
                        setCurrent((prev) => ({
                          ...prev,
                          keys: { ...prev.keys, [selectedSearchKeyField]: value },
                        }))
                      }
                    />
                  )}

                  {/* Research pipeline (ADR-0010 closure): the agency path is
                      the standard research path; the legacy escape hatch was
                      removed after its soak waiver (ticket #104). */}
                </div>
              )}

              {/* TAB 3: LOCAL OLLAMA */}
              {activeTab === 'local' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{isArabic ? 'خادم Ollama المحلي' : 'Local Ollama Server'}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {isArabic ? 'استخدم نموذجًا محليًا عبر Ollama. البحث في مصادر الويب يحتاج اتصالًا بالإنترنت.' : 'Use a local model through Ollama. Searching web sources requires an internet connection.'}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-slate-400 font-medium">{isArabic ? 'عنوان الخادم (Endpoint)' : 'Server Endpoint'}</label>
                      <input
                        type="text"
                        value={current.ollama_endpoint || 'http://localhost:11434'}
                        onChange={(e) => setCurrent({ ...current, ollama_endpoint: e.target.value })}
                        className="w-full bg-canvas border border-white/10 rounded-xl px-3.5 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-accent/50"
                      />
                      <p className="text-[10px] text-slate-500">
                        {isArabic ? 'يُحفظ العنوان في Pi عند الحفظ — تشغيل المحادثات والتضمين يقرآنه من هناك.' : 'The endpoint persists into Pi on Save — chat and embeddings both read it from there.'}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-canvas border border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${piOllama?.endpoint ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
                        <span className="text-[11px] text-slate-300 font-mono">
                          {piOllama?.endpoint
                            ? `${piOllama.endpoint} (${piOllama.models.length} ${isArabic ? 'نموذج' : 'models'})`
                            : (isArabic ? 'لم يُحفظ في Pi بعد' : 'Not yet saved in Pi')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => refreshPiCatalog()}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-accent text-[11px] flex items-center gap-1"
                      >
                        <RotateCcw className={`w-3 h-3 ${isLoadingPi ? 'animate-spin' : ''}`} />
                        <span>{isArabic ? 'فحص النماذج المحلية' : 'Scan Models'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: PREFERENCES */}
              {activeTab === 'preferences' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-3">
                    <h4 className="text-xs font-bold text-slate-200">{isArabic ? 'التخزين المحلي' : 'Local storage'}</h4>
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <p className="text-xs font-medium text-slate-200">{isArabic ? 'الإعدادات ومفاتيح API' : 'Settings and API keys'}</p>
                        <p className="text-[11px] text-slate-400">{isArabic ? 'تستخدم الواجهة التخزين المحلي لحفظ إعداداتك. تشفير المفاتيح غير مفعّل في هذا المسار.' : 'The interface saves settings in local storage. Key encryption is not enabled in this storage path.'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-white/5 bg-canvas flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                {current.model_name && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 font-mono text-[10px] text-slate-300">
                    <Sparkles className="w-3 h-3 text-accent" />
                    <span>{current.model_name}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 transition"
                >
                  {isArabic ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSavingPi}
                  className="primary-button disabled:opacity-50"
                >
                  {savedSuccess ? <Check className="w-3.5 h-3.5" /> : null}
                  <span>{savedSuccess ? (isArabic ? 'تم الحفظ!' : 'Saved!') : (isArabic ? 'حفظ الإعدادات' : 'Save Settings')}</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

