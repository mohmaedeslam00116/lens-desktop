import React from 'react';
import { History, Search, Trash2, ArrowRight, BookOpen, Clock } from 'lucide-react';
import { ResearchHistoryItem, Language } from '../../types';

interface LibraryViewProps {
  history: ResearchHistoryItem[];
  onSelectReport: (item: ResearchHistoryItem) => void;
  onClearHistory: () => void;
  language: Language;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  history,
  onSelectReport,
  onClearHistory,
  language,
}) => {
  const isArabic = language === 'ar';
  const [filter, setFilter] = React.useState('');

  const filteredHistory = history.filter(item => 
    item.query.toLowerCase().includes(filter.toLowerCase()) ||
    item.report.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#21262d] pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sky-400 text-xs font-mono">
            <History className="w-4 h-4" />
            <span>{isArabic ? 'سجل الأبحاث المعرفية' : 'Research Library'}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">
            {isArabic ? 'الأبحاث والتقارير السابقة' : 'Past Research Reports'}
          </h1>
        </div>

        {history.length > 0 && (
          <button
            onClick={onClearHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs transition font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isArabic ? 'مسح السجل' : 'Clear All'}</span>
          </button>
        )}
      </div>

      {/* Search Filter */}
      {history.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 rtl:right-3 rtl:left-auto top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={isArabic ? 'بحث في الأبحاث السابقة...' : 'Search in history...'}
            className="w-full bg-[#161b22] border border-[#21262d] rounded-xl pl-9 pr-4 rtl:pr-9 rtl:pl-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500/50 transition"
          />
        </div>
      )}

      {/* Reports List */}
      {filteredHistory.length === 0 ? (
        <div className="py-16 text-center text-slate-500 space-y-2">
          <BookOpen className="w-10 h-10 mx-auto text-slate-600 mb-3" />
          <p className="text-sm">{isArabic ? 'لا توجد أبحاث مسجلة بعد.' : 'No research reports in your library yet.'}</p>
          <p className="text-xs text-slate-600">{isArabic ? 'ابدأ أول بحث عميق من الصفحة الرئيسية لتخزينه هنا.' : 'Start your first research from the home page to save it here.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredHistory.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelectReport(item)}
              className="p-4 rounded-xl bg-[#161b22] hover:bg-[#21262d] border border-[#21262d] hover:border-[#30363d] cursor-pointer transition duration-200 flex items-center justify-between gap-4 group shadow-sm"
            >
              <div className="min-w-0 space-y-1.5 flex-1">
                <h3 className="text-sm font-semibold text-slate-200 group-hover:text-sky-300 transition truncate">
                  {item.query}
                </h3>
                <div className="flex items-center gap-3 text-slate-500 text-[11px] font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(item.timestamp).toLocaleDateString(isArabic ? 'ar-EG' : 'en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span>•</span>
                  <span>{item.sources?.length || 0} {isArabic ? 'مصادر' : 'sources'}</span>
                </div>
              </div>

              <div className="w-8 h-8 rounded-lg bg-[#21262d] group-hover:bg-sky-500 flex items-center justify-center transition shrink-0">
                <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-white" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
