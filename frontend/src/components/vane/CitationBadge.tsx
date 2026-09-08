import React from 'react';
import { SourceItem } from '../../types';

interface CitationBadgeProps {
  index: number;
  sources: SourceItem[];
  onInspect?: (index: number) => void;
}

export const CitationBadge: React.FC<CitationBadgeProps> = ({ index, sources, onInspect }) => {
  const source = sources.find(s => s.citationIndex === index) || sources[index - 1];

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onInspect) {
      onInspect(index);
    } else if (source?.url) {
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(source.url);
      } else {
        window.open(source.url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const faviconUrl = source?.url
    ? `https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(source.url)}&sz=32`
    : undefined;

  const tooltipTitle = source?.title
    ? `[${index}] ${source.title}`
    : `[${index}]`;

  if (!source) {
    return (
      <button
        type="button"
        onClick={() => onInspect && onInspect(index)}
        className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-panel text-muted font-mono text-[11px] align-baseline hover:text-ink cursor-pointer border border-line transition duration-150 active:scale-95"
        title={`[${index}]`}
      >
        [{index}]
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={tooltipTitle}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-panel hover:bg-surface border border-line-strong hover:border-accent/50 text-accent hover:text-accent font-mono text-[11px] transition duration-150 cursor-pointer align-baseline shadow-sm active:scale-95"
    >
      {faviconUrl && (
        <img
          src={faviconUrl}
          alt=""
          className="w-3 h-3 rounded-sm inline shrink-0"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
      )}
      <span className="font-semibold">{index}</span>
    </button>
  );
};
