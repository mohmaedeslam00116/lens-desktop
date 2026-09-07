import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  Cpu, 
  Globe, 
  ListFilter, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  X, 
  ExternalLink,
  Radio,
  CheckCircle2,
  CornerDownLeft,
  AtSign,
  ShieldCheck,
  HelpCircle,
  TrendingUp,
  Scale
} from 'lucide-react';
import { Language, SourceItem, ChatMessage, ApiSettings, ResearchGraphNode } from '../../types';

interface CursorComposerProps {
  language: Language;
  isOpen: boolean;
  onClose: () => void;
  isSearching: boolean;
  currentStatus: string;
  currentStep: string;
  subqueries: string[];
  sources: SourceItem[];
  thoughts: string[];
  reflections?: string[];
  chatMessages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isChatLoading: boolean;
  hasActiveReport: boolean;
  settings: ApiSettings;
}

export const CursorComposer: React.FC<CursorComposerProps> = ({
  language,
  isOpen,
  onClose,
  isSearching,
  currentStatus,
  currentStep,
  subqueries,
  sources,
  thoughts,
  reflections = [],
  chatMessages,
  onSendMessage,
  isChatLoading,
  hasActiveReport,
  settings,
}) => {
  const [chatInput, setChatInput] = useState('');
  const [showThoughts, setShowThoughts] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading, thoughts, reflections]);

  if (!isOpen) return null;

  const handleSendChat = (e?: React.FormEvent, textOverride?: string) => {
    if (e) e.preventDefault();
    const queryToSend = textOverride || chatInput;
    if (!queryToSend.trim() || isChatLoading) return;
    onSendMessage(queryToSend.trim());
    if (!textOverride) setChatInput('');
  };

  const getModelLabel = () => {
    if (settings.model_name) return settings.model_name;
    return language === 'ar' ? 'لم يُحدد نموذج' : 'No model';
  };

  const quickChatPills = [
    { label: "قارن بين الحلول الرئيسية في جدول", prompt: "من فضلك قم بإعداد جدول مقارنة شامل بين الحلول والتقنيات المذكورة في التقرير مع توضيح المزايا والعيوب." },
    { label: "أبرز المخاطر والقيود", prompt: "ما هي أبرز القيود الفنية والمخاطر أو نقاط الضعف التي كشف عنها هذا البحث؟" },
    { label: "أهم 3 توصيات تنفيذية", prompt: "لخص لي أهم 3 توصيات تنفيذية عملية لصناع القرار مستخلصة مباشرة من هذا التقرير." }
  ];

  return (
    <aside className="w-96 h-full bg-vscode-sidebar border-l border-vscode-border flex flex-col select-none text-xs flex-shrink-0 z-20">
      {/* 1. Composer Top Bar */}
      <div className="h-[35px] px-3 flex items-center justify-between border-b border-vscode-border bg-[#161616]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[11px] font-semibold text-vscode-textActive uppercase tracking-wider">
            {language === 'ar' ? 'المؤلف الذكي (COMPOSER)' : 'COMPOSER'}
          </span>
          <span className={`w-2 h-2 rounded-full ${
            isSearching ? 'bg-blue-400 animate-ping' : hasActiveReport ? 'bg-emerald-400' : 'bg-slate-600'
          }`} />
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-1 rounded text-vscode-textMuted hover:text-vscode-textActive hover:bg-vscode-hover transition"
            title={language === 'ar' ? 'إغلاق اللوحة (Ctrl+I)' : 'Close Composer (Ctrl+I)'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Context Pills Bar (Cursor Style) */}
      <div className="px-3 py-1.5 border-b border-vscode-border bg-[#141414] flex items-center gap-1.5 overflow-x-auto text-[10px]">
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
          <AtSign className="w-2.5 h-2.5" />
          <span>WebSearch</span>
        </span>
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">
          <AtSign className="w-2.5 h-2.5" />
          <span>{getModelLabel()}</span>
        </span>
        {hasActiveReport && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
            <AtSign className="w-2.5 h-2.5" />
            <span>ReportDoc</span>
          </span>
        )}
      </div>

      {/* 3. Main Stream Body: The Cursor Vertical Guide Rail */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Live Execution Tree Rail */}
        {(isSearching || thoughts.length > 0 || subqueries.length > 0 || sources.length > 0) && (
          <div className="space-y-3">
            <div className="text-[10px] font-semibold text-vscode-textMuted uppercase tracking-wider flex items-center justify-between">
              <span>{language === 'ar' ? 'مسار استدلال الوكيل' : 'AGENT EXECUTION RAIL'}</span>
              <span className="font-mono text-blue-400">
                {isSearching ? 'RUNNING...' : hasActiveReport ? 'FINISHED' : 'IDLE'}
              </span>
            </div>

            {/* Vertical Guide Line */}
            <div className="relative pl-3 border-l border-zinc-700/60 ml-2 space-y-3.5">
              {/* Node 1: Current Status */}
              <div className="relative">
                <div className={`absolute -left-[17px] top-1 w-2 h-2 rounded-full ring-2 ring-vscode-sidebar ${
                  isSearching ? 'bg-blue-400 animate-pulse' : 'bg-emerald-400'
                }`} />
                <div className="text-[11.5px] text-vscode-textNormal font-medium">
                  {currentStatus || (isSearching ? 'بدء تشغيل وكيل البحث وتوليد الاستعلامات...' : 'اكتمل البحث وتوليد التقرير الموثق.')}
                </div>
              </div>

              {/* Node 2: Subqueries Generated */}
              {subqueries.length > 0 && (
                <div className="relative">
                  <div className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-indigo-400 ring-2 ring-vscode-sidebar" />
                  <div className="text-[11px] font-semibold text-vscode-textNormal mb-1.5 flex items-center gap-1.5">
                    <ListFilter className="w-3 h-3 text-indigo-400" />
                    <span>الأسئلة البحثية المقسمة ({subqueries.length})</span>
                  </div>
                  <div className="space-y-1">
                    {subqueries.map((q, idx) => (
                      <div
                        key={idx}
                        className="p-1.5 rounded bg-vscode-input border border-vscode-border text-[10.5px] text-vscode-textNormal leading-tight font-mono"
                      >
                        {idx + 1}. {q}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Node 3: Visited Web Sources with Credibility Score */}
              {sources.length > 0 && (
                <div className="relative">
                  <div className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-vscode-sidebar" />
                  <div className="text-[11px] font-semibold text-vscode-textNormal mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Globe className="w-3 h-3 text-emerald-400" />
                      <span>المصادر المستكشفة ({sources.length})</span>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {sources.map((src, idx) => (
                      <a
                        key={idx}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-1.5 rounded bg-vscode-input border border-vscode-border hover:border-slate-600 transition group text-[10.5px] text-vscode-textNormal"
                      >
                        <span className="truncate group-hover:text-blue-400 font-mono">
                          {src.domain || src.title || src.url}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                          <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded">
                            {src.credibility || 80}%
                          </span>
                          <ExternalLink className="w-3 h-3 text-vscode-textMuted group-hover:text-blue-400" />
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Node 4: Reflection & Gap Discovery (Open Deep Research) */}
              {reflections.length > 0 && (
                <div className="relative">
                  <div className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-vscode-sidebar" />
                  <div className="text-[11px] font-semibold text-amber-400 mb-1 flex items-center gap-1.5">
                    <ShieldCheck className="w-3 h-3 text-amber-400" />
                    <span>تدقيق الفجوات والتحقق الذاتي (Self-Reflection)</span>
                  </div>
                  <div className="p-2 rounded bg-amber-500/5 border border-amber-500/20 text-[10.5px] text-vscode-textNormal space-y-1">
                    {reflections.map((r, i) => (
                      <div key={i} className="leading-snug">
                        • {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Node 5: Collapsible Thoughts Stream */}
              {thoughts.length > 0 && (
                <div className="relative">
                  <div className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-purple-400 ring-2 ring-vscode-sidebar" />
                  <button
                    onClick={() => setShowThoughts(!showThoughts)}
                    className="flex items-center justify-between w-full text-[11px] font-semibold text-vscode-textMuted hover:text-vscode-textNormal transition"
                  >
                    <div className="flex items-center gap-1">
                      <Cpu className="w-3 h-3 text-purple-400" />
                      <span>مسار التفكير اللحظي ({thoughts.length})</span>
                    </div>
                    {showThoughts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>

                  {showThoughts && (
                    <div className="mt-1.5 p-2 rounded bg-vscode-input border border-vscode-border space-y-1 font-mono text-[10px] max-h-36 overflow-y-auto">
                      {thoughts.map((th, idx) => (
                        <div key={idx} className="text-vscode-textNormal leading-snug">
                          <span className="text-vscode-textMuted select-none mr-1.5">[{idx + 1}]</span>
                          {th}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. Follow-up Chat Feed (Cursor Chat Style) */}
        {hasActiveReport && (
          <div className="pt-2 border-t border-vscode-border space-y-3">
            <div className="text-[10px] font-semibold text-vscode-textMuted uppercase tracking-wider">
              {language === 'ar' ? 'المحادثة الاستكمالية مع الوكيل' : 'CHAT WITH REPORT'}
            </div>

            {/* Quick Inspiration Pills */}
            <div className="space-y-1">
              <span className="text-[9.5px] text-vscode-textMuted font-mono">أسئلة استكشافية سريعة:</span>
              <div className="flex flex-col gap-1">
                {quickChatPills.map((pill, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendChat(undefined, pill.prompt)}
                    className="w-full text-left p-1.5 rounded bg-vscode-input border border-vscode-border hover:border-slate-600 hover:text-vscode-textActive transition text-[10.5px] text-vscode-textNormal truncate"
                  >
                    💡 {pill.label}
                  </button>
                ))}
              </div>
            </div>

            {chatMessages.length > 0 && (
              <div className="space-y-2 pt-1">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-2.5 rounded text-xs select-text leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#202020] border border-vscode-border text-vscode-textActive'
                        : 'bg-vscode-input border border-vscode-border text-vscode-textNormal'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-vscode-textMuted mb-1 font-mono">
                      <span>{msg.role === 'user' ? 'YOU' : 'AGENT'}</span>
                      <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                ))}
              </div>
            )}

            {isChatLoading && (
              <div className="p-2 rounded bg-vscode-input border border-vscode-border flex items-center gap-2 text-vscode-textMuted text-[11px]">
                <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                <span>جاري استخراج وتوليف الإجابة من التقرير...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* 5. Cursor Composer Input Box */}
      <div className="p-2.5 border-t border-vscode-border bg-[#141414]">
        <form onSubmit={(e) => handleSendChat(e)} className="space-y-1.5">
          <div className="relative bg-vscode-input border border-vscode-border focus-within:border-vscode-accent rounded p-2 transition">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChat(e);
                }
              }}
              rows={2}
              disabled={isChatLoading || !hasActiveReport}
              placeholder={
                hasActiveReport
                  ? (language === 'ar' ? 'اسأل الوكيل حول التقرير... (Enter)' : 'Ask agent about this report... (Enter)')
                  : (language === 'ar' ? 'ابدأ بحثاً أولاً لتفعيل المحادثة...' : 'Run a research first to chat...')
              }
              className="w-full bg-transparent text-vscode-textActive placeholder:text-vscode-textMuted focus:outline-none resize-none text-xs leading-relaxed disabled:opacity-40"
            />

            <div className="flex items-center justify-between pt-1 text-[10px] text-vscode-textMuted">
              <span className="flex items-center gap-1 font-mono">
                <CornerDownLeft className="w-2.5 h-2.5" />
                <span>Enter لإرسال</span>
              </span>

              <button
                type="submit"
                disabled={!chatInput.trim() || isChatLoading || !hasActiveReport}
                className="p-1 rounded bg-vscode-accent hover:bg-vscode-accentHover text-white disabled:opacity-30 transition"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
};
