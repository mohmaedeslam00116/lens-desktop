import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Clock, 
  Settings, 
  Globe, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  Compass, 
  Command, 
  FileText, 
  Radio,
  SlidersHorizontal,
  FolderOpen
} from 'lucide-react';
import { Language, ReportData, ApiSettings } from '../types';
import { translations } from '../i18n/translations';

interface SidebarProps {
  language: Language;
  onToggleLanguage: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  onNewResearch: () => void;
  history: ReportData[];
  activeReportId: string | null;
  onSelectReport: (report: ReportData) => void;
  onDeleteReport: (id: string) => void;
  isBackendOnline: boolean;
  settings: ApiSettings;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  language,
  onToggleLanguage,
  onOpenSettings,
  onOpenCommandPalette,
  onNewResearch,
  history,
  activeReportId,
  onSelectReport,
  onDeleteReport,
  isBackendOnline,
  settings,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [filter, setFilter] = useState('');
  const t = translations[language];

  const filteredHistory = history.filter((item) =>
    item.query.toLowerCase().includes(filter.toLowerCase()) ||
    item.title.toLowerCase().includes(filter.toLowerCase())
  );

  // Group by Today, This Week, Earlier
  const now = new Date();
  const todayItems: ReportData[] = [];
  const earlierItems: ReportData[] = [];

  filteredHistory.forEach((item) => {
    const itemDate = new Date(item.createdAt);
    const diffDays = (now.getTime() - itemDate.getTime()) / (1000 * 3600 * 24);
    if (diffDays <= 1) {
      todayItems.push(item);
    } else {
      earlierItems.push(item);
    }
  });

  return (
    <aside
      className={`h-screen flex flex-col bg-obsidian-panel border-r border-obsidian-border transition-all duration-300 z-20 flex-shrink-0 select-none ${
        isCollapsed ? 'w-16' : 'w-72'
      }`}
    >
      {/* Top Brand Bar */}
      <div className="p-3.5 border-b border-obsidian-border flex items-center justify-between">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-glow-blue border border-white/10">
            <Compass className="w-4 h-4 text-white animate-spin-slow" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-xs tracking-tight text-slate-100 truncate">
                {t.app_title}
              </span>
              <span className="text-[10px] text-slate-400 font-mono truncate">
                Agent Studio 2.0
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-obsidian-surface transition"
          title={isCollapsed ? "توسيع الشريط" : "طي الشريط"}
        >
          {isCollapsed ? (
            language === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : (
            language === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Action Buttons: New Research & Command Palette */}
      <div className="p-3 space-y-2 border-b border-obsidian-borderSubtle">
        <button
          onClick={onNewResearch}
          className={`w-full flex items-center gap-2.5 py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition active:scale-95 ${
            isCollapsed ? 'justify-center px-0' : 'justify-between'
          }`}
          title="بدء بحث عميق جديد"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 flex-shrink-0" />
            {!isCollapsed && <span>بحث جديد</span>}
          </div>
          {!isCollapsed && (
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono rounded bg-blue-700/50 text-blue-200 border border-blue-400/20">
              Ctrl+N
            </kbd>
          )}
        </button>

        {!isCollapsed && (
          <button
            onClick={onOpenCommandPalette}
            className="w-full flex items-center justify-between py-1.5 px-3 rounded-lg bg-obsidian-surface hover:bg-obsidian-subtle text-slate-400 hover:text-slate-200 text-xs border border-obsidian-border transition"
            title="لوحة الأوامر السريعة"
          >
            <div className="flex items-center gap-2">
              <Command className="w-3.5 h-3.5 text-slate-400" />
              <span>لوحة الأوامر</span>
            </div>
            <kbd className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-slate-800 text-slate-400 border border-slate-700">
              Ctrl+K
            </kbd>
          </button>
        )}
      </div>

      {/* History Search Filter */}
      {!isCollapsed && (
        <div className="px-3 pt-3">
          <div className="relative flex items-center">
            <Search className={`w-3.5 h-3.5 text-slate-400 absolute ${language === 'ar' ? 'right-2.5' : 'left-2.5'}`} />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="البحث في الأبحاث السابقة..."
              className={`w-full bg-obsidian-base border border-obsidian-border rounded-lg py-1 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/80 transition ${
                language === 'ar' ? 'pr-8 pl-2' : 'pl-8 pr-2'
              }`}
            />
          </div>
        </div>
      )}

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {filteredHistory.length === 0 ? (
          <div className="text-center py-10 px-2 text-slate-400 text-[11px]">
            {!isCollapsed && <p>{t.history_empty}</p>}
          </div>
        ) : (
          <>
            {todayItems.length > 0 && (
              <div>
                {!isCollapsed && (
                  <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    اليوم
                  </div>
                )}
                <div className="space-y-1">
                  {todayItems.map((item) => (
                    <HistoryItemRow
                      key={item.id}
                      item={item}
                      isActive={item.id === activeReportId}
                      isCollapsed={isCollapsed}
                      onSelect={() => onSelectReport(item)}
                      onDelete={() => onDeleteReport(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {earlierItems.length > 0 && (
              <div>
                {!isCollapsed && (
                  <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                    سابقاً
                  </div>
                )}
                <div className="space-y-1">
                  {earlierItems.map((item) => (
                    <HistoryItemRow
                      key={item.id}
                      item={item}
                      isActive={item.id === activeReportId}
                      isCollapsed={isCollapsed}
                      onSelect={() => onSelectReport(item)}
                      onDelete={() => onDeleteReport(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Status & Control Dock */}
      <div className="p-3 border-t border-obsidian-border bg-obsidian-base/50 space-y-2">
        {/* Backend health & Provider Indicator */}
        {!isCollapsed && (
          <div className="flex items-center justify-between text-[10px] text-slate-400 pb-2 border-b border-obsidian-borderSubtle">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isBackendOnline ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              <span>{isBackendOnline ? 'محرك البحث نشط' : 'جاري الاتصال...'}</span>
            </div>
            <span className="font-mono text-slate-400 uppercase">
              {settings.search_provider === 'tavily' ? 'Tavily' : 'DuckDuckGo'}
            </span>
          </div>
        )}

        {/* Quick Footer Actions */}
        <div className={`flex items-center gap-1.5 ${isCollapsed ? 'flex-col' : 'justify-between'}`}>
          <button
            onClick={onToggleLanguage}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-obsidian-surface text-[11px] font-medium flex items-center gap-1 transition"
            title="تبديل لغة الواجهة"
          >
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            {!isCollapsed && <span>{language === 'ar' ? 'English' : 'العربية'}</span>}
          </button>

          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-obsidian-surface text-[11px] font-medium flex items-center gap-1 transition"
            title={t.settings_title}
          >
            <Settings className="w-3.5 h-3.5" />
            {!isCollapsed && <span>الإعدادات</span>}
          </button>
        </div>
      </div>
    </aside>
  );
};

interface HistoryItemRowProps {
  item: ReportData;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const HistoryItemRow: React.FC<HistoryItemRowProps> = ({
  item,
  isActive,
  isCollapsed,
  onSelect,
  onDelete
}) => {
  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
        isActive
          ? 'bg-blue-600/15 border border-blue-500/30 text-blue-300'
          : 'text-slate-300 hover:bg-obsidian-surface hover:text-slate-100 border border-transparent'
      }`}
      title={item.title || item.query}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-300'}`} />
        {!isCollapsed && (
          <span className="truncate font-medium text-[11px] leading-tight">
            {item.title || item.query}
          </span>
        )}
      </div>

      {!isCollapsed && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5 rounded transition"
          title="حذف الجلسة"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
