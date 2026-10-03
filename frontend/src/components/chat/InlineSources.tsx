import React from 'react';
import { BookOpen } from 'lucide-react';
import type { Language, SourceItem } from '../../types';

interface InlineSourcesProps {
  language: Language;
  sources: SourceItem[];
  onInspectCitation: (index: number) => void;
  onOpenAll: () => void;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * InlineSources — the first few important sources visible immediately under
 * the answer, with `View all N sources` opening the complete shelf. Sources
 * are part of the answer, not a tab the user must hunt for.
 */
export const InlineSources: React.FC<InlineSourcesProps> = ({ language, sources, onInspectCitation, onOpenAll }) => {
  const ar = language === 'ar';
  if (sources.length === 0) return null;
  const visible = sources.slice(0, 4);
  return (
    <section className="chat-sources" aria-label={ar ? 'المصادر' : 'Sources'} data-testid="chat-inline-sources">
      <header className="chat-sources-head">
        <BookOpen size={14} aria-hidden="true" />
        <h3>{ar ? 'المصادر' : 'Sources'}</h3>
      </header>
      <ol className="chat-sources-list">
        {visible.map((s, i) => (
          <li key={`${s.url}-${i}`}>
            <button type="button" className="chat-source-row" onClick={() => onInspectCitation(i + 1)}>
              <span className="chat-source-index" aria-hidden="true">[{i + 1}]</span>
              <span className="chat-source-title" dir="auto">{s.title || domainOf(s.url)}</span>
              <bdi className="chat-source-domain" dir="ltr">{s.domain || domainOf(s.url)}</bdi>
            </button>
          </li>
        ))}
      </ol>
      {sources.length > visible.length && (
        <button type="button" className="chat-sources-more" onClick={onOpenAll}>
          {ar ? `عرض كل المصادر (${sources.length}) ←` : `View all ${sources.length} sources →`}
        </button>
      )}
    </section>
  );
};
