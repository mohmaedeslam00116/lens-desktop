import React from 'react';
import type { Language, SourceItem } from '../../types';

interface CitationListProps {
  language: Language;
  report: string;
  sources: SourceItem[];
  onInspectCitation: (index: number) => void;
}

/**
 * CitationList — inline `[n]` citations rendered as part of the answer.
 * The full markdown body stays in ReportCanvas; this row exposes the cited
 * indices as buttons that open the EvidenceInspectionDrawer in place.
 */
export const CitationList: React.FC<CitationListProps> = ({ language, report, sources, onInspectCitation }) => {
  const ar = language === 'ar';
  const cited = React.useMemo(() => {
    const found = new Set<number>();
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(report)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= sources.length) found.add(n);
    }
    return [...found].sort((a, b) => a - b).slice(0, 12);
  }, [report, sources.length]);
  if (cited.length === 0) return null;
  return (
    <div className="chat-citations" aria-label={ar ? 'الاستشهادات' : 'Citations'} data-testid="chat-citations">
      {cited.map((n) => (
        <button
          key={n}
          type="button"
          className="chat-citation"
          onClick={() => onInspectCitation(n)}
          aria-label={ar ? `الاستشهاد ${n}` : `Citation ${n}`}
          title={sources[n - 1]?.title || String(n)}
        >
          [{n}]
        </button>
      ))}
    </div>
  );
};
