import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { Language, ApiSettings, LLMProvider, ModelOption } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';

const API_BASE = 'http://127.0.0.1:8000';

interface SettingsModalProps {
  language: Language;
  isOpen: boolean;
  onClose: () => void;
  settings: ApiSettings;
  onSave: (settings: ApiSettings) => void;
}

const PROVIDER_CONSOLES: Record<string, string> = {
  gemini: 'https://aistudio.google.com/app/apikey',
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
}) => {
  const isArabic = language === 'ar';
  const dialogRef = useDialogFocus(isOpen, onClose);
  const [activeTab, setActiveTab] = useState<'models' | 'search' | 'local' | 'preferences'>('models');
  const [current, setCurrent] = useState<ApiSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Model discovery & filtering state
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<'all' | 'recommended' | 'reasoning' | 'fast'>('all');
  const [allowCustomModel, setAllowCustomModel] = useState(false);

  // Latency connection testing
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latency_ms?: number; message?: string; error?: string } | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Keep current in sync with props
  useEffect(() => {
    setCurrent(settings);
  }, [settings, isOpen]);

  const activeApiKey = useMemo(() => {
    return (current.keys[current.llm_provider as keyof ApiSettings['keys']] || '').trim();
  }, [current.keys, current.llm_provider]);

  // Function to fetch models dynamically
  const fetchModelsDynamically = async (provider: string, apiKey: string, endpoint: string) => {
    // If not Ollama and no key is provided, models must be strictly empty!
    if (provider !== 'ollama' && !apiKey) {
      setAvailableModels([]);
      setIsLoadingModels(false);
      return;
    }

    setIsLoadingModels(true);
    try {
      const epParam = encodeURIComponent(endpoint || 'http://localhost:11434');
      const keyParam = encodeURIComponent(apiKey);
      const res = await fetch(`${API_BASE}/api/models?provider=${provider}&endpoint=${epParam}&api_key=${keyParam}`);
      if (res.ok) {
        const data = await res.json();
        const models: ModelOption[] = data.models || [];
        setAvailableModels(models);

        // Auto-select first recommended model if current model_name is empty or not in list
        if (models.length > 0) {
          const modelExists = models.some(m => m.id === current.model_name);
          if (!modelExists || !current.model_name) {
            const defaultModel = models.find(m => m.recommended) || models[0];
            setCurrent(prev => ({ ...prev, model_name: defaultModel.id }));
          }
        }
      } else {
        setAvailableModels([]);
      }
    } catch (err) {
      console.warn('Failed to fetch models dynamically:', err);
      setAvailableModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Trigger dynamic model fetch on provider change or when user edits the API key
  useEffect(() => {
    if (!isOpen) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (current.llm_provider === 'ollama') {
      fetchModelsDynamically('ollama', '', current.ollama_endpoint);
    } else if (activeApiKey) {
      // Debounce slightly to avoid firing on every keystroke
      debounceTimerRef.current = setTimeout(() => {
        fetchModelsDynamically(current.llm_provider, activeApiKey, current.ollama_endpoint);
      }, 500);
    } else {
      // Strictly empty when no key is entered
      setAvailableModels([]);
      setIsLoadingModels(false);
    }

    setTestResult(null);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [current.llm_provider, activeApiKey, current.ollama_endpoint, isOpen]);

  // Filter models based on search query and category tags
  const filteredModels = useMemo(() => {
    let list = availableModels;

    if (selectedTag === 'recommended') {
      list = list.filter(m => m.recommended);
    } else if (selectedTag === 'reasoning') {
      list = list.filter(m => 
        m.id.includes('r1') || m.id.includes('o1') || m.id.includes('o3') || 
        m.id.includes('thinking') || m.id.includes('reasoner') ||
        m.tags?.some(t => t.toLowerCase().includes('reasoning'))
      );
    } else if (selectedTag === 'fast') {
      list = list.filter(m => 
        m.id.includes('flash') || m.id.includes('mini') || m.id.includes('instant') ||
        m.tags?.some(t => t.toLowerCase().includes('speed') || t.toLowerCase().includes('fast'))
      );
    }

    if (!modelSearch.trim()) return list;

    const q = modelSearch.toLowerCase().trim();
    return list.filter(m => 
      m.id.toLowerCase().includes(q) || 
      m.name.toLowerCase().includes(q) ||
      m.tags?.some(t => t.toLowerCase().includes(q))
    );
  }, [availableModels, modelSearch, selectedTag]);

  if (!isOpen) return null;

  const providers: { id: LLMProvider; name: string; tag: string }[] = [
    { id: 'gemini', name: 'Google Gemini', tag: 'Recommended' },
    { id: 'openai', name: 'OpenAI', tag: 'GPT-4o / o3' },
    { id: 'anthropic', name: 'Anthropic Claude', tag: '3.7 Sonnet' },
    { id: 'groq', name: 'Groq LPU', tag: 'Ultra-Fast' },
    { id: 'deepseek', name: 'DeepSeek', tag: 'V3 / R1' },
    { id: 'openrouter', name: 'OpenRouter', tag: 'Dynamic Catalog' },
    { id: 'mistral', name: 'Mistral AI', tag: 'Europe' },
    { id: 'ollama', name: 'Ollama', tag: 'Local Offline' },
  ];

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/models/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: current.llm_provider,
          api_key: activeApiKey,
          endpoint: current.ollama_endpoint,
          model_name: current.model_name
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

  const handleSave = () => {
    onSave(current);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 500);
  };

  const navItems = [
    { id: 'models' as const, label: isArabic ? 'مزودو الذكاء الاصطناعي' : 'AI Models & Providers', icon: Cpu },
    { id: 'search' as const, label: isArabic ? 'محرك البحث' : 'Search Engine', icon: Search },
    { id: 'local' as const, label: isArabic ? 'الذكاء الاصطناعي المحلي' : 'Local Ollama', icon: HardDrive },
    { id: 'preferences' as const, label: isArabic ? 'التفضيلات والنظام' : 'Preferences', icon: Sliders },
  ];

  const currentProviderName = providers.find(p => p.id === current.llm_provider)?.name || current.llm_provider;

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
              <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-400">v1.0.0</span>
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
                  {/* Provider Pills */}
                  <div className="space-y-1.5">
                    <label className="text-slate-300 font-medium">{isArabic ? 'اختر المزود' : 'Select Provider'}</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {providers.map((p) => {
                        const isSelected = current.llm_provider === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setCurrent(prev => ({ ...prev, llm_provider: p.id }));
                              setAvailableModels([]);
                              setModelSearch('');
                            }}
                            className={`p-2.5 rounded-xl border text-left rtl:text-right transition ${
                              isSelected 
                                ? 'bg-accent/10 border-accent/60 text-white font-medium ' 
                                : 'bg-surface border-white/5 text-slate-300 hover:bg-hover'
                            }`}
                          >
                            <p className="text-xs truncate font-medium">{p.name}</p>
                            <p className="text-[10px] text-slate-500 truncate mt-0.5">{p.tag}</p>
                          </button>
                        );
                      })}
                    </div>
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
                          value={current.keys[current.llm_provider as keyof ApiSettings['keys']] || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCurrent(prev => ({
                              ...prev,
                              keys: { ...prev.keys, [current.llm_provider]: val }
                            }));
                          }}
                          placeholder={isArabic ? 'الصق مفتاح الـ API هنا لسحب النماذج تلقائياً...' : 'Paste your API key here to pull all models automatically...'}
                          aria-label={isArabic ? 'مفتاح API' : 'API key'}
                          className="w-full bg-canvas border border-white/10 rounded-xl px-3.5 py-2.5 text-slate-200 placeholder:text-muted font-mono text-xs focus:outline-none focus:border-accent/50 transition pr-24 rtl:pr-3.5 rtl:pl-24"
                        />
                        <button
                          type="button"
                          disabled={!activeApiKey || isLoadingModels}
                          onClick={() => fetchModelsDynamically(current.llm_provider, activeApiKey, current.ollama_endpoint)}
                          className="absolute right-2 rtl:right-auto rtl:left-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-[10px] font-medium text-slate-300 flex items-center gap-1 transition"
                        >
                          <RotateCcw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin text-accent' : ''}`} />
                          <span>{isArabic ? 'تحديث' : 'Refresh'}</span>
                        </button>
                      </div>

                      <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <Key className="w-3 h-3 text-muted shrink-0" />
                        <span>{isArabic ? 'تُحفظ المفاتيح محليًا في إعدادات التطبيق، ويستخدمها محرك البحث للاتصال بالمزود المختار.' : 'Keys are saved locally in app settings and used by the research engine to connect to your selected provider.'}</span>
                      </p>
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
                      /* STRICT EMPTY STATE (As requested: empty by default until key is placed) */
                      <div className="py-8 px-4 rounded-xl border border-dashed border-white/10 bg-canvas/40 text-center space-y-3">
                        <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
                          <Key className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-200">
                            {current.llm_provider === 'ollama' 
                              ? (isArabic ? 'لا توجد نماذج Ollama محلية مكتشفة' : 'No local Ollama models found')
                              : (isArabic ? 'بانتظار إدخال مفتاح الـ API' : 'Awaiting API Key')}
                          </h4>
                          <p className="text-[11px] text-slate-400 max-w-md mx-auto mt-1 leading-relaxed">
                            {current.llm_provider === 'ollama'
                              ? (isArabic ? 'تأكد من تشغيل Ollama على جهازك وسحب النماذج عبر الأمر `ollama run llama3.1`.' : 'Ensure Ollama is running locally and pull models via `ollama run llama3.1`.')
                              : (isArabic 
                                  ? `أدخل مفتاح API الخاص بـ ${currentProviderName} أعلاه لسحب قائمة النماذج المتاحة فورياً من حسابك.` 
                                  : `Enter your ${currentProviderName} API key above to instantly pull all supported models from your account.`)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* POPULATED MODELS EXPLORER */
                      <div className="space-y-3 animate-fadeIn">
                        {/* Search & Category Filter */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              placeholder={isArabic ? 'تصفية وبحث في النماذج (مثال: flash, r1, mini)...' : 'Filter models (e.g. flash, r1, mini)...'}
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

                          {/* Filter Chips */}
                          <div className="flex items-center gap-1 shrink-0">
                            {[
                              { id: 'all' as const, label: isArabic ? 'الكل' : 'All' },
                              { id: 'recommended' as const, label: '⭐' },
                              { id: 'reasoning' as const, label: '🧠' },
                              { id: 'fast' as const, label: '⚡' },
                            ].map(chip => (
                              <button
                                key={chip.id}
                                type="button"
                                onClick={() => setSelectedTag(chip.id)}
                                className={`px-2 py-1 rounded-md text-[10px] font-medium border transition ${
                                  selectedTag === chip.id
                                    ? 'bg-accent/20 border-accent/50 text-accent'
                                    : 'bg-canvas border-white/5 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {chip.label}
                              </button>
                            ))}
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
                        disabled={isTesting || (!activeApiKey && current.llm_provider !== 'ollama')}
                        className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 disabled:opacity-30 flex items-center gap-1.5 transition"
                      >
                        {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                        <span>{isTesting ? (isArabic ? 'جاري الفحص...' : 'Pinging...') : (isArabic ? 'اختبار الاتصال' : 'Test Connection')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SEARCH ENGINE */}
              {activeTab === 'search' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-slate-300 font-medium">{isArabic ? 'محرك البحث النشط' : 'Search Retriever'}</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[
                        { id: 'duckduckgo', name: 'DuckDuckGo', desc: isArabic ? 'مجاني ومدمج 100% بدون أي إعداد أو مفاتيح' : 'Free & built-in, zero setup required', badge: 'Default' },
                        { id: 'tavily', name: 'Tavily Search', desc: isArabic ? 'محرك بحث متقدم مصمم لوكلاء الذكاء الاصطناعي' : 'Autonomous AI agent search API', badge: 'BYOK' },
                        { id: 'serper', name: 'Google (Serper)', desc: isArabic ? 'فهرس نتائج Google الكامل' : 'Full Google organic index', badge: 'BYOK' },
                      ].map((s) => {
                        const isSelected = current.search_provider === s.id;
                        return (
                          <div
                            key={s.id}
                            onClick={() => setCurrent({ ...current, search_provider: s.id as any })}
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
                            <p className="text-[10px] text-slate-400 leading-relaxed">{s.desc}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {current.search_provider === 'tavily' && (
                    <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-2">
                      <label className="text-slate-300 font-medium">Tavily API Key</label>
                      <input
                        type="password"
                        value={current.keys.tavily || ''}
                        onChange={(e) => setCurrent(prev => ({ ...prev, keys: { ...prev.keys, tavily: e.target.value } }))}
                        placeholder="tvly-..."
                        className="w-full bg-canvas border border-white/10 rounded-xl px-3.5 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-accent/50"
                      />
                    </div>
                  )}

                  {current.search_provider === 'serper' && (
                    <div className="p-4 rounded-xl bg-surface border border-white/5 space-y-2">
                      <label className="text-slate-300 font-medium">Serper API Key</label>
                      <input
                        type="password"
                        value={current.keys.serper || ''}
                        onChange={(e) => setCurrent(prev => ({ ...prev, keys: { ...prev.keys, serper: e.target.value } }))}
                        placeholder="serper-..."
                        className="w-full bg-canvas border border-white/10 rounded-xl px-3.5 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-accent/50"
                      />
                    </div>
                  )}
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
                    </div>

                    <div className="p-3 rounded-xl bg-canvas border border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[11px] text-slate-300 font-mono">http://localhost:11434</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => fetchModelsDynamically('ollama', '', current.ollama_endpoint)}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-accent text-[11px] flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
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
                  className="primary-button"
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

