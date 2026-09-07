import React, { useState, useRef, useEffect } from 'react';
import { 
  Cpu, 
  MessageSquare, 
  Radio, 
  Globe, 
  ExternalLink, 
  ListFilter, 
  ChevronDown, 
  ChevronUp, 
  Send, 
  Bot, 
  User, 
  Loader2, 
  Sparkles,
  Layers,
  CheckCircle2,
  X
} from 'lucide-react';
import { Language, SourceItem, ChatMessage } from '../types';
import { translations } from '../i18n/translations';

interface AgentInspectorProps {
  language: Language;
  isSearching: boolean;
  currentStatus: string;
  currentStep: string;
  subqueries: string[];
  sources: SourceItem[];
  thoughts: string[];
  chatMessages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isChatLoading: boolean;
  hasActiveReport: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export const AgentInspector: React.FC<AgentInspectorProps> = ({
  language,
  isSearching,
  currentStatus,
  currentStep,
  subqueries,
  sources,
  thoughts,
  chatMessages,
  onSendMessage,
  isChatLoading,
  hasActiveReport,
  isOpen,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'radar' | 'chat'>('radar');
  const [chatInput, setChatInput] = useState('');
  const [showThoughts, setShowThoughts] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const t = translations[language];

  // If search starts, auto switch to radar tab
  useEffect(() => {
    if (isSearching) {
      setActiveTab('radar');
    } else if (hasActiveReport && chatMessages.length > 0) {
      setActiveTab('chat');
    }
  }, [isSearching, hasActiveReport]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading]);

  if (!isOpen) return null;

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;
    onSendMessage(chatInput.trim());
    setChatInput('');
  };

  return (
    <aside className="w-80 sm:w-96 h-screen flex flex-col bg-obsidian-panel border-l border-obsidian-border z-20 flex-shrink-0 transition-all select-none">
      {/* Top Tabs */}
      <div className="border-b border-obsidian-border flex items-center justify-between bg-obsidian-base/60 px-3">
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setActiveTab('radar')}
            className={`py-3 px-3 flex items-center gap-2 font-medium border-b-2 transition ${
              activeTab === 'radar'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>رادار الوكيل</span>
            {isSearching && (
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            disabled={!hasActiveReport}
            className={`py-3 px-3 flex items-center gap-2 font-medium border-b-2 transition disabled:opacity-30 disabled:cursor-not-allowed ${
              activeTab === 'chat'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>المساعد الذكي (Copilot)</span>
            {chatMessages.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 text-[10px]">
                {chatMessages.length}
              </span>
            )}
          </button>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-obsidian-surface transition"
          title="إغلاق لوحة التحكم"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab 1: Radar & Telemetry */}
      {activeTab === 'radar' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Status Banner */}
          <div className="p-3.5 rounded-xl bg-obsidian-surface border border-obsidian-border shadow-inset-subtle">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
              <span>حالة الوكيل</span>
              <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] ${
                isSearching 
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse'
                  : hasActiveReport
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {isSearching ? 'جاري البحث' : hasActiveReport ? 'مكتمل' : 'جاهز'}
              </span>
            </div>
            <p className="text-slate-200 font-medium leading-snug">
              {currentStatus || 'في انتظار إطلاق مهمة بحثية جديدة...'}
            </p>
          </div>

          {/* Subqueries Pill Tree */}
          {subqueries.length > 0 && (
            <div className="p-3.5 rounded-xl bg-obsidian-surface border border-obsidian-border space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-300 text-[11px]">
                <ListFilter className="w-3.5 h-3.5 text-indigo-400" />
                <span>الأسئلة الفرعية المولدة ({subqueries.length})</span>
              </div>
              <div className="space-y-1.5">
                {subqueries.map((q, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-obsidian-base/60 border border-obsidian-borderSubtle text-slate-300 text-[11px] flex items-start gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                    <span className="leading-tight">{q}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Explored Sources Cards */}
          {sources.length > 0 && (
            <div className="p-3.5 rounded-xl bg-obsidian-surface border border-obsidian-border space-y-2">
              <div className="flex items-center justify-between font-semibold text-slate-300 text-[11px]">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-emerald-400" />
                  <span>المواقع المستكشفة ({sources.length})</span>
                </div>
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {sources.map((src, idx) => {
                  let domain = src.url;
                  try {
                    domain = new URL(src.url).hostname.replace('www.', '');
                  } catch {}

                  return (
                    <a
                      key={idx}
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-2 rounded-lg bg-obsidian-base/60 border border-obsidian-borderSubtle hover:border-slate-700 transition group text-[11px] text-slate-300"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                          alt=""
                          className="w-3.5 h-3.5 rounded-sm flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                        <span className="truncate group-hover:text-blue-400 transition font-medium">
                          {src.title || domain}
                        </span>
                      </div>
                      <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-blue-400 flex-shrink-0 ml-1.5" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Collapsible Thoughts Trace */}
          {thoughts.length > 0 && (
            <div className="p-3.5 rounded-xl bg-obsidian-surface border border-obsidian-border">
              <div
                onClick={() => setShowThoughts(!showThoughts)}
                className="flex items-center justify-between cursor-pointer text-[11px] font-semibold text-slate-400 hover:text-slate-200"
              >
                <div className="flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span>مسار التفكير اللحظي ({thoughts.length})</span>
                </div>
                {showThoughts ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>

              {showThoughts && (
                <div className="mt-2.5 max-h-48 overflow-y-auto space-y-1 font-mono text-[10px] text-slate-400 border-t border-obsidian-borderSubtle pt-2">
                  {thoughts.map((th, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 py-0.5">
                      <span className="text-slate-600 select-none">[{idx + 1}]</span>
                      <span className="text-slate-300 leading-snug">{th}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Follow-up Copilot Chat */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
            {chatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <Bot className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-xs leading-relaxed max-w-xs">{t.chat_empty}</p>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 text-xs ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded bg-blue-500/10 text-blue-400 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div
                    className={`p-2.5 rounded-xl max-w-[85%] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-obsidian-surface border border-obsidian-border text-slate-200'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))
            )}

            {isChatLoading && (
              <div className="flex gap-2 text-xs items-center text-slate-400">
                <div className="w-6 h-6 rounded bg-blue-500/10 text-blue-400 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="p-2 rounded-xl bg-obsidian-surface border border-obsidian-border flex items-center gap-2 text-[11px]">
                  <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                  <span>جاري قراءة واستخراج الإجابة من التقرير...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendChat} className="p-3 border-t border-obsidian-border bg-obsidian-base/60">
            <div className="relative flex items-center">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isChatLoading}
                placeholder="اطرح استفساراً حول التقرير..."
                className="w-full bg-obsidian-base border border-obsidian-border rounded-xl py-2 px-3.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isChatLoading}
                className="absolute left-2 p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-30 transition"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
};
