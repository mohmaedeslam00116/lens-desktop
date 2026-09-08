import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Sidebar } from './components/vane/Sidebar';
import { EmptyChat } from './components/vane/EmptyChat';
import { MessageBox } from './components/vane/MessageBox';
import { MessageInput } from './components/vane/MessageInput';
import { DiscoverView } from './components/vane/DiscoverView';
import { LibraryView } from './components/vane/LibraryView';
import { GraphView } from './components/vane/GraphView';
import { SettingsModal } from './components/SettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { PlanApprovalModal } from './components/research/PlanApprovalModal';
import { 
  Language, 
  ResearchDepth, 
  ResearchPerspective, 
  ResearchGraphNode, 
  ReportData, 
  ApiSettings, 
  SourceItem,
  ResearchStep,
  ResearchPlan
} from './types';

const API_BASE = 'http://127.0.0.1:8000';
const WS_BASE = 'ws://127.0.0.1:8000';

const DEFAULT_SETTINGS: ApiSettings = {
  search_provider: 'duckduckgo',
  llm_provider: 'gemini',
  model_name: '',
  ollama_endpoint: 'http://localhost:11434',
  embedding: {
    enabled: true,
    provider: 'gemini',
    model_name: 'text-embedding-004',
    use_chat_key: true,
    endpoint: 'http://localhost:11434'
  },
  keys: {
    openai: '',
    gemini: '',
    anthropic: '',
    groq: '',
    deepseek: '',
    tavily: '',
    serper: '',
  }
};

