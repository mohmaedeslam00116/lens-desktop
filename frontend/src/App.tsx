import React, { useState, useEffect, useRef } from 'react';
import { Search, X, AlertTriangle } from 'lucide-react';
import { Sidebar } from './components/vane/Sidebar';
import { MessageBox } from './components/vane/MessageBox';
import { MessageInput } from './components/vane/MessageInput';
import { DiscoverView } from './components/vane/DiscoverView';
import { LibraryView } from './components/vane/LibraryView';
import type { AgenticConversationProjection } from './utils/agenticConversation';
import { GraphView } from './components/vane/GraphView';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { PlanApprovalModal } from './components/research/PlanApprovalModal';
import { SkillsManagerView } from './components/skills/SkillsManagerView';
import { LensHarnessWorkspace } from './components/harness/LensHarnessWorkspace';
import { 
  Language, 
  ResearchDepth, 
  ResearchPerspective, 
  ResearchGraphNode, 
  ReportData, 
  ApiSettings, 
  SourceItem,
  ResearchStep,
  ResearchPlan,
  ResearchMode,
  WideResearchTelemetry,
} from './types';
import { buildResearchStartPayload } from './utils/researchRequest.mjs';
import { resolveReportTelemetry } from './utils/reportTelemetry.mjs';
import { resolveEngineEndpointFromWindow, DEFAULT_ENGINE_PORT } from './utils/engineEndpoint.mjs';
import { useEngineHealth } from './hooks/useEngineHealth';
import type { EngineProbeResult } from './utils/engineHealth.mjs';
import { telemetryStep, AgentFeedState, LiveEventLike } from './utils/liveFeed';
import { initialAgentRunState, reduceAgentRun, type AgentRunFeedState } from './utils/agentRunFeed.mjs';

/**
 * The embedded engine's endpoint is bound by the Electron main process, which
 * may fall back to an ephemeral port when the preferred one is taken. Reading
 * it from the preload bridge keeps the workspace pointed at the engine that
 * actually started; the declared default applies only in browser development.
 */
const ENGINE_ENDPOINT = resolveEngineEndpointFromWindow(
  typeof window === 'undefined' ? null : window
);
const API_BASE = ENGINE_ENDPOINT.baseUrl;
const WS_BASE = ENGINE_ENDPOINT.wsBaseUrl;

const DEFAULT_SETTINGS: ApiSettings = {
  search_provider: 'duckduckgo',
  llm_provider: 'google',
  model_name: '',
  ollama_endpoint: 'http://localhost:11434',
  embedding: {
    enabled: true,
    provider: 'google',
    model_name: 'text-embedding-004',
  },
  keys: {
    tavily: '',
    serper: '',
  }
};

// P2 one-time migration: plaintext chat keys (`openai`, `gemini`, …) leave
// localStorage for Pi's `auth.json`, and the LENS `gemini` id becomes the Pi
// `google` id. P3 extends it: embedding `api_key`/`use_chat_key` plaintext is
// scrubbed and the legacy embedding `gemini` provider becomes `google`.
// Runs once per stored settings payload; after it, `keys` holds only search
// keys and both provider fields speak Pi ids.
const CHAT_KEY_FIELDS = ['openai', 'gemini', 'google', 'anthropic', 'groq', 'deepseek', 'openrouter', 'mistral'] as const;
function migrateLegacySettings(parsed: any): { settings: ApiSettings; chatKeys: Array<{ provider: string; apiKey: string }> } {
  const chatKeys: Array<{ provider: string; apiKey: string }> = [];
  const rawKeys = (parsed?.keys ?? {}) as Record<string, unknown>;
  for (const field of CHAT_KEY_FIELDS) {
    const value = rawKeys[field];
    if (typeof value === 'string' && value.trim()) {
      const piProvider = field === 'gemini' ? 'google' : field;
      chatKeys.push({ provider: piProvider, apiKey: value.trim() });
    }
  }
  const rawProvider = typeof parsed?.llm_provider === 'string' ? parsed.llm_provider : 'google';
  const llm_provider = (rawProvider === 'gemini' ? 'google' : rawProvider) as ApiSettings['llm_provider'];
  const rawEmbedding = (parsed?.embedding ?? {}) as Record<string, unknown>;
  const rawEmbedProvider = typeof rawEmbedding.provider === 'string' ? rawEmbedding.provider : 'google';
  const embedProvider = (rawEmbedProvider === 'gemini' ? 'google' : rawEmbedProvider) as NonNullable<ApiSettings['embedding']>['provider'];
  const settings: ApiSettings = {
    search_provider: parsed?.search_provider ?? 'duckduckgo',
    llm_provider,
    model_name: typeof parsed?.model_name === 'string' ? parsed.model_name : '',
    ...(typeof parsed?.custom_model_name === 'string' ? { custom_model_name: parsed.custom_model_name } : {}),
    ollama_endpoint: typeof parsed?.ollama_endpoint === 'string' ? parsed.ollama_endpoint : 'http://localhost:11434',
    ...(parsed?.embedding
      ? {
          embedding: {
            enabled: rawEmbedding.enabled !== false,
            provider: embedProvider,
            model_name: typeof rawEmbedding.model_name === 'string' ? rawEmbedding.model_name : 'text-embedding-004',
            ...(typeof rawEmbedding.custom_model_name === 'string' ? { custom_model_name: rawEmbedding.custom_model_name } : {}),
          },
        }
      : {}),
    keys: {
      ...(typeof rawKeys.tavily === 'string' ? { tavily: rawKeys.tavily } : {}),
      ...(typeof rawKeys.serper === 'string' ? { serper: rawKeys.serper } : {}),
    },
  };
  return { settings, chatKeys };
}

/**
 * Operator-facing explanation of an unreachable engine.
 *
 * The probe deliberately reports a machine-readable `reason` instead of prose,
 * so the interface owns the wording. Each message names the condition that was
 * actually observed; none of them claim the engine is working.
 */
function describeEngineOutage(
  reason: EngineProbeResult['reason'],
  language: Language,
  address: string | null
): string {
  const ar = language === 'ar';

  // A startup failure leaves no address to name: the main process never bound
  // the engine, so any address here would be a guess. Saying so is the honest
  // report, and it keeps a guessed address out of the operator's message.
  if (!address) {
    return ar
      ? 'لم يبدأ محرك البحث المدمج، لذا لا يوجد عنوان يمكن فحصه.'
      : 'The embedded research engine did not start, so there is no address to check.';
  }

  switch (reason) {
    case 'timeout':
      return ar
        ? `لم يستجب محرك البحث خلال المهلة المحددة على ${address}.`
        : `The research engine did not answer within the timeout at ${address}.`;
    case 'http_error':
      return ar
        ? `أعاد محرك البحث خطأً على ${address}.`
        : `The research engine answered with an error at ${address}.`;
    case 'invalid_report':
      return ar
        ? `هناك برنامج آخر يستجيب على منفذ محرك البحث (${address}) وليس LENS.`
        : `Something other than LENS is answering on the engine port (${address}).`;
    case 'port_owner_mismatch':
      return ar
        ? `يستخدم برنامج آخر منفذ محرك البحث المتوقع؛ ومحرك LENS مسجّل على منفذ مختلف.`
        : `Another program holds the expected engine port, and the LENS engine reported a different one.`;
    case 'unreachable':
    default:
      return ar
        ? `لا يعمل محرك البحث المدمج على ${address}.`
        : `The embedded research engine is not running at ${address}.`;
  }
}

