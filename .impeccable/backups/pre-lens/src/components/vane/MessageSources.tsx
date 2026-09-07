import React, { useState } from 'react';
import { BookCopy, ExternalLink, X, ShieldCheck } from 'lucide-react';
import { SourceItem, Language } from '../../types';

interface MessageSourcesProps {
  sources: SourceItem[];
  language: Language;
}

export const MessageSources: React.FC<MessageSourcesProps> = ({ sources, language }) => {
  const isArabic = language === 'ar';
  const [showAllModal, setShowAllModal] = useState(false);

  if (!sources || sources.length === 0) return null;

  const getDomain = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  const visibleSources = sources.slice(0, 3);
  const remainingCount = sources.length - 3;

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-2 text-slate-300 font-medium text-sm">
        <BookCopy className="w-4 h-4 text-sky-400" />
        <span>{isArabic ? 'المصادر الموثقة' : 'Sources'} ({sources.length})</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {visibleSources.map((source, idx) => {
          const domain = getDomain(source.url);
          const faviconUrl = `https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(source.url)}&sz=32`;

          return (
            <a
              key={idx}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-3 rounded-xl bg-[#161b22] hover:bg-[#21262d] border border-[#21262d] hover:border-[#30363d] transition duration-200 flex flex-col justify-between gap-2.5 group"
            >
              <p className="text-xs font-medium text-slate-200 line-clamp-2 leading-snug group-hover:text-sky-300 transition">
                {source.title || domain}
              </p>

              <div className="flex items-center justify-between pt-1 border-t border-[#21262d]/60">
                <div className="flex items-center gap-2 min-w-0">
                  <img
                    src={faviconUrl}
                    alt=""
                    className="w-4 h-4 rounded-sm shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span className="text-[11px] text-slate-400 truncate max-w-[100px] font-mono">
                    {domain}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {source.credibilityScore && (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.5 rounded flex items-center gap-0.5">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      {source.credibilityScore}%
                    </span>
                  )}
                  <span className="text-[11px] font-mono text-slate-500 bg-[#21262d] px-1.5 py-0.5 rounded">
                    {idx + 1}
                  </span>
                </div>
              </div>
            </a>
          );
        })}

        {remainingCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAllModal(true)}
            className="p-3 rounded-xl bg-[#161b22]/70 hover:bg-[#21262d] border border-dashed border-[#30363d] hover:border-sky-500/50 transition duration-200 flex flex-col items-center justify-center gap-2 group text-center"
          >
            <div className="flex -space-x-1.5 overflow-hidden">
              {sources.slice(3, 6).map((s, i) => (
                <img
                  key={i}
                  src={`https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(s.url)}&sz=32`}
                  alt=""
                  className="inline-block h-4 w-4 rounded-full ring-2 ring-[#161b22]"
                />
              ))}
            </div>
            <span className="text-xs text-slate-400 group-hover:text-sky-300 font-medium">
              {isArabic ? `عرض ${remainingCount} مصادر إضافية` : `View ${remainingCount} more`}
            </span>
          </button>
        )}
      </div>

      {/* Full Sources Modal */}
      {showAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-2xl max-h-[80vh] bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[#21262d] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookCopy className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">
                  {isArabic ? 'جميع المصادر والمراجع' : 'All Research Sources'} ({sources.length})
                </h3>
              </div>
              <button
                onClick={() => setShowAllModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-[#21262d] text-slate-400 hover:text-white flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2">
              {sources.map((source, i) => {
                const domain = getDomain(source.url);
                return (
                  <a
                    key={i}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-xl bg-[#0d1117] hover:bg-[#21262d] border border-[#21262d] flex items-start justify-between gap-3 transition group"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-xs font-mono text-slate-500 mt-0.5">[{i + 1}]</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-200 group-hover:text-sky-300 transition truncate">
                          {source.title || domain}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                          {source.url}
                        </p>
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0 mt-1" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
