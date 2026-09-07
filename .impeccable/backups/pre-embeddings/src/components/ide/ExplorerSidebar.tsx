import React, { useState } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileText, 
  ChevronRight, 
  ChevronDown, 
  Plus, 
  Search, 
  Trash2, 
  Globe, 
  Download, 
  FileDown, 
  MoreHorizontal,
  ExternalLink
} from 'lucide-react';
import { ReportData, Language } from '../../types';

interface ExplorerSidebarProps {
  language: Language;
  history: ReportData[];
  activeReportId: string | null;
  onSelectReport: (report: ReportData) => void;
  onDeleteReport: (id: string) => void;
  onNewResearch: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  activeReport: ReportData | null;
}

export const ExplorerSidebar: React.FC<ExplorerSidebarProps> = ({
  language,
  history,
  activeReportId,
  onSelectReport,
  onDeleteReport,
  onNewResearch,
  onExport,
  activeReport,
}) => {
  const [isSessionsOpen, setIsSessionsOpen] = useState(true);
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const [isArtifactsOpen, setIsArtifactsOpen] = useState(true);
  const [filter, setFilter] = useState('');

  const filteredHistory = history.filter((item) =>
    item.query.toLowerCase().includes(filter.toLowerCase()) ||
    item.title.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <aside className="w-60 h-full bg-vscode-sidebar border-r border-vscode-border flex flex-col select-none text-xs flex-shrink-0 z-10">
      {/* Explorer Header */}
      <div className="h-[35px] px-3 flex items-center justify-between border-b border-vscode-border">
        <span className="text-[11px] font-semibold text-vscode-textMuted uppercase tracking-wider">
          {language === 'ar' ? 'المستكشف' : 'EXPLORER'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onNewResearch}
            className="p-1 rounded text-vscode-textMuted hover:text-vscode-textActive hover:bg-vscode-hover transition"
            title={language === 'ar' ? 'بحث جديد (Ctrl+N)' : 'New Research (Ctrl+N)'}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Search in Explorer */}
      <div className="p-2 border-b border-vscode-border">
        <div className="relative flex items-center">
          <Search className="w-3 h-3 text-vscode-textMuted absolute left-2 pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={language === 'ar' ? 'تصفية الملفات...' : 'Filter files...'}
            className="w-full bg-vscode-input border border-vscode-border rounded py-1 pl-7 pr-2 text-[11px] text-vscode-textNormal placeholder:text-vscode-textMuted focus:outline-none focus:border-vscode-accent transition"
          />
        </div>
      </div>

      {/* Scrollable File Trees */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Section 1: Research Sessions */}
        <div>
          <button
            onClick={() => setIsSessionsOpen(!isSessionsOpen)}
            className="w-full px-2 py-1.5 flex items-center gap-1 text-[11px] font-semibold text-vscode-textMuted hover:text-vscode-textNormal hover:bg-vscode-hover transition"
          >
            {isSessionsOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <span className="tracking-wide uppercase">
              {language === 'ar' ? 'جلسات البحث' : 'RESEARCH SESSIONS'}
            </span>
            <span className="ml-auto text-[10px] text-vscode-textMuted font-mono">
              ({filteredHistory.length})
            </span>
          </button>

          {isSessionsOpen && (
            <div className="py-0.5">
              {filteredHistory.length === 0 ? (
                <div className="px-6 py-2 text-[11px] text-vscode-textMuted italic">
                  {language === 'ar' ? 'لا توجد جلسات محفوظة' : 'No research sessions'}
                </div>
              ) : (
                filteredHistory.map((item) => {
                  const isActive = item.id === activeReportId;
                  const filename = `${item.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 24).trim()}.md`;

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectReport(item)}
                      className={`group flex items-center justify-between px-3 py-1 cursor-pointer transition text-[11.5px] ${
                        isActive
                          ? 'bg-vscode-selection/40 text-vscode-textActive font-medium border-l-2 border-vscode-accent'
                          : 'text-vscode-textNormal hover:bg-vscode-hover hover:text-vscode-textActive border-l-2 border-transparent'
                      }`}
                      title={item.title || item.query}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-blue-400' : 'text-vscode-textMuted'}`} />
                        <span className="truncate">{filename}</span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteReport(item.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-vscode-textMuted hover:text-red-400 hover:bg-vscode-hover transition"
                        title={language === 'ar' ? 'حذف' : 'Delete'}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Section 2: Visited Sources in Active Report */}
        {activeReport && activeReport.sources && activeReport.sources.length > 0 && (
          <div className="border-t border-vscode-border mt-1">
            <button
              onClick={() => setIsSourcesOpen(!isSourcesOpen)}
              className="w-full px-2 py-1.5 flex items-center gap-1 text-[11px] font-semibold text-vscode-textMuted hover:text-vscode-textNormal hover:bg-vscode-hover transition"
            >
              {isSourcesOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span className="tracking-wide uppercase">
                {language === 'ar' ? 'المصادر المستكشفة' : 'EXPLORED SOURCES'}
              </span>
              <span className="ml-auto text-[10px] text-vscode-textMuted font-mono">
                ({activeReport.sources.length})
              </span>
            </button>

            {isSourcesOpen && (
              <div className="py-0.5">
                {activeReport.sources.map((src, idx) => {
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
                      className="flex items-center justify-between px-3 py-1 text-[11.5px] text-vscode-textNormal hover:bg-vscode-hover hover:text-vscode-textActive transition group"
                      title={src.title || src.url}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Globe className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span className="truncate">{src.title || domain}</span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {src.credibility && (
                          <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20">
                            {src.credibility}%
                          </span>
                        )}
                        <ExternalLink className="w-3 h-3 text-vscode-textMuted group-hover:text-vscode-accent opacity-0 group-hover:opacity-100 transition" />
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Section 3: Export Artifacts */}
        {activeReport && (
          <div className="border-t border-vscode-border mt-1">
            <button
              onClick={() => setIsArtifactsOpen(!isArtifactsOpen)}
              className="w-full px-2 py-1.5 flex items-center gap-1 text-[11px] font-semibold text-vscode-textMuted hover:text-vscode-textNormal hover:bg-vscode-hover transition"
            >
              {isArtifactsOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span className="tracking-wide uppercase">
                {language === 'ar' ? 'تصدير المستند' : 'EXPORT ARTIFACTS'}
              </span>
            </button>

            {isArtifactsOpen && (
              <div className="py-0.5 space-y-0.5">
                <button
                  onClick={() => onExport('pdf')}
                  className="w-full flex items-center gap-2 px-4 py-1 text-[11.5px] text-vscode-textNormal hover:bg-vscode-hover hover:text-vscode-textActive transition text-left"
                >
                  <FileDown className="w-3.5 h-3.5 text-red-400" />
                  <span>export.pdf</span>
                </button>
                <button
                  onClick={() => onExport('docx')}
                  className="w-full flex items-center gap-2 px-4 py-1 text-[11.5px] text-vscode-textNormal hover:bg-vscode-hover hover:text-vscode-textActive transition text-left"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-400" />
                  <span>export.docx</span>
                </button>
                <button
                  onClick={() => onExport('markdown')}
                  className="w-full flex items-center gap-2 px-4 py-1 text-[11.5px] text-vscode-textNormal hover:bg-vscode-hover hover:text-vscode-textActive transition text-left"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>report.md</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
