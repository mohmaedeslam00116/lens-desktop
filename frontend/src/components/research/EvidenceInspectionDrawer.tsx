import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  X,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Layers,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Quote,
  Languages,
  BookOpen
} from 'lucide-react';
import { SourceItem, Language, ResearchPlan } from '../../types';
import { translations } from '../../i18n/translations';
import {
  enrichSources,
  extractCitationInspection,
  extractCitedIndices
} from '../../utils/evidenceShelf';

export interface EvidenceInspectionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  targetCitationIndex: number | null;
  sources: SourceItem[];
  plan?: ResearchPlan | null;
  reportContent?: string;
  language: Language;
  onNavigateCitation?: (newIndex: number) => void;
}

function highlightVerbatimPassage(passage: string, claim?: string): React.ReactNode {
  if (!claim || !passage) return passage;
  const words = claim
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 15);

  if (words.length === 0) return passage;

  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'giu');
  const parts = passage.split(pattern);

  return parts.map((part, i) => {
    if (pattern.test(part)) {
      return (
        <mark key={i} className="bg-line-strong/60 text-ink px-0.5 rounded font-semibold">
          {part}
        </mark>
      );
    }
    return part;
  });
}

export const EvidenceInspectionDrawer: React.FC<EvidenceInspectionDrawerProps> = ({
  isOpen,
  onClose,
  targetCitationIndex,
  sources,
  plan,
  reportContent = '',
  language,
  onNavigateCitation,
}) => {
  const isArabic = language === 'ar';
  const t = translations[language] || translations.en;
  const [copiedPassage, setCopiedPassage] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);

  // Enrich sources once
  const enrichedSources = useMemo(() => {
    return enrichSources(sources, plan, reportContent);
  }, [sources, plan, reportContent]);

  // Extract all cited indices in order with graceful shelf background fallback
  const availableCitationIndices = useMemo(() => {
    const fromReport = Array.from(extractCitedIndices(reportContent)).sort((a, b) => a - b);
    if (targetCitationIndex && !fromReport.includes(targetCitationIndex)) {
      return enrichedSources.map((s) => s.citationIndex || s.index);
    }
    if (fromReport.length > 0) return fromReport;
    return enrichedSources.map((s) => s.citationIndex || s.index);
  }, [reportContent, enrichedSources, targetCitationIndex]);

  // Current active index
  const currentIndex = targetCitationIndex || availableCitationIndices[0] || 1;

  // Detail inspection
  const detail = useMemo(() => {
    return extractCitationInspection(currentIndex, enrichedSources, reportContent, language);
  }, [currentIndex, enrichedSources, reportContent, language]);

  // Navigation indices
  const currentPos = availableCitationIndices.indexOf(currentIndex);
  const prevIndex = currentPos > 0 ? availableCitationIndices[currentPos - 1] : null;
  const nextIndex = currentPos >= 0 && currentPos < availableCitationIndices.length - 1
    ? availableCitationIndices[currentPos + 1]
    : null;

  // Focus trap, Escape key, and Arrow Left/Right stepper navigation
  useEffect(() => {
    if (!isOpen) return;

    // Focus drawer container
    drawerRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Citation stepper via Arrow keys
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (!isInput) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (isArabic) {
            if (nextIndex !== null && onNavigateCitation) onNavigateCitation(nextIndex);
          } else {
            if (prevIndex !== null && onNavigateCitation) onNavigateCitation(prevIndex);
          }
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (isArabic) {
            if (prevIndex !== null && onNavigateCitation) onNavigateCitation(prevIndex);
          } else {
            if (nextIndex !== null && onNavigateCitation) onNavigateCitation(nextIndex);
          }
        }
      }

      // Tab key focus trapping
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, prevIndex, nextIndex, onNavigateCitation, isArabic]);

  const handleCopyPassage = () => {
    if (!detail.exactPassage) return;
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(detail.exactPassage).then(() => {
          setCopiedPassage(true);
          setTimeout(() => setCopiedPassage(false), 2000);
        }).catch(() => {});
      }
    } catch {}
  };

  const handleOpenSource = () => {
    if (detail.sourceUrl) {
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(detail.sourceUrl);
      } else {
        window.open(detail.sourceUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  if (!isOpen) return null;

  const faviconUrl = `https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(
    detail.sourceUrl || 'https://google.com'
  )}&sz=32`;

  return (
    <div
      className={`fixed inset-0 z-50 flex ${isArabic ? 'justify-start' : 'justify-end'} overflow-hidden`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-drawer-title"
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      {/* Backdrop Scrim */}
      <div
        className="fixed inset-0 bg-black/70 transition-opacity animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-Over Inspection Drawer */}
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className={`relative z-10 flex flex-col h-full w-full sm:w-[500px] lg:w-[540px] bg-canvas shadow-lg text-ink overflow-hidden outline-none ${
          isArabic ? 'animate-slide-in-left border-e border-line' : 'animate-slide-in-right border-s border-line'
        }`}
        dir={isArabic ? 'rtl' : 'ltr'}
      >
        {/* Drawer Header */}
        <header className="px-5 py-4 border-b border-line bg-panel flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2 py-0.5 rounded-md bg-accent text-on-accent font-mono text-xs font-bold shrink-0">
              [{detail.citationIndex}]
            </span>
            <div className="min-w-0">
              <h2
                id="evidence-drawer-title"
                className="text-sm font-bold text-ink truncate leading-snug"
              >
                {t.evidence_drawer_title || (isArabic ? 'فحص الدليل الأكاديمي' : 'Evidence Inspection')}
              </h2>
              <div className="flex items-center gap-1.5 text-[11px] text-muted font-mono truncate mt-0.5">
                <img
                  src={faviconUrl}
                  alt=""
                  className="w-3.5 h-3.5 rounded-sm shrink-0"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <span className="truncate">{detail.sourceDomain}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {detail.sourceUrl && (
              <button
                type="button"
                onClick={handleOpenSource}
                title={t.evidence_visit_source || (isArabic ? 'فتح الرابط الخارجي' : 'Open External Link')}
                className="p-1.5 rounded-lg text-secondary hover:text-ink hover:bg-surface transition border border-transparent hover:border-line"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t.evidence_close || (isArabic ? 'إغلاق نافذة الفحص' : 'Close inspection drawer')}
              className="p-1.5 rounded-lg text-secondary hover:text-ink hover:bg-surface transition border border-transparent hover:border-line"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
          {/* Source Title & Primary Link */}
          <section className="p-4 rounded-xl bg-panel border border-line space-y-2">
            <span className="text-[11px] font-mono text-muted uppercase tracking-wider block">
              {t.evidence_cited_source || (isArabic ? 'المصدر المستشهد به' : 'Cited Source')}
            </span>
            <h3 className="text-sm font-semibold text-ink leading-relaxed break-words">
              {detail.sourceTitle}
            </h3>
            {detail.sourceUrl && (
              <button
                type="button"
                onClick={handleOpenSource}
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition font-mono truncate max-w-full text-start"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate underline underline-offset-4">{detail.sourceUrl}</span>
              </button>
            )}
          </section>

          {/* Provenance Metrics Bar */}
          <section className="grid grid-cols-3 gap-2 text-center select-none">
            {/* Relevance Score */}
            <div className="p-3 rounded-xl bg-panel border border-line space-y-1">
              <span className="text-[10px] text-muted block">
                {t.evidence_relevance_score || (isArabic ? 'درجة التطابق' : 'Relevance')}
              </span>
              <p className="text-sm font-mono font-bold text-ink">
                {Math.round(detail.relevanceScore * 100)}%
              </p>
              <span
                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${
                  detail.relevanceTier === 'high'
                    ? 'bg-white/10 text-ink'
                    : detail.relevanceTier === 'medium'
                    ? 'bg-white/5 text-secondary'
                    : 'bg-surface text-muted'
                }`}
              >
                {detail.relevanceTier === 'high'
                  ? t.evidence_tier_high || 'High'
                  : detail.relevanceTier === 'medium'
                  ? t.evidence_tier_medium || 'Medium'
                  : t.evidence_tier_low || 'Standard'}
              </span>
            </div>

            {/* Academic Credibility */}
            <div className="p-3 rounded-xl bg-panel border border-line space-y-1">
              <span className="text-[10px] text-muted block">
                {t.evidence_credibility || (isArabic ? 'الموثوقية الأكاديمية' : 'Credibility')}
              </span>
              <p className="text-sm font-mono font-bold text-ink">
                {detail.credibilityScore}%
              </p>
              <div className="flex items-center justify-center gap-1 text-[10px] text-muted">
                <ShieldCheck className="w-3 h-3 text-secondary" />
                <span>{t.evidence_verified || (isArabic ? 'موثّق' : 'Verified')}</span>
              </div>
            </div>

            {/* Domain Authority */}
            <div className="p-3 rounded-xl bg-panel border border-line space-y-1">
              <span className="text-[10px] text-muted block">
                {t.evidence_source_domain || (isArabic ? 'النطاق' : 'Domain')}
              </span>
              <p className="text-xs font-mono font-medium text-ink truncate mt-0.5">
                {detail.sourceDomain}
              </p>
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface text-muted">
                {t.evidence_admitted || (isArabic ? 'مقبول' : 'Admitted')}
              </span>
            </div>
          </section>

          {/* Assigned Milestone Facet */}
          <section className="p-3.5 rounded-xl bg-surface border border-line space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink">
              <Layers className="w-3.5 h-3.5 text-secondary" />
              <span>{t.evidence_milestone_facet || (isArabic ? 'المحور المعتمد بخطة البحث' : 'Assigned Milestone Facet')}</span>
            </div>
            <p className="text-xs text-secondary leading-relaxed font-mono break-words">
              {detail.milestoneTitle}
            </p>
          </section>

          {/* Exact Highlighted Source Passage */}
          <section className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <Quote className="w-3.5 h-3.5 text-secondary" />
                <span>{t.evidence_exact_passage || (isArabic ? 'النص الأصلي المقتبس من المصدر' : 'Exact Highlighted Source Passage')}</span>
              </div>
              <button
                type="button"
                onClick={handleCopyPassage}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface hover:bg-hover text-secondary hover:text-ink text-[11px] font-mono border border-line transition"
              >
                {copiedPassage ? <Check className="w-3 h-3 text-ink" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPassage ? (isArabic ? 'تم النسخ' : 'Copied') : (isArabic ? 'نسخ النص' : 'Copy')}</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-panel border border-line-strong text-xs font-mono text-ink leading-relaxed whitespace-pre-wrap break-words select-text border-s-2 border-s-accent">
              {highlightVerbatimPassage(detail.exactPassage, detail.surroundingClaim)}
            </div>
          </section>

          {/* Report Claim (Contextual Grounding) */}
          {detail.surroundingClaim && (
            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <BookOpen className="w-3.5 h-3.5 text-secondary" />
                <span>{t.evidence_cited_claim || (isArabic ? 'الادعاء الوارد في التقرير' : 'Cited Report Claim')}</span>
              </div>
              <div className="p-3.5 rounded-xl bg-surface border border-line text-xs text-secondary leading-relaxed break-words select-text">
                {detail.surroundingClaim}
              </div>
            </section>
          )}

          {/* Side-by-Side Claim & Source Verification Box */}
          {detail.surroundingClaim && (
            <section className="p-4 rounded-xl bg-panel border border-line space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-ink">
                  <Languages className="w-4 h-4 text-secondary" />
                  <span>
                    {detail.isBilingual
                      ? (t.evidence_bilingual_fidelity || (isArabic ? 'المطابقة اللغوية الثنائية للأدلة' : 'Bilingual Evidence Fidelity'))
                      : (isArabic ? 'التحقق المباشر من الادعاء والمصدر' : 'Claim & Excerpt Fidelity Verification')}
                  </span>
                </div>
                {detail.isBilingual && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface border border-line text-secondary">
                    {isArabic ? 'ثنائي اللغة' : 'Cross-Lingual'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                {detail.isBilingual
                  ? (isArabic
                      ? 'تم استخلاص هذا الاستشهاد الأكاديمي من مصدر أجنبي مع صياغته ضمن السياق العربي. يمكنك مقارنة النص الأصلي مع سياق التقرير للتأكد من دقة الترجمة والمصطلحات.'
                      : 'This academic citation was translated or synthesized across language boundaries. Compare the original excerpt against the report claim to verify translation fidelity.')
                  : (isArabic
                      ? 'مقارنة مباشرة جنباً إلى جنب بين نص الادعاء في التقرير والنص المقتبس حرفياً من المصدر الأكاديمي.'
                      : 'Direct side-by-side verification between the synthesized report claim and the admitted source excerpt.')}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs pt-1">
                <div className="p-3 rounded-lg bg-surface border border-line">
                  <span className="text-[10px] font-mono text-muted uppercase block mb-1">
                    {isArabic ? 'سياق الادعاء بالتقرير' : 'Report Claim Context'}
                  </span>
                  <p className="text-secondary leading-relaxed break-words">
                    {detail.surroundingClaim}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface border border-line font-mono">
                  <span className="text-[10px] font-mono text-muted uppercase block mb-1">
                    {isArabic ? 'المصدر الأصلي (النص المعتمد)' : 'Primary Source Excerpt'}
                  </span>
                  <p className="text-secondary leading-relaxed break-words">
                    {detail.originalSnippet || detail.exactPassage}
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Drawer Footer: Citation Stepper Controls */}
        <footer className="px-5 py-3.5 border-t border-line bg-panel flex items-center justify-between gap-2 shrink-0 select-none">
          <button
            type="button"
            disabled={prevIndex === null}
            onClick={() => {
              if (prevIndex !== null && onNavigateCitation) {
                onNavigateCitation(prevIndex);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-hover disabled:opacity-40 disabled:pointer-events-none text-xs text-ink font-medium border border-line transition"
          >
            {isArabic ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            <span>{t.evidence_prev_citation || (isArabic ? 'المصدر السابق' : 'Previous')}</span>
          </button>

          <span className="text-xs font-mono text-muted">
            {availableCitationIndices.length > 0
              ? `${currentPos + 1} / ${availableCitationIndices.length}`
              : `[${detail.citationIndex}]`}
          </span>

          <button
            type="button"
            disabled={nextIndex === null}
            onClick={() => {
              if (nextIndex !== null && onNavigateCitation) {
                onNavigateCitation(nextIndex);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-hover disabled:opacity-40 disabled:pointer-events-none text-xs text-ink font-medium border border-line transition"
          >
            <span>{t.evidence_next_citation || (isArabic ? 'المصدر التالي' : 'Next')}</span>
            {isArabic ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </footer>
      </aside>
    </div>
  );
};