export function App() {
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem('lens_language') === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('lens_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const [researchError, setResearchError] = useState('');
  const [activeTab, setActiveTab] = useState<'home' | 'discover' | 'history' | 'graph'>('home');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Search Engine Parameters
  const [query, setQuery] = useState('');
  const [optimizationMode, setOptimizationMode] = useState<'speed' | 'balanced' | 'quality'>('quality');
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
  
  // Collaborative Plan Scoping (Tracer 4)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [proposedPlan, setProposedPlan] = useState<ResearchPlan | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isRegeneratingPlan, setIsRegeneratingPlan] = useState(false);

  // Local storage & Settings
  const [history, setHistory] = useState<ReportData[]>([]);
  const [settings, setSettings] = useState<ApiSettings>(DEFAULT_SETTINGS);

  const wsRef = useRef<WebSocket | null>(null);

  // Direction sync
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    try { localStorage.setItem('lens_language', language); } catch { /* Preferences are optional. */ }
  }, [language]);

  // Theme sync
  useEffect(() => {
    try { localStorage.setItem('lens_theme', theme); } catch { /* Preferences are optional. */ }
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Load history & settings
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('deep_research_history');
      if (savedHistory) setHistory(JSON.parse(savedHistory));

      const savedSettings = localStorage.getItem('deep_research_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (!parsed.embedding) {
          const provider = (parsed.llm_provider === 'openai' ? 'openai' : parsed.llm_provider === 'ollama' ? 'ollama' : 'gemini');
          const defaultModel = provider === 'gemini' ? 'text-embedding-004' : provider === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text';
          parsed.embedding = {
            enabled: true,
            provider,
            model_name: defaultModel,
            use_chat_key: true,
            endpoint: parsed.ollama_endpoint || 'http://localhost:11434'
          };
        }
        setSettings(parsed);
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

  const handleNewResearch = () => {
    setResearchError('');
    setActiveReport(null);
    setCurrentQuery('');
    setQuery('');
    setCurrentStatus('');
    setThoughts([]);
    setSubqueries([]);
    setVisitedSources([]);
    setReflections([]);
    setGraphNodes([]);
    setProposedPlan(null);
    setIsPlanModalOpen(false);
    setIsRegeneratingPlan(false);
    setActiveSessionId(null);
    setActiveTab('home');
  };

  const handleStartResearch = async (searchQuery: string) => {
    if (!searchQuery.trim() || isSearching) return;

    const activeKey = (settings.keys[settings.llm_provider as keyof typeof settings.keys] || '').trim();
    if (settings.llm_provider !== 'ollama' && !activeKey) {
      setIsSettingsOpen(true);
      return;
    }

    const trimmed = searchQuery.trim();
    setResearchError('');
    setCurrentQuery(trimmed);
    setProposedPlan(null);
    setIsPlanModalOpen(false);
    setIsRegeneratingPlan(false);
    setActiveSessionId(null);
    setIsSearching(true);
    setActiveTab('home');
    setActiveReport(null);
    setCurrentStatus(language === 'ar' ? 'جاري بدء استكشاف الموضوع وتوليد الاستعلامات...' : 'Initiating autonomous research...');
    setThoughts([]);
    setSubqueries([]);
    setVisitedSources([]);
    setReflections([]);
    setGraphNodes([]);

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
        body: JSON.stringify({
          query: effectiveQuery,
          report_type: depth,
          perspective,
          language,
          search_provider: settings.search_provider,
          llm_provider: settings.llm_provider,
          model_name: settings.custom_model_name || settings.model_name || undefined,
          api_keys: settings.keys,
          ollama_endpoint: settings.ollama_endpoint,
          embedding_provider: settings.embedding?.provider,
          embedding_model: settings.embedding?.custom_model_name || settings.embedding?.model_name,
          embedding_api_key: settings.embedding?.use_chat_key !== false
            ? (settings.keys[settings.embedding?.provider as keyof typeof settings.keys] || settings.embedding?.api_key)
            : settings.embedding?.api_key,
          embedding_endpoint: settings.embedding?.endpoint || settings.ollama_endpoint,
          embedding_enabled: settings.embedding?.enabled,
        }),
      });

      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json();
      const sessionId = data.session_id;
      setActiveSessionId(sessionId);

      const ws = new WebSocket(`${WS_BASE}/ws/research/${sessionId}`);
      wsRef.current = ws;

      let accumulatedSources: SourceItem[] = [];

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'plan_proposed' || payload.type === 'plan_created') {
            if (payload.plan) {
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
          } else if (payload.type === 'finished') {
            const formattedSources = (payload.sources || []).map((s: any) => {
              if (typeof s === 'string') return { url: s, title: s, credibilityScore: 85 };
              return s;
            });

            const finalReport: ReportData = {
              id: sessionId,
              query: trimmed,
              title: trimmed,
              content: payload.report || '',
              sources: formattedSources.length > 0 ? formattedSources : accumulatedSources,
              depth,
              perspective,
              plan: payload.plan || proposedPlan || undefined,
              graphNodes,
              reflections: payload.reflections || reflections,
              createdAt: new Date().toISOString(),
              costs: payload.costs || 0.0,
              language,
            };

            setActiveReport(finalReport);
            setIsSearching(false);

            setHistory((prev) => {
              const updated = [finalReport, ...prev.filter((p) => p.id !== finalReport.id).slice(0, 49)];
              localStorage.setItem('deep_research_history', JSON.stringify(updated));
              return updated;
            });

            ws.close();
          } else if (payload.type === 'error') {
            setCurrentStatus(payload.message || 'Error occurred');
            setResearchError(payload.message || (language === 'ar' ? 'تعذر إكمال البحث. يمكنك المحاولة مجددًا.' : 'Research could not finish. Please try again.'));
            setIsSearching(false);
            ws.close();
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setResearchError(language === 'ar' ? 'انقطع اتصال البحث. تحقق من تشغيل التطبيق ثم أعد المحاولة.' : 'Research connection lost. Check that the desktop app is running, then try again.');
        setIsSearching(false);
      };
    } catch (err: any) {
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
    setIsPlanModalOpen(false);
    setCurrentStatus(language === 'ar' ? 'تم اعتماد الخطة. جاري استرجاع المصادر...' : 'Plan authorized. Beginning wide retrieval...');
    await sendPlanAction('plan_approved', { plan: approvedPlan }, '/api/research/plan/approve');
  };

  const handleRegeneratePlan = async (modifier?: string) => {
    setIsRegeneratingPlan(true);
    await sendPlanAction('plan_regenerate', { modifier }, '/api/research/plan/regenerate');
  };

  const handleDiscardPlan = async (reason?: string) => {
    setIsPlanModalOpen(false);
    setIsSearching(false);
    setCurrentStatus(language === 'ar' ? 'تم إلغاء خطة البحث.' : 'Research plan discarded.');
    await sendPlanAction('plan_rejected', { reason: reason || 'User discarded plan' }, '/api/research/plan/reject');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
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
        }),
      });

      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Research_Report_${Date.now()}.${format === 'docx' ? 'docx' : 'pdf'}`;
      a.click();
    } catch (err) {
      console.error('Export error:', err);
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
  const currentContent = activeReport?.content || '';

  return (
    <div className="app-shell">
      {/* 1. Left Vertical Vane Sidebar (72px) */}
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
        })[activeTab]}</strong></div>
        <button className="command-trigger" onClick={() => setIsCommandPaletteOpen(true)} aria-label={language === 'ar' ? 'البحث في الأوامر' : 'Search commands'}><Search size={15} /><span>{language === 'ar' ? 'الأوامر' : 'Commands'}</span><kbd dir="ltr">Ctrl K</kbd></button>
      </header>
      <main className="workspace-main" id="main-content">
        {researchError && <div className="research-alert" role="alert"><p>{researchError}</p><button className="icon-button" onClick={() => setResearchError('')} aria-label={language === 'ar' ? 'إغلاق التنبيه' : 'Dismiss alert'}><X size={16} /></button></div>}
        {activeTab === 'home' && (
          <>
            {!activeReport && !isSearching ? (
              <EmptyChat
                query={query}
                setQuery={setQuery}
                onSubmit={() => {
                  handleStartResearch(query);
                }}
                loading={isSearching}
                language={language}
                settings={settings}
                onOpenSettings={() => setIsSettingsOpen(true)}
                optimizationMode={optimizationMode}
                setOptimizationMode={setOptimizationMode}
                sourceFocus={sourceFocus}
                setSourceFocus={setSourceFocus}
              />
            ) : (
              <div className="flex-1 flex flex-col justify-between pb-8">
                <MessageBox
                  query={currentQuery || activeReport?.query || ''}
                  report={currentContent}
                  sources={currentSources}
                  steps={compiledSteps}
                  loading={isSearching}
                  language={language}
                  plan={activeReport?.plan || proposedPlan}
                  onExport={handleExport}
                  onFollowUp={(q) => handleStartResearch(q)}
                />

                {/* Docked Follow-up input bar */}
                <MessageInput
                  onSendMessage={(msg) => handleStartResearch(msg)}
                  loading={isSearching}
                  language={language}
                />
              </div>
            )}
          </>
        )}

        {activeTab === 'discover' && (
          <DiscoverView
            onSelectTopic={(topicQuery) => {
              setQuery(topicQuery);
              handleStartResearch(topicQuery);
            }}
            language={language}
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
              }
            }}
            onClearHistory={() => {
              setHistory([]);
              localStorage.removeItem('deep_research_history');
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
      </main>
      </div>

      {/* 3. Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={saveSettings}
        language={language}
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
          onApprove={handleApprovePlan}
          onRegenerate={handleRegeneratePlan}
          onDiscard={handleDiscardPlan}
          isRegenerating={isRegeneratingPlan}
        />
      )}
    </div>
  );
}
