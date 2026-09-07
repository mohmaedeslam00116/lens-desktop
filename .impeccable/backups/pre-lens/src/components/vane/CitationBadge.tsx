import React, { useState } from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { SourceItem } from '../../types';

interface CitationBadgeProps {
  index: number;
  sources: SourceItem[];
}

export const CitationBadge: React.FC<CitationBadgeProps> = ({ index, sources }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const source = sources[index - 1];

  if (!source) {
    return (
      <span className="inline-block px-1.5 py-0.2 mx-0.5 rounded bg-[#161b22] text-slate-500 font-mono text-[11px] align-baseline">
        [{index}]
      </span>
    );
  }

  const faviconUrl = `https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(source.url)}&sz=32`;

  return (
    <span className="relative inline-block align-baseline mx-0.5">
      <button
        type="button"
        onClick={() => window.open(source.url, '_blank', 'noopener,noreferrer')}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#161b22] hover:bg-[#21262d] border border-[#30363d] hover:border-sky-500/50 text-sky-400 hover:text-sky-300 font-mono text-[11px] transition duration-150 cursor-pointer group shadow-sm active:scale-95"
      >
        <img
          src={faviconUrl}
          alt=""
          className="w-3 h-3 rounded-sm inline shrink-0"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <span className="font-semibold">{index}</span>
      </button>

      {/* Hover Preview Popover */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl z-50 pointer-events-none animate-fadeIn">
          <div className="flex items-start gap-2.5">
            <img
              src={faviconUrl}
              alt=""
              className="w-4 h-4 rounded-sm shrink-0 mt-0.5"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-200 line-clamp-2 leading-snug">
                {source.title || source.url}
              </p>
              <p className="text-[10px] text-slate-500 font-mono truncate mt-1">
                {source.domain || source.url}
              </p>
              {source.credibilityScore && (
                <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono mt-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>{source.credibilityScore}% موثوقية أكاديمية</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
};