export function App() {
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem('lens_language') === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('lens_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const [researchError, setResearchError] = useState('');
  const [activeTab, setActiveTab] = useState<'home' | 'discover' | 'history' | 'graph' | 'skills'>('home');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  // The live agentic run feed (ticket #145): reduced from the engine's
  // /ws/agent/:id stream — cards and chips render from real events only.
  const [agentRunFeed, setAgentRunFeed] = useState<AgentRunFeedState | null>(null);
  const agentAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const agentWsRef = useRef<WebSocket | null>(null);

  /**
   * The engine's live reachability. The workspace used to discover a dead engine
   * only when the first research request failed, and the startup failure was
   * console-only (invisible in a packaged build).
   */
  const engineHealth = useEngineHealth(
    ENGINE_ENDPOINT.baseUrl,
    ENGINE_ENDPOINT.port,
    DEFAULT_ENGINE_PORT
  );

  // Search Engine Parameters
  const [query, setQuery] = useState('');
  const [optimizationMode, setOptimizationMode] = useState<'speed' | 'balanced' | 'quality'>('quality');
  const [researchMode, setResearchMode] = useState<ResearchMode>('standard');
  const [sourceFocus, setSourceFocus] = useState<'web' | 'academic' | 'social'>('web');
  const [isSearching, setIsSearching] = useState(false);

  // Active Research Stream Data
  const [currentQuery, setCurrentQuery] = useState('');
  const [activeReport, setActiveReport] = useState<ReportData | null>(null);
  const [currentStatus, setCurrentStatus] = useState('');
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [subqueries, setSubqueries] = useState<string[]>([]);
  const [visitedSources, setVisitedSources] = useState<SourceItem[]>([]);
  const [reflections, setReflections] = useState<string[]>([]);
  const [graphNodes, setGraphNodes] = useState<ResearchGraphNode[]>([]);
  const [wideTelemetry, setWideTelemetry] = useState<WideResearchTelemetry | null>(null);
  const [wideExpansionHistory, setWideExpansionHistory] = useState<WideResearchTelemetry[]>([]);
  
  // Collaborative Plan Scoping (Tracer 4)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [proposedPlan, setProposedPlan] = useState<ResearchPlan | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isRegeneratingPlan, setIsRegeneratingPlan] = useState(false);

  // Local storage & Settings
  const [history, setHistory] = useState<ReportData[]>([]);
  const [settings, setSettings] = useState<ApiSettings>(DEFAULT_SETTINGS);
  // The Agentic Conversation projection (#144): the renderer-side mirror of
  // the engine's LENS-side transcript store — persisted with the history
  // entry at terminal time and replayed by session id from the history rail.
  const [conversationProjection, setConversationProjection] = useState<AgenticConversationProjection | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // Live-connection resilience (visibility fix, ticket #119): track the last
  // delivered engine eventId for delta replay, bound reconnect attempts, and
  // mark terminal outcomes so onclose never resurrects a finished run.
  // Per-agent workspace cards (visibility fix, ticket #119): one card per
  // researcher/agentic worker, driven by researcher_telemetry events.
  const [agents, setAgents] = useState<AgentFeedState[]>([]);
  const [agentEventCount, setAgentEventCount] = useState(0);
  // Live report text accumulated from report_chunk events while the run is
  // active (the finished event supersedes it with the final report). The ref
  // mirrors the state so terminal handlers read the accumulated text even if
  // the final event omits a report payload.
  const [liveReport, setLiveReport] = useState('');
  const liveReportRef = useRef('');
  const lastEventIdRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const runTerminatedRef = useRef(false);
  const wideExpansionHistoryRef = useRef<WideResearchTelemetry[]>([]);
  const wideTelemetryRef = useRef<WideResearchTelemetry | null>(null);
  const approvedPlanRef = useRef<ResearchPlan | null>(null);
  const sessionGenerationRef = useRef(0);

  // Direction sync
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    try { localStorage.setItem('lens_language', language); } catch { /* Preferences are optional. */ }
  }, [language]);

  // Agent-card elapsed clock (visibility fix, ticket #119): advances while any
  // card is running, freezes terminal cards (their elapsedMs was captured on
  // completion). 1s cadence; cheap — a few cards at most.
  useEffect(() => {
    if (!isSearching) return;
    const iv = window.setInterval(() => {
      const now = Date.now();
      setAgents((prev) => {
        if (prev.length === 0) return prev;
        return prev.map((a) =>
          a.status === 'success' || a.status === 'failed'
            ? a
            : { ...a, elapsedMs: now - a.startedAt },
        );
      });
    }, 1000);
    return () => window.clearInterval(iv);
  }, [isSearching]);

  // Theme sync
  useEffect(() => {
    try { localStorage.setItem('lens_theme', theme); } catch { /* Preferences are optional. */ }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Load history & settings (P2: one-time chat-keys → Pi `auth.json`
  // migration; after it localStorage holds no chat-key plaintext).
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('deep_research_history');
      if (savedHistory) setHistory(JSON.parse(savedHistory));

      const savedSettings = localStorage.getItem('deep_research_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (!parsed.embedding) {
          const provider = (parsed.llm_provider === 'openai' ? 'openai' : parsed.llm_provider === 'ollama' ? 'ollama' : 'google');
          const defaultModel = provider === 'google' ? 'text-embedding-004' : provider === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text';
          parsed.embedding = {
            enabled: true,
            provider,
            model_name: defaultModel,
          };
        }
        const { settings: migrated, chatKeys } = migrateLegacySettings(parsed);
        setSettings(migrated);
        // Persist the slimmed shape immediately so plaintext never lingers,
        // then push any legacy keys into Pi (fire-and-forget: Settings Save
        // retries the write; a failed migration never blocks boot).
        try {
          localStorage.setItem('deep_research_settings', JSON.stringify(migrated));
        } catch { /* Preferences are optional. */ }
        if (chatKeys.length > 0 && API_BASE) {
          for (const { provider, apiKey } of chatKeys) {
            fetch(`${API_BASE}/api/pi/auth`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider, apiKey }),
            }).catch(() => { /* engine unreachable: Save retries */ });
          }
          if (migrated.llm_provider) {
            fetch(`${API_BASE}/api/pi/defaults`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider: migrated.llm_provider, model: migrated.model_name || undefined }),
            }).catch(() => { /* engine unreachable: Save retries */ });
          }
        }
        // P4 one-time migration: the local Ollama endpoint persists into Pi's
        // `models.json` overlay (fire-and-forget; Settings Save re-syncs on
        // every change). Skipped when Pi already holds one — the file wins.
        if (API_BASE && (migrated.ollama_endpoint || '').trim()) {
          const endpoint = migrated.ollama_endpoint.trim();
          fetch(`${API_BASE}/api/pi/ollama`)
            .then((r) => (r.ok ? r.json() : null))
            .then((status) => {
              if (status && !status.endpoint) {
                fetch(`${API_BASE}/api/pi/ollama`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ endpoint }),
                }).catch(() => { /* engine unreachable: Save retries */ });
              }
            })
            .catch(() => { /* engine unreachable: Save retries */ });
        }
      }
    } catch (e) {
      console.error('Error reading storage:', e);
    }
  }, []);

  // Global Keyboard Shortcuts (Ctrl+K, Ctrl+N)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewResearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const saveSettings = (newSettings: ApiSettings) => {
    setSettings(newSettings);
    localStorage.setItem('deep_research_settings', JSON.stringify(newSettings));
  };

  /** Never add a card here: this only changes real researcher telemetry cards. */
  const updateNonTerminalAgentStatus = (status: 'running' | 'retrying' | 'success' | 'failed') => {
    setAgents((prev) => prev.map((agent) =>
      agent.status === 'success' || agent.status === 'failed'
        ? agent
        : { ...agent, status, elapsedMs: status === 'success' || status === 'failed' ? Date.now() - agent.startedAt : agent.elapsedMs },
    ));
  };

  const handleNewResearch = () => {
    // Teardown: a live agent socket must not outlive the session it belongs
    // to, and the feed must not bleed an old run into the new one.
    agentWsRef.current?.close();
    agentWsRef.current = null;
    setAgentRunFeed(null);
    sessionGenerationRef.current += 1;
    const previousSocket = wsRef.current;
    wsRef.current = null;
    if (previousSocket && previousSocket.readyState !== WebSocket.CLOSED) {
      previousSocket.close();
    }
    approvedPlanRef.current = null;
    setResearchError('');
    setIsSearching(false);
    setActiveReport(null);
    setCurrentQuery('');
    setQuery('');
    setCurrentStatus('');
    setThoughts([]);
    setSubqueries([]);
    setVisitedSources([]);
    setReflections([]);
    setGraphNodes([]);
    setWideTelemetry(null);
    setWideExpansionHistory([]);
    setAgents([]);
    setAgentEventCount(0);
    setLiveReport('');
    liveReportRef.current = '';
    setProposedPlan(null);
    setIsPlanModalOpen(false);
    setIsRegeneratingPlan(false);
    setActiveSessionId(null);
    setActiveTab('home');
  };

  /**
   * Agentic Search — the default-in-chat interaction (ticket #145; SPEC-028).
   * Posts the question to the engine's /api/agent/start surface, attaches the
   * /ws/agent/:id live stream, and reduces every event into the run feed the
   * workspace renders. Cards and chips reflect REAL events end-to-end.
   */
  const handleStartAgentRun = async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed || isSearching) return;

    // P2: auth lives in Pi (`auth.json`) — the renderer no longer gates on a
    // local key. The engine's admission guard (Pi standing) rejects keyless
    // runs with a bilingual 422; here we just start.

    setResearchError('');
    setCurrentQuery(trimmed);
    setIsSearching(true);
    setActiveTab('home');
    setActiveReport(null);
    setConversationProjection(null);
    setCurrentStatus(language === 'ar' ? 'بدء التشغيل الأجنتي...' : 'Starting the agentic run...');
    // A new agent run starts from a clean workspace — the same complete reset
    // a fresh research run gets. Anything left over (streamed report text,
    // admitted sources, thoughts, telemetry) would bleed the previous run
    // into this one, including into the new run's saved report fallback.
    setThoughts([]);
    setSubqueries([]);
    setVisitedSources([]);
    setReflections([]);
    setGraphNodes([]);
    setWideTelemetry(null);
    wideTelemetryRef.current = null;
    setWideExpansionHistory([]);
    wideExpansionHistoryRef.current = [];
    setLiveReport('');
    liveReportRef.current = '';
    setAgents([]);
    setAgentEventCount(0);
    // The previous agent socket must not outlive the run it belonged to: its
    // late close/error must never settle this run's state (the onclose guard
    // below enforces the same ownership).
    agentWsRef.current?.close();
    agentWsRef.current = null;
    // The feed seeds session-less (null) and SELF-SEEDS from the accept
    // payload's real session id — seeding with a literal empty id would make
    // the reducer reject every subsequent real event as another session's.
    setAgentRunFeed(null);

    const controller = new AbortController();
    let sessionId = '';
    try {
      const response = await fetch(`${API_BASE}/api/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          provider: settings.llm_provider,
          // The user's chosen working model (Settings test proves this one
          // answers): the session resolves it inside the requested provider
          // instead of wandering to ambient auth's pick. Pi files own auth
          // and the Ollama endpoint — the body carries Pi ids only.
          model_name: settings.custom_model_name || settings.model_name || undefined,
          // Track B (SPEC #155): the retrieval selection rides the agent
          // start — the engine threads it into the tool surface (Deep
          // Research already sends this field on its own start path).
          search_provider: settings.search_provider,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(String(detail?.error ?? `Agentic start failed (${response.status})`));
      }
      const accept = await response.json();
      sessionId = String(accept.session_id ?? '');
      const streamPath = String(accept.session_url ?? `/ws/agent/${sessionId}`);
      if (!sessionId) throw new Error(language === 'ar' ? 'لم يُقم المحرك بمعرّف الجلسة.' : 'The engine did not return a session id.');
      agentAbortControllersRef.current.set(sessionId, controller);
      // Seed the feed with the REAL session id from the accept payload.
      setAgentRunFeed(initialAgentRunState(sessionId));

      const ws = new WebSocket(`${WS_BASE}${streamPath}`);
      agentWsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          setAgentRunFeed((prev) => reduceAgentRun(prev, { ...payload, sessionId }));
          if (payload.type === 'status') {
            setCurrentStatus(String(payload.message ?? currentStatus));
          } else if (payload.type === 'source') {
            setVisitedSources((prev) => {
              if (prev.some((s) => s.url === (payload.url ?? payload.source?.url))) return prev;
              return [...prev, {
                url: payload.url ?? payload.source?.url ?? '',
                title: payload.title ?? payload.source?.title ?? 'Source',
                domain: payload.domain ?? payload.source?.domain,
                snippet: payload.snippet ?? payload.source?.snippet ?? '',
                credibility: payload.credibility ?? 0.5,
              }];
            });
          } else if (payload.type === 'report_chunk') {
            const chunk = String(payload.chunk ?? payload.text ?? '');
            setLiveReport((prev) => {
              liveReportRef.current = prev + chunk;
              return liveReportRef.current;
            });
          } else if (payload.type === 'finished') {
            // The explicit terminal — the run's report and admitted sources
            // land in the normal history pipeline (Deep Research parity).
            const finalReport = {
              id: sessionId,
              query: trimmed,
              title: trimmed,
              content: String(payload.report ?? liveReportRef.current ?? ''),
              sources: Array.isArray(payload.sources) ? payload.sources : [],
              createdAt: new Date().toISOString(),
              costs: 0.0,
              language,
            } as ReportData;
            setActiveReport(finalReport);
            setIsSearching(false);
            setHistory((prev) => {
              const updated = [finalReport, ...prev.filter((p) => p.id !== finalReport.id).slice(0, 49)];
              localStorage.setItem('deep_research_history', JSON.stringify(updated));
              return updated;
            });
            const projection = payload.conversationProjection ?? null;
            if (projection) {
              setConversationProjection(projection);
              try {
                const rawConversations = localStorage.getItem('lens-agentic-conversations');
                const conversations = rawConversations ? JSON.parse(rawConversations) : {};
                conversations[finalReport.id] = projection;
                localStorage.setItem('lens-agentic-conversations', JSON.stringify(conversations));
              } catch { /* Projection persistence is optional; replay degrades visibly. */ }
            }
            agentAbortControllersRef.current.delete(sessionId);
            ws.close();
          } else if (payload.type === 'budget_exhausted') {
            // Mid-run retrieval warning — the run continues into its answer
            // and explicit terminal. Never close the stream, never clear the
            // searching state: the terminal below owns the run's ending.
            if (payload.message) setCurrentStatus(String(payload.message));
          } else if (payload.type === 'error' || payload.type === 'cancelled') {
            setCurrentStatus(String(payload.message ?? ''));
            setIsSearching(false);
            agentAbortControllersRef.current.delete(sessionId);
            ws.close();
          }
        } catch { /* A malformed event never breaks the run. */ }
      };
      ws.onclose = () => {
        // Ownership guard: a superseded socket (a newer run replaced it, or
        // New Research tore it down) must never settle another run's state.
        if (agentWsRef.current !== ws) return;
        agentWsRef.current = null;
        agentAbortControllersRef.current.delete(sessionId);
        setIsSearching(false);
        // Explicit-terminal law: a close without a prior terminal event is
        // the error terminal — the feed never stays running silently.
        setAgentRunFeed((prev) =>
          prev && (prev.phase === 'running' || prev.phase === 'retrying' || prev.phase === 'idle')
            ? reduceAgentRun(prev, { type: 'error', sessionId, message: 'The agentic event stream closed unexpectedly. | أُغلق تدفق الأحداث فجأة.' })
            : prev
        );
      };
      ws.onerror = () => {
        setResearchError(language === 'ar' ? 'تعذر الاتصال بتدفق الأحداث.' : 'Could not reach the event stream.');
      };
    } catch (error: any) {
      if (controller.signal.aborted) return;
      setResearchError(String(error?.message ?? error));
      setIsSearching(false);
    }
  };

  /** Steer the live agentic run: queued VISIBLY, applied by the engine. */
  const handleSteerAgentRun = async (message: string) => {
    const feed = agentRunFeed;
    if (!feed || (feed.phase !== 'running' && feed.phase !== 'retrying')) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    setAgentRunFeed((prev) => reduceAgentRun(prev, { type: 'steer_queued', sessionId: feed.sessionId, message: trimmed }));
    try {
      await fetch(`${API_BASE}/api/agent/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: feed.sessionId, message: trimmed }),
      });
    } catch { /* The queued state stays visible; the engine applies when it can. */ }
  };

  /** Cancel the live agentic run — an explicit terminal, evidence retained. */
  const handleCancelAgentRun = () => {
    const feed = agentRunFeed;
    if (!feed) return;
    const sessionId = feed.sessionId;
    const controller = agentAbortControllersRef.current.get(sessionId);
    controller?.abort();
    fetch(`${API_BASE}/api/agent/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).then(async (response) => {
      if (response.ok) return; // The engine confirms with the `cancelled` terminal on the stream.
      let alreadyFinished = false;
      try {
        alreadyFinished = (await response.json())?.already_finished === true;
      } catch { /* A non-JSON rejection still settles below. */ }
      if (alreadyFinished) return; // Terminal race: the run just ended; its terminal is in flight.
      // No live run server-side and no recent terminal: the feed for this
      // session will never hear anything — settle locally instead of hanging
      // in the searching state. The reducer ignores this for sessions that
      // already reached their own terminal.
      agentAbortControllersRef.current.delete(sessionId);
      setIsSearching(false);
      setAgentRunFeed((prev) =>
        prev ? reduceAgentRun(prev, { type: 'error', sessionId, message: 'The agentic run is no longer live on the engine. | لم يعد التشغيل الأجنتي حيًا على المحرك.' }) : prev
      );
      agentWsRef.current?.close();
    }).catch(() => {
      // The cancel never reached the engine. Say so visibly instead of
      // leaving the stop control spinning; the stream's own close handler
      // still owns the feed's terminal either way.
      setResearchError(language === 'ar' ? 'تعذّر إرسال الإلغاء إلى المحرك.' : 'Could not reach the engine to cancel.');
    });
  };

  const handleStartResearch = async (searchQuery: string) => {
    if (!searchQuery.trim() || isSearching) return;

    const sessionGeneration = sessionGenerationRef.current;

    // P2: auth lives in Pi — no local key gate. The engine admits/rejects on
    // Pi standing.

    const trimmed = searchQuery.trim();
    setResearchError('');
    setCurrentQuery(trimmed);
    setProposedPlan(null);
    approvedPlanRef.current = null;
    setIsPlanModalOpen(false);
    setIsRegeneratingPlan(false);
    setActiveSessionId(null);
    setIsSearching(true);
    setActiveTab('home');
    setActiveReport(null);
    setConversationProjection(null);
    setCurrentStatus(language === 'ar' ? 'جاري بدء استكشاف الموضوع وتوليد الاستعلامات...' : 'Initiating autonomous research...');
    setThoughts([]);
    setSubqueries([]);
    setVisitedSources([]);
    setReflections([]);
    setGraphNodes([]);
    setWideTelemetry(null);
    setWideExpansionHistory([]);
    setAgents([]);
    setAgentEventCount(0);
    setLiveReport('');
    liveReportRef.current = '';
    wideTelemetryRef.current = null;
    wideExpansionHistoryRef.current = [];

    // Map optimization mode to depth & perspective
    let depth: ResearchDepth = 'deep';
    let perspective: ResearchPerspective = 'balanced';
    if (optimizationMode === 'speed') {
      depth = 'quick';
      perspective = 'balanced';
    } else if (optimizationMode === 'quality') {
      depth = 'storm';
      perspective = 'storm';
    }

    // Apply focus prefix if selected
    let effectiveQuery = trimmed;
    if (sourceFocus === 'academic') {
      effectiveQuery = `[Academic Research & Scholar]: ${trimmed}`;
    } else if (sourceFocus === 'social') {
      effectiveQuery = `[Community Discussions & Real Insights]: ${trimmed}`;
    }

    try {
      const response = await fetch(`${API_BASE}/api/research/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildResearchStartPayload({
          query: effectiveQuery,
          mode: researchMode,
          depth,
          report_type: depth,
          perspective,
          language,
          search_provider: settings.search_provider,
          llm_provider: settings.llm_provider,
          model_name: settings.custom_model_name || settings.model_name || undefined,
          embedding_provider: settings.embedding?.provider,
          embedding_model: settings.embedding?.custom_model_name || settings.embedding?.model_name,
          // P3/P4: embedding credentials and the Ollama endpoint resolve from
          // Pi truth in the engine — the envelope carries Pi ids only.
          embedding_enabled: settings.embedding?.enabled,
        })),
      });

      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json();
      if (sessionGeneration !== sessionGenerationRef.current) return;
      const sessionId = data.session_id;
      setActiveSessionId(sessionId);

      reconnectAttemptsRef.current = 0;
      runTerminatedRef.current = false;
      lastEventIdRef.current = 0;
      const ws = new WebSocket(`${WS_BASE}/ws/research/${sessionId}`);
      wsRef.current = ws;

      let accumulatedSources: SourceItem[] = [];
      let sessionTelemetry: WideResearchTelemetry | null = null;
      let sessionExpansionHistory: WideResearchTelemetry[] = [];

      ws.onmessage = (event) => {
        if (sessionGeneration !== sessionGenerationRef.current) return;
        try {
          const payload = JSON.parse(event.data);
          if (typeof payload.eventId === 'number') {
            lastEventIdRef.current = Math.max(lastEventIdRef.current, payload.eventId);
          }
          reconnectAttemptsRef.current = 0;

          const telemetryFeedStep = telemetryStep(payload as LiveEventLike, language === 'ar');
          if (telemetryFeedStep) {
            setThoughts((prev) => [...prev, telemetryFeedStep]);
          }

          // Per-agent card state (researcher_telemetry drives the cards; every
          // telemetry event counts as liveness for the elapsed clock).
          if (payload.type === 'researcher_telemetry' && payload.researcherTelemetry?.researcherId) {
            const t = payload.researcherTelemetry;
            setAgents((prev) => {
              const idx = prev.findIndex((a) => a.id === t.researcherId);
              const isArabic = language === 'ar';
              const label = isArabic
                ? `باحث ${t.counts?.facetIndex != null ? (t.counts.facetIndex + 1) + '/' + t.counts.facetCount : ''}`.trim()
                : `Researcher ${t.counts?.facetIndex != null ? (t.counts.facetIndex + 1) + '/' + t.counts.facetCount : ''}`.trim();
              const phaseLabel: Record<string, { ar: string; en: string }> = {
                started: { ar: 'انطلق', en: 'started' },
                role_selected: { ar: 'تم اختيار الدور', en: 'role selected' },
                retrieval: { ar: 'جارٍ الاسترجاع', en: 'retrieving' },
                tool_activity: { ar: 'نشاط أدوات', en: 'tool activity' },
                run_started: { ar: 'بدأت الحلقة', en: 'loop started' },
                run_completed: { ar: 'أنجز', en: 'finished' },
                completed: { ar: 'اكتمل', en: 'completed' },
              };
              const status: AgentFeedState['status'] =
                t.phase === 'completed' || t.phase === 'run_completed' ? 'success'
                  : t.phase === 'started' || t.phase === 'run_started' ? 'running'
                  : 'running';
              const activity = phaseLabel[t.phase]?.[isArabic ? 'ar' : 'en'] || t.phase || '';
              if (idx === -1) {
                return [...prev, {
                  id: t.researcherId,
                  role: t.role || 'primary',
                  label,
                  facet: t.facet,
                  phase: t.phase || '',
                  startedAt: Date.now(),
                  elapsedMs: 0,
                  lastActivity: activity,
                  lastActivityAt: Date.now(),
                  status,
                }];
              }
              const next = [...prev];
              const card = next[idx];
              const terminal = t.phase === 'completed' || t.phase === 'run_completed';
              next[idx] = {
                ...card,
                role: t.role || card.role,
                facet: t.facet || card.facet,
                phase: t.phase || card.phase,
                lastActivity: activity,
                lastActivityAt: Date.now(),
                elapsedMs: terminal ? Date.now() - card.startedAt : card.elapsedMs,
                status,
              };
              return next;
            });
            setAgentEventCount((c) => c + 1);
          }

          if (payload.type === 'plan_proposed' || payload.type === 'plan_created') {
            if (payload.plan) {
              approvedPlanRef.current = payload.plan;
              setProposedPlan(payload.plan);
              setIsPlanModalOpen(true);
              setIsRegeneratingPlan(false);
              setCurrentStatus(language === 'ar' ? 'تمت صياغة مسار البحث. بانتظار الاعتماد...' : 'Research plan drafted. Awaiting approval...');
            }
          } else if (payload.type === 'plan_approved') {
            setIsPlanModalOpen(false);
            setCurrentStatus(language === 'ar' ? 'تم اعتماد الخطة. جاري استرجاع المصادر...' : 'Plan approved. Starting retrieval...');
          } else if (payload.type === 'plan_rejected') {
            setIsPlanModalOpen(false);
            setIsSearching(false);
            setCurrentStatus(language === 'ar' ? 'تم إلغاء خطة البحث.' : 'Research plan discarded.');
          } else if (payload.type === 'status') {
            setCurrentStatus(payload.message || '');
          } else if (payload.type === 'thought') {
            setThoughts((prev) => [...prev, payload.thought]);
          } else if (payload.type === 'subqueries') {
            setSubqueries(payload.subqueries || []);
          } else if (payload.type === 'source') {
            const newSrc: SourceItem = {
              url: payload.url,
              title: payload.title || payload.domain || payload.url,
              domain: payload.domain,
              credibilityScore: payload.credibilityScore || payload.credibility,
              snippet: payload.snippet
            };
            accumulatedSources.push(newSrc);
            setVisitedSources([...accumulatedSources]);
          } else if (payload.type === 'reflection') {
            if (payload.reflection) {
              setReflections((prev) => [...prev, payload.reflection]);
            }
          } else if (payload.type === 'graph_node') {
            if (payload.node) {
              setGraphNodes((prev) => [...prev, payload.node]);
            }
          } else if (payload.type === 'report_chunk') {
            // Progressive report streaming: the workspace shows the report
            // growing as the engine synthesizes it (visibility fix, #119).
            if (typeof payload.chunk === 'string' && payload.chunk) {
              liveReportRef.current += payload.chunk;
              setLiveReport(liveReportRef.current);
            }
          } else if (payload.type === 'skill_activated') {
            setThoughts((prev) => [...prev, payload.message || (language === 'ar' ? 'تم تفعيل مهارة' : 'Skill activated')]);
          } else if (payload.type === 'wide_telemetry' && payload.wideTelemetry) {
            sessionTelemetry = payload.wideTelemetry;
            wideTelemetryRef.current = payload.wideTelemetry;
            setWideTelemetry(payload.wideTelemetry);
            if (payload.wideTelemetry.expansion) {
              const expansion = payload.wideTelemetry.expansion;
              const alreadyRecorded = sessionExpansionHistory.some((item) =>
                item.expansion?.from === expansion.from
                && item.expansion?.to === expansion.to
                && item.expansion?.reason === expansion.reason,
              );
              if (!alreadyRecorded) {
                sessionExpansionHistory.push(payload.wideTelemetry);
                wideExpansionHistoryRef.current = [...sessionExpansionHistory];
              }
              setWideExpansionHistory([...sessionExpansionHistory]);
            }
          } else if (payload.type === 'finished') {
            const formattedSources = (payload.sources || []).map((s: any) => {
              if (typeof s === 'string') return { url: s, title: s, credibilityScore: 85 };
              if (s && !s.credibilityScore && typeof s.credibility === 'number') {
                return { ...s, credibilityScore: s.credibility };
              }
              return s;
            });

            const resolvedExpansionHistory = sessionExpansionHistory.length > 0
              ? [...sessionExpansionHistory]
              : wideExpansionHistoryRef.current.length > 0
                ? [...wideExpansionHistoryRef.current]
                : (payload.wideTelemetry?.expansion ? [payload.wideTelemetry] : undefined);

            const finalReport: ReportData = {
              id: sessionId,
              query: trimmed,
              title: trimmed,
              content: payload.report || liveReportRef.current || '',
              sources: formattedSources.length > 0 ? formattedSources : accumulatedSources,
              depth,
              perspective,
              plan: payload.plan || approvedPlanRef.current || proposedPlan || undefined,
              graphNodes,
              reflections: payload.reflections || reflections,
              createdAt: new Date().toISOString(),
              costs: payload.costs || 0.0,
              language,
              mode: researchMode,
              wideTelemetry: payload.wideTelemetry || sessionTelemetry || wideTelemetryRef.current || wideTelemetry || undefined,
              wideExpansionHistory: resolvedExpansionHistory,
            };

            setActiveReport(finalReport);
            setIsSearching(false);
            updateNonTerminalAgentStatus('success');

            setHistory((prev) => {
              const updated = [finalReport, ...prev.filter((p) => p.id !== finalReport.id).slice(0, 49)];
              localStorage.setItem('deep_research_history', JSON.stringify(updated));
              return updated;
            });

            // Persist the Agentic Conversation projection with its history
            // entry (#144): the renderer mirror of the engine's LENS-side
            // transcript store — the terminal payload carries the projection
            // built from the SAME persisted bytes; absent stays absent.
            const agenticProjection = payload.conversationProjection ?? null;
            if (agenticProjection) {
              setConversationProjection(agenticProjection);
              try {
                const rawConversations = localStorage.getItem('lens-agentic-conversations');
                const conversations = rawConversations ? JSON.parse(rawConversations) : {};
                conversations[finalReport.id] = agenticProjection;
                localStorage.setItem('lens-agentic-conversations', JSON.stringify(conversations));
              } catch { /* Projection persistence is optional; replay degrades visibly. */ }
            }

            runTerminatedRef.current = true;
            wsRef.current?.close();
          } else if (payload.type === 'error') {
            setCurrentStatus(payload.message || 'Error occurred');
            setResearchError(payload.message || (language === 'ar' ? 'تعذر إكمال البحث. يمكنك المحاولة مجددًا.' : 'Research could not finish. Please try again.'));
            setIsSearching(false);
            updateNonTerminalAgentStatus('failed');
            runTerminatedRef.current = true;
            wsRef.current?.close();
          } else if (payload.type === 'cancelled') {
            setCurrentStatus(payload.message || (language === 'ar' ? 'أُلغي البحث.' : 'Research cancelled.'));
            setResearchError(payload.message || (language === 'ar' ? 'أُلغي البحث.' : 'Research cancelled.'));
            setIsSearching(false);
            updateNonTerminalAgentStatus('failed');
            runTerminatedRef.current = true;
            wsRef.current?.close();
          } else if (payload.type === 'budget_exhausted') {
            setCurrentStatus(payload.message || (language === 'ar' ? 'استُهلكت ميزانية البحث. زيّد الحد في الإعدادات ثم أعد المحاولة.' : 'Research budget exhausted. Raise the limit in Settings and retry.'));
            setResearchError(payload.message || (language === 'ar' ? 'استُهلكت ميزانية البحث. زيّد الحد في الإعدادات ثم أعد المحاولة.' : 'Research budget exhausted. Raise the limit in Settings and retry.'));
            setIsSearching(false);
            updateNonTerminalAgentStatus('failed');
            runTerminatedRef.current = true;
            wsRef.current?.close();
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onerror = (err) => {
        // Terminal UI state is NOT set here: transient errors are recovered by
        // onclose (reconnect with delta replay). Only exhausting all reconnect
        // attempts (or a terminal event) may end the run — otherwise a
        // recoverable blip would stop the agent feed mid-run.
        if (sessionGeneration !== sessionGenerationRef.current) return;
        console.error('WebSocket error:', err);
      };

      // Abnormal close while a run is active: the run may still be alive in the
      // engine (which buffers events and replays deltas via ?since=). Reconnect
      // with bounded exponential backoff instead of silently abandoning it.
      ws.onclose = (ev) => {
        if (sessionGeneration !== sessionGenerationRef.current) return;
        wsRef.current = null;
        if (runTerminatedRef.current) return; // finished/cancelled/error closed intentionally
        if (ev.code === 1008) {
          runTerminatedRef.current = true;
          const sessionError = language === 'ar'
            ? 'انتهت جلسة البحث المباشر. أعد المحاولة لبدء جلسة جديدة.'
            : 'The live research session is no longer available. Start a new research to continue.';
          setCurrentStatus(sessionError);
          setResearchError(sessionError);
          updateNonTerminalAgentStatus('failed');
          setIsSearching(false);
          return;
        }
        if (reconnectAttemptsRef.current >= 5) {
          runTerminatedRef.current = true;
          const reconnectError = language === 'ar'
            ? 'انقطع الاتصال المباشر بشكل متكرر. قد يستمر البحث في الخلفية — تحقق من النتائج بعد قليل أو أعد المحاولة.'
            : 'Live connection kept dropping. The research may still be running in the background — check back shortly or retry.';
          setResearchError(reconnectError);
          updateNonTerminalAgentStatus('failed');
          setIsSearching(false);
          return;
        }
        reconnectAttemptsRef.current += 1;
        setCurrentStatus(language === 'ar' ? 'جارٍ إعادة الاتصال بالبحث المباشر…' : 'Reconnecting to live research…');
        updateNonTerminalAgentStatus('retrying');
        const backoffMs = Math.min(30000, 500 * 2 ** (reconnectAttemptsRef.current - 1));
        window.setTimeout(() => {
          if (sessionGeneration !== sessionGenerationRef.current || runTerminatedRef.current) return;
          const retry = new WebSocket(`${WS_BASE}/ws/research/${sessionId}?since=${lastEventIdRef.current}`);
          retry.onopen = () => {
            if (sessionGeneration !== sessionGenerationRef.current || runTerminatedRef.current) return;
            setAgents((prev) => prev.map((agent) => agent.status === 'retrying' ? { ...agent, status: 'running' } : agent));
          };
          retry.onmessage = ws.onmessage;
          retry.onerror = ws.onerror;
          retry.onclose = ws.onclose;
          wsRef.current = retry;
        }, backoffMs);
      };
    } catch (err: any) {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      console.error('Failed to start research:', err);
      setResearchError(language === 'ar' ? 'تعذر بدء البحث. تأكد من تشغيل تطبيق سطح المكتب وإعداد النموذج ثم أعد المحاولة. سؤالك محفوظ أدناه.' : 'Could not start research. Check the desktop app and model setup, then try again. Your question is preserved below.');
      setIsSearching(false);
    }
  };

  const sendPlanAction = async (
    action: 'plan_approved' | 'plan_rejected' | 'plan_regenerate',
    payload: Record<string, any>,
    restEndpoint: string
  ) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action, ...payload }));
    } else if (activeSessionId) {
      try {
        await fetch(`${API_BASE}${restEndpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: activeSessionId, ...payload })
        });
      } catch (err) {
        console.error(`Failed to send ${action} via REST:`, err);
        if (action === 'plan_regenerate') {
          setIsRegeneratingPlan(false);
        }
      }
    }
  };

  const handleApprovePlan = async (approvedPlan: ResearchPlan) => {
    approvedPlanRef.current = approvedPlan;
    setIsPlanModalOpen(false);
    setCurrentStatus(language === 'ar' ? 'تم اعتماد الخطة. جاري استرجاع المصادر...' : 'Plan authorized. Beginning wide retrieval...');
    await sendPlanAction('plan_approved', { plan: approvedPlan }, '/api/research/plan/approve');
  };

  const handleRegeneratePlan = async (modifier?: string) => {
    setIsRegeneratingPlan(true);
    await sendPlanAction('plan_regenerate', { modifier }, '/api/research/plan/regenerate');
  };

  const handleDiscardPlan = async (reason?: string) => {
    runTerminatedRef.current = true;
    setIsPlanModalOpen(false);
    setIsSearching(false);
    setCurrentStatus(language === 'ar' ? 'تم إلغاء خطة البحث.' : 'Research plan discarded.');
    await sendPlanAction('plan_rejected', { reason: reason || 'User discarded plan' }, '/api/research/plan/reject');
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }
  };

  const handleExport = async (format: 'pdf' | 'docx' | 'markdown') => {
    if (!activeReport) return;
    try {
      if (format === 'markdown') {
        const blob = new Blob([activeReport.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Research_Report_${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      const res = await fetch(`${API_BASE}/api/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: activeReport.title,
          content: activeReport.content,
          sources: activeReport.sources.map((s) => s.url),
          costs: activeReport.costs,
          created_at: activeReport.createdAt,
          language: activeReport.language,
        }),
      });

      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Research_Report_${Date.now()}.${format === 'docx' ? 'docx' : 'pdf'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      setResearchError(language === 'ar' ? 'تعذر تصدير التقرير. حاول مرة أخرى.' : 'Unable to export the report. Please try again.');
    }
  };

  // Compile steps array for AssistantSteps
  const compiledSteps: ResearchStep[] = [
    ...(subqueries.length > 0 ? [{ 
      step: language === 'ar' ? `تفكيك وتوليد ${subqueries.length} استعلامات بحثية متقدمة` : `Generated ${subqueries.length} targeted search queries`, 
      details: subqueries.join(' • ') 
    }] : []),
    ...thoughts.map(t => ({ step: t, details: '' })),
    ...reflections.map(r => ({ 
      step: language === 'ar' ? 'تحليل انعكاسي واكتشاف فجوات المعرفة' : 'Self-Reflection & Gap Discovery', 
      details: r 
    })),
    ...(currentStatus ? [{ step: currentStatus, details: '' }] : [])
  ];

  const currentSources = activeReport?.sources || visitedSources;
  const currentContent = activeReport?.content || liveReport;
  const resolvedTelemetry = resolveReportTelemetry(activeReport, wideTelemetry, wideExpansionHistory);  return (
    <div className="app-shell">
      {/* 1. Left vertical LENS rail (72px) */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onNewResearch={handleNewResearch}
        onOpenSettings={() => setIsSettingsOpen(true)}
        language={language}
        onToggleLanguage={() => setLanguage((l) => (l === 'ar' ? 'en' : 'ar'))}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      {/* 2. Main Content Canvas */}
      <div className="app-content">
      <header className="workspace-header">
        <div className="workspace-location"><span dir="ltr">LENS</span><span className="slash" aria-hidden="true">/</span><strong>{({
          home: language === 'ar' ? 'مساحة البحث' : 'Research workspace',
          discover: language === 'ar' ? 'استكشف' : 'Discover',
          history: language === 'ar' ? 'المكتبة' : 'Library',
          graph: language === 'ar' ? 'خريطة المعرفة' : 'Knowledge graph',
          skills: language === 'ar' ? 'المهارات' : 'Skills',
        })[activeTab]}</strong></div>
        <button className="command-trigger" onClick={() => setIsCommandPaletteOpen(true)} aria-label={language === 'ar' ? 'البحث في الأوامر' : 'Search commands'}><Search size={15} /><span>{language === 'ar' ? 'الأوامر' : 'Commands'}</span><kbd dir="ltr">Ctrl K</kbd></button>
      </header>
      <main className="workspace-main" id="main-content">
        {researchError && <div className="research-alert" role="alert"><p>{researchError}</p><button className="icon-button" onClick={() => setResearchError('')} aria-label={language === 'ar' ? 'إغلاق التنبيه' : 'Dismiss alert'}><X size={16} /></button></div>}
        {/*
          Engine reachability. Previously a dead engine was invisible until the
          first search failed, and the startup failure only reached a console the
          packaged build has no way to show. The banner states the observed
          condition and the address that was probed; it never claims readiness.
        */}
        {!engineHealth.checking && engineHealth.status === 'offline' && (
          <div className="engine-alert" role="status" aria-live="polite">
            <AlertTriangle size={16} aria-hidden="true" />
            <p>
              <strong>{language === 'ar' ? 'محرك البحث غير متاح' : 'Research engine unavailable'}</strong>
              {' — '}
              {ENGINE_ENDPOINT.status === 'failed' && ENGINE_ENDPOINT.error
                ? ENGINE_ENDPOINT.error
                : describeEngineOutage(engineHealth.reason, language, API_BASE)}
              {' '}
              {language === 'ar'
                ? 'لن تعمل طلبات البحث حتى يتوفر المحرك.'
                : 'Research requests cannot run until the engine is available.'}
            </p>
            {/* Only an address that exists is named. A startup failure has none,
                and an empty hint would read as a gap in the message. */}
            {API_BASE && <span className="engine-alert-hint" dir="ltr">{API_BASE}</span>}
          </div>
        )}
        {activeTab === 'home' && (
          <LensHarnessWorkspace
            language={language}
            query={query}
            setQuery={setQuery}
            settings={settings}
            loading={isSearching}
            optimizationMode={optimizationMode}
            setOptimizationMode={setOptimizationMode}
            sourceFocus={sourceFocus}
            setSourceFocus={setSourceFocus}
            researchMode={researchMode}
            setResearchMode={setResearchMode}
            currentQuery={currentQuery || activeReport?.query || ''}
            currentStatus={currentStatus}
            researchError={researchError}
            report={currentContent}
            sources={currentSources}
            steps={compiledSteps}
            plan={activeReport?.plan || proposedPlan}
            graphNodes={activeReport?.graphNodes || graphNodes}
            thoughts={thoughts}
            subqueries={subqueries}
            agents={agents}
            agentEventCount={agentEventCount}
            history={history}
            wideTelemetry={resolvedTelemetry.wideTelemetry}
            wideExpansionHistory={resolvedTelemetry.wideExpansionHistory}
            agentRunFeed={agentRunFeed}
            conversationProjection={conversationProjection}
            onStartAgentRun={handleStartAgentRun}
            onStartDeepResearch={handleStartResearch}
            onSteerAgentRun={handleSteerAgentRun}
            onCancelAgentRun={handleCancelAgentRun}
            onNewResearch={handleNewResearch}
            onSelectReport={(report) => {
              if (isSearching) return;
              setActiveReport(report);
              setCurrentQuery(report.query);
              setQuery(report.query);
              setCurrentStatus('');
              setResearchError('');
              setThoughts([]);
              setSubqueries([]);
              setVisitedSources([]);
              setReflections(report.reflections || []);
              setGraphNodes(report.graphNodes || []);
              setAgents([]);
              setAgentEventCount(0);
              setLiveReport(report.content || '');
              liveReportRef.current = report.content || '';
              setWideTelemetry(report.wideTelemetry || null);
              setWideExpansionHistory(report.wideExpansionHistory || []);
              setProposedPlan(null);
              setIsPlanModalOpen(false);
              // Replaying a saved run restores its persisted conversation too —
              // the inspector's conversation tab replays what happened.
              try {
                const rawConversations = localStorage.getItem('lens-agentic-conversations');
                const conversations = rawConversations ? JSON.parse(rawConversations) : {};
                setConversationProjection(conversations[report.id] ?? null);
              } catch {
                setConversationProjection(null);
              }
            }}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onExport={handleExport}
          />
        )}

        {activeTab === 'discover' && (
          <DiscoverView
            onSelectTopic={(topicQuery) => {
              setQuery(topicQuery);
              handleStartResearch(topicQuery);
            }}
            language={language}
            apiBase={API_BASE}
          />
        )}

        {activeTab === 'history' && (
          <LibraryView
            history={history.map(h => ({
              id: h.id,
              query: h.query,
              report: h.content,
              timestamp: h.createdAt,
              sources: h.sources
            }))}
            onSelectReport={(item) => {
              const matched = history.find(h => h.id === item.id);
              if (matched) {
                setActiveReport(matched);
                setCurrentQuery(matched.query);
                setActiveTab('home');
                // Replay the Agentic Conversation from the history rail (#144):
                // the persisted projection only — absent stays absent.
                try {
                  const rawConversations = localStorage.getItem('lens-agentic-conversations');
                  const conversations = rawConversations ? JSON.parse(rawConversations) : {};
                  setConversationProjection(conversations[matched.id] ?? null);
                } catch {
                  setConversationProjection(null);
                }
              }
            }}
            onClearHistory={() => {
              setHistory([]);
              localStorage.removeItem('deep_research_history');
              localStorage.removeItem('lens-agentic-conversations');
              setConversationProjection(null);
            }}
            language={language}
            onNewResearch={handleNewResearch}
          />
        )}

        {activeTab === 'graph' && (
          <GraphView
            graphNodes={activeReport?.graphNodes || graphNodes}
            query={currentQuery || activeReport?.query || ''}
            loading={isSearching}
            language={language}
          />
        )}

        {activeTab === 'skills' && (
          <SkillsManagerView
            language={language}
            apiBase={API_BASE}
            activeSkillNames={isSearching && activeReport?.plan?.suggestedSkills ? activeReport.plan.suggestedSkills : []}
            selectedSkillNames={proposedPlan?.suggestedSkills || activeReport?.plan?.suggestedSkills || []}
          />
        )}
      </main>
      </div>

      {/* 3. Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={saveSettings}
        language={language}
        apiBase={API_BASE}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        language={language}
        onNewResearch={handleNewResearch}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleLanguage={() => setLanguage((l) => (l === 'en' ? 'ar' : 'en'))}
        onExport={handleExport}
        hasActiveReport={Boolean(activeReport)}
        settings={settings}
        onUpdateSettings={saveSettings}
      />

      {proposedPlan && (
        <PlanApprovalModal
          isOpen={isPlanModalOpen}
          language={language}
          plan={proposedPlan}
          mode={researchMode}
          onApprove={handleApprovePlan}
          onRegenerate={handleRegeneratePlan}
          onDiscard={handleDiscardPlan}
          isRegenerating={isRegeneratingPlan}
        />
      )}
    </div>
  );
}
