import React, { useMemo, useState } from 'react';
import { Compass, FolderOpen, GitBranch, History, Plus, Search, Settings, Sparkles } from 'lucide-react';
import { BrandLogo } from '../brand/BrandLogo';
import type { Language, ReportData } from '../../types';

interface ChatSidebarProps {
  language: Language;
  history: ReportData[];
  activeId: string | null;
  loading: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNewResearch: () => void;
  onSelectReport: (report: ReportData) => void;
  onSelectTab: (tab: 'discover' | 'history' | 'graph' | 'skills') => void;
  onOpenSettings: () => void;
  activeTab: string;
}

/**
 * ChatSidebar — ChatGPT-style navigation. Real saved sessions grouped by
 * recency, compact local-history search, secondary destinations below the
 * fold. Collapses to 64px; on mobile it becomes a slide-over drawer owned
 * by ChatShell.
 */
export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  language,
  history,
  activeId,
  loading,
  collapsed,
  onToggleCollapse,
  onNewResearch,
  onSelectReport,
  onSelectTab,
  onOpenSettings,
  activeTab,
}) => {
  const ar = language === 'ar';
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) => h.query.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)
    );
  }, [history, filter]);
  const { today, yesterday } = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const t: ReportData[] = [];
    const y: ReportData[] = [];
    const older: ReportData[] = [];
    for (const h of filtered) {
      const ts = Date.parse(h.createdAt || '') || 0;
      if (ts >= startOfToday) t.push(h);
      else if (ts >= startOfYesterday) y.push(h);
      else older.push(h);
    }
    return { today: t, yesterday: [...y, ...older] };
  }, [filtered]);

  const renderRow = (item: ReportData) => {
    const title = (item.title || item.query || '').trim() || (ar ? 'بحث بدون عنوان' : 'Untitled research');
    const active = item.id === activeId;
    return (
      <li key={item.id}>
        <button
          type="button"
          disabled={loading}
          aria-current={active ? 'page' : undefined}
          className={`chat-history-row${active ? ' is-active' : ''}`}
          onClick={() => onSelectReport(item)}
          title={item.query}
        >
          <span className="chat-history-title">{title}</span>
        </button>
      </li>
    );
  };

  return (
    <aside
      className={`chat-sidebar${collapsed ? ' is-collapsed' : ''}`}
      aria-label={ar ? 'التنقل والمحادثات' : 'Navigation and conversations'}
      data-testid="chat-sidebar"
    >
      <div className="chat-sidebar-top">
        <button type="button" className="chat-brand" onClick={onNewResearch} aria-label={ar ? 'LENS — بحث جديد' : 'LENS — New research'}>
          <BrandLogo />
        </button>
        <button
          type="button"
          className="chat-new"
          onClick={onNewResearch}
          aria-label={ar ? 'بحث جديد' : 'New research'}
          title={ar ? 'بحث جديد (Ctrl+N)' : 'New research (Ctrl+N)'}
        >
          <Plus size={16} aria-hidden="true" />
          {!collapsed && <span>{ar ? 'بحث جديد' : 'New Research'}</span>}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="chat-history-search">
            <Search size={13} aria-hidden="true" />
            <label className="sr-only" htmlFor="chat-history-filter">{ar ? 'البحث في السجل' : 'Search history'}</label>
            <input
              id="chat-history-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={ar ? 'البحث في المحادثات…' : 'Search conversations…'}
            />
          </div>

          <nav className="chat-history" aria-label={ar ? 'سجل المحادثات' : 'Conversation history'}>
            {filtered.length === 0 ? (
              <p className="chat-history-empty">
                {history.length === 0
                  ? (ar ? 'ستظهر الأبحاث المحفوظة هنا.' : 'Saved research will appear here.')
                  : (ar ? 'لا نتائج مطابقة.' : 'No matching conversations.')}
              </p>
            ) : (
              <>
                {today.length > 0 && (
                  <section aria-labelledby="chat-today">
                    <h2 id="chat-today" className="chat-history-group"><History size={12} aria-hidden="true" />{ar ? 'اليوم' : 'Today'}</h2>
                    <ol className="chat-history-list">{today.map(renderRow)}</ol>
                  </section>
                )}
                {yesterday.length > 0 && (
                  <section aria-labelledby="chat-earlier">
                    <h2 id="chat-earlier" className="chat-history-group">{ar ? 'السابق' : 'Previous'}</h2>
                    <ol className="chat-history-list">{yesterday.map(renderRow)}</ol>
                  </section>
                )}
              </>
            )}
          </nav>

          <nav className="chat-secondary" aria-label={ar ? 'وجهات المنتج' : 'Product destinations'}>
            <button type="button" className={activeTab === 'discover' ? 'is-active' : ''} onClick={() => onSelectTab('discover')}>
              <Compass size={14} aria-hidden="true" /><span>{ar ? 'استكشف' : 'Discover'}</span>
            </button>
            <button type="button" className={activeTab === 'history' ? 'is-active' : ''} onClick={() => onSelectTab('history')}>
              <FolderOpen size={14} aria-hidden="true" /><span>{ar ? 'المكتبة' : 'Library'}</span>
            </button>
            <button type="button" className={activeTab === 'graph' ? 'is-active' : ''} onClick={() => onSelectTab('graph')}>
              <GitBranch size={14} aria-hidden="true" /><span>{ar ? 'الخريطة' : 'Graph'}</span>
            </button>
            <button type="button" className={activeTab === 'skills' ? 'is-active' : ''} onClick={() => onSelectTab('skills')}>
              <Sparkles size={14} aria-hidden="true" /><span>{ar ? 'المهارات' : 'Skills'}</span>
            </button>
          </nav>

          <div className="chat-sidebar-foot">
            <button type="button" onClick={onOpenSettings}>
              <Settings size={14} aria-hidden="true" /><span>{ar ? 'الإعدادات' : 'Settings'}</span>
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={ar ? 'طي الشريط الجانبي' : 'Collapse sidebar'}
            >
              <span aria-hidden="true">⟨⟩</span>
            </button>
          </div>
        </>
      )}
      {collapsed && (
        <div className="chat-sidebar-collapsed-actions">
          <button type="button" onClick={onToggleCollapse} aria-label={ar ? 'توسيع الشريط الجانبي' : 'Expand sidebar'}>
            <span aria-hidden="true">⟨⟩</span>
          </button>
        </div>
      )}
    </aside>
  );
};
