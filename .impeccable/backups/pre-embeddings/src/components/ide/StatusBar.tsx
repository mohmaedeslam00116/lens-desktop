import React from 'react';
import { Radio, Bell, Globe, Sparkles, Check, CheckCircle2 } from 'lucide-react';
import { ApiSettings, ReportData, Language } from '../../types';

interface StatusBarProps {
  language?: Language;
  isBackendOnline: boolean;
  settings: ApiSettings;
  activeReport: ReportData | null;
  isSearching: boolean;
  currentStep?: string;
  onOpenSettings: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  language = 'ar',
  isBackendOnline,
  settings,
  activeReport,
  isSearching,
  currentStep,
  onOpenSettings,
}) => {
  const getModelLabel = () => {
    if (settings.model_name) return settings.model_name;
    return language === 'ar' ? 'لم يتم اختيار نموذج' : 'No model selected';
  };

  const wordCount = activeReport 
    ? (activeReport.wordCount || activeReport.content.trim().split(/\s+/).length)
    : 0;

  return (
    <footer className="h-[22px] bg-vscode-statusbar border-t border-vscode-border text-[11px] text-vscode-textMuted flex items-center justify-between px-2 select-none z-30 flex-shrink-0">
      {/* Left side items */}
      <div className="flex items-center gap-3">
        {/* Backend Connection Indicator */}
        <div 
          className="flex items-center gap-1.5 cursor-pointer hover:text-vscode-textActive transition"
          title={isBackendOnline ? 'الخادم المحلي نشط وجاهز' : 'جاري فحص الاتصال بالخادم المحلي'}
        >
          <span className={`w-2 h-2 rounded-full ${isBackendOnline ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className="font-mono text-[10px]">127.0.0.1:8000</span>
        </div>

        {/* Search Retriever */}
        <div className="hidden sm:flex items-center gap-1 hover:text-vscode-textActive cursor-pointer transition">
          <Globe className="w-3 h-3 text-vscode-textMuted" />
          <span className="font-mono text-[10px] uppercase">{settings.search_provider}</span>
        </div>

        {/* Agent Step Status */}
        {isSearching && (
          <div className="flex items-center gap-1.5 text-blue-400 font-mono text-[10px] animate-pulse">
            <Radio className="w-2.5 h-2.5 animate-spin-slow" />
            <span>{currentStep || 'running'}</span>
          </div>
        )}
      </div>

      {/* Right side items */}
      <div className="flex items-center gap-3">
        {/* Document Stats */}
        {activeReport && (
          <div className="hidden md:flex items-center gap-2 text-[10px] font-mono">
            <span>{wordCount} words</span>
            <span>•</span>
            <span>{Math.ceil(wordCount / 200)} min read</span>
          </div>
        )}

        {/* File Format & Encoding */}
        <div className="hidden sm:flex items-center gap-2 text-[10px] font-mono">
          <span>UTF-8</span>
          <span>Markdown</span>
        </div>

        {/* Active LLM Provider */}
        <div 
          onClick={onOpenSettings}
          className="flex items-center gap-1 px-1.5 py-0.2 rounded hover:bg-vscode-hover text-vscode-textNormal hover:text-vscode-textActive cursor-pointer transition text-[10px] font-mono"
          title="تغيير النموذج النشط"
        >
          <Sparkles className="w-2.5 h-2.5 text-blue-400" />
          <span>{getModelLabel()}</span>
        </div>

        {/* Notification Bell */}
        <button 
          className="p-0.5 hover:text-vscode-textActive transition"
          title="الإشعارات"
        >
          <Bell className="w-3 h-3" />
        </button>
      </div>
    </footer>
  );
};
