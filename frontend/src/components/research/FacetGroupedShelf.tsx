import React, { useState, useMemo } from 'react';
import {
  Layers,
  Search,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Filter,
  RotateCcw,
  Sparkles,
  Globe,
  BookOpen,
  ArrowUpRight,
  Eye
} from 'lucide-react';
import { SourceItem, Language, ResearchPlan } from '../../types';
import { translations } from '../../i18n/translations';
import {
  enrichSources,
  filterSources,
  groupSourcesByMilestone,
  computeShelfStats,
  SourceShelfFilters,
  EnrichedSourceItem
} from '../../utils/evidenceShelf';

export interface FacetGroupedShelfProps {
  sources: SourceItem[];
  plan?: ResearchPlan | null;
  reportContent?: string;
  language: Language;
  onInspectEvidence: (citationIndex: number) => void;
  className?: string;
}

export const FacetGroupedShelf: React.FC<FacetGroupedShelfProps> = ({
  sources,
  plan,
  reportContent = '',
  language,
  onInspectEvidence,
  className = ''
}) => {
  const isArabic = language === 'ar';
  const t = translations[language] || translations.en;

  // Filter state
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>('all');
  const [citationStatus, setCitationStatus] = useState<'all' | 'cited' | 'background'>('all');
  const [relevanceTier, setRelevanceTier] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Enrich sources
  const enrichedSources = useMemo(() => {
    return enrichSources(sources, plan, reportContent);
  }, [sources, plan, reportContent]);

  // Overall stats
  const stats = useMemo(() => {
    return computeShelfStats(enrichedSources, plan);
  }, [enrichedSources, plan]);

  // Apply multi-dimensional filters
  const currentFilters: SourceShelfFilters = useMemo(() => ({
    milestoneId: selectedMilestoneId,
    citationStatus,
    relevanceTier,
    domain: selectedDomain,
    searchQuery
  }), [selectedMilestoneId, citationStatus, relevanceTier, selectedDomain, searchQuery]);

  const filteredSources = useMemo(() => {
    return filterSources(enrichedSources, currentFilters);
  }, [enrichedSources, currentFilters]);

  // Group filtered sources by milestone
  const milestoneGroups = useMemo(() => {
    return groupSourcesByMilestone(filteredSources, plan);
  }, [filteredSources, plan]);

  const isFiltered = selectedMilestoneId !== 'all' ||
    citationStatus !== 'all' ||
    relevanceTier !== 'all' ||
    selectedDomain !== 'all' ||
    searchQuery.trim().length > 0;

  const handleResetFilters = () => {
    setSelectedMilestoneId('all');
    setCitationStatus('all');
    setRelevanceTier('all');
    setSelectedDomain('all');
    setSearchQuery('');
  };

  return (
    <div
      className={`space-y-6 select-text text-ink animate-fadeIn ${className}`}
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      {/* 1. Header & Summary Stats */}
      <header className="p-4 rounded-xl bg-panel border border-line flex flex-col md:flex-row md:items-center justify-between gap-4 select-none">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-secondary" />
            <h3 className="text-sm font-bold text-ink">
              {t.shelf_title || (isArabic ? 'رف المصادر المصنفة' : 'Facet-Grouped Source Shelf')}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-surface text-secondary border border-line">
              {stats.totalAdmitted} {isArabic ? 'مصدراً' : 'sources'}
            </span>
          </div>
          <p className="text-[11px] text-muted mt-1 leading-relaxed">
            {t.shelf_subtitle || (isArabic
              ? 'استكشاف وتصفية المصادر المقبولة مصنفة حسب محاور الخطة المعتمدة'
              : 'Explore and filter admitted evidence grouped by approved plan milestones')}
          </p>
        </div>

        {/* Aggregate Counters */}
        <div className="grid grid-cols-3 gap-2 shrink-0">
          <div className="px-3 py-2 rounded-lg bg-surface border border-line text-center">
            <span className="text-[10px] text-muted block">
              {t.shelf_total_admitted || (isArabic ? 'إجمالي المقبول' : 'Admitted')}
            </span>
            <span className="text-xs font-mono font-bold text-ink">
              {stats.totalAdmitted}
            </span>
          </div>

          <div className="px-3 py-2 rounded-lg bg-surface border border-line text-center">
            <span className="text-[10px] text-muted block">
              {t.shelf_total_cited || (isArabic ? 'مستشهد به' : 'Cited')}
            </span>
            <span className="text-xs font-mono font-bold text-ink">
              {stats.totalCited}
            </span>
          </div>

          <div className="px-3 py-2 rounded-lg bg-surface border border-line text-center">
            <span className="text-[10px] text-muted block">
              {t.shelf_unique_domains || (isArabic ? 'نطاقات' : 'Domains')}
            </span>
            <span className="text-xs font-mono font-bold text-ink">
              {stats.uniqueDomainsCount}
            </span>
          </div>
        </div>
      </header>

      {/* 2. Multi-Dimensional Filter Toolbar */}
      <section className="p-4 rounded-xl bg-panel border border-line space-y-3.5 select-none">
        {/* Milestone Facet Tabs */}
        <div>
          <span className="text-[11px] font-mono text-muted uppercase tracking-wider block mb-2">
            {t.shelf_all_milestones || (isArabic ? 'تصفية حسب المحور' : 'Milestone Facets')}
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setSelectedMilestoneId('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0 flex items-center gap-1.5 ${
                selectedMilestoneId === 'all'
                  ? 'bg-accent text-on-accent'
                  : 'bg-surface hover:bg-hover text-secondary hover:text-ink border border-line'
              }`}
            >
              <span>{t.shelf_all_milestones || (isArabic ? 'كافة المحاور' : 'All Milestones')}</span>
              <span className="text-[10px] font-mono opacity-80">({stats.totalAdmitted})</span>
            </button>

            {stats.milestoneBreakdown.map((m) => {
              const isActive = selectedMilestoneId === m.milestoneId;
              return (
                <button
                  key={m.milestoneId}
                  type="button"
                  onClick={() => setSelectedMilestoneId(m.milestoneId)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0 flex items-center gap-1.5 max-w-xs truncate ${
                    isActive
                      ? 'bg-accent text-on-accent'
                      : 'bg-surface hover:bg-hover text-secondary hover:text-ink border border-line'
                  }`}
                  title={m.milestoneQuery}
                >
                  <span className="truncate">{m.milestoneQuery}</span>
                  <span className="text-[10px] font-mono opacity-80 shrink-0">
                    ({m.total})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Secondary Filter Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-line/60">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.shelf_search_placeholder || (isArabic ? 'بحث في المصادر...' : 'Search sources...')}
              className="w-full bg-surface border border-line rounded-lg ps-8 pe-3 py-1.5 text-xs text-ink placeholder:text-muted focus:outline-none focus:border-line-strong transition"
            />
          </div>

          {/* Citation Status Toggle */}
          <div className="flex items-center gap-1 p-0.5 bg-surface border border-line rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setCitationStatus('all')}
              className={`flex-1 py-1 px-2 rounded-md font-medium text-center transition ${
                citationStatus === 'all'
                  ? 'bg-panel text-ink shadow-sm'
                  : 'text-muted hover:text-secondary'
              }`}
            >
              {t.shelf_status_all || (isArabic ? 'الكل' : 'All')}
            </button>
            <button
              type="button"
              onClick={() => setCitationStatus('cited')}
              className={`flex-1 py-1 px-2 rounded-md font-medium text-center transition ${
                citationStatus === 'cited'
                  ? 'bg-panel text-ink shadow-sm'
                  : 'text-muted hover:text-secondary'
              }`}
            >
              {t.shelf_status_cited || (isArabic ? 'مستشهد به' : 'Cited')} ({stats.totalCited})
            </button>
            <button
              type="button"
              onClick={() => setCitationStatus('background')}
              className={`flex-1 py-1 px-2 rounded-md font-medium text-center transition ${
                citationStatus === 'background'
                  ? 'bg-panel text-ink shadow-sm'
                  : 'text-muted hover:text-secondary'
              }`}
            >
              {t.shelf_status_background || (isArabic ? 'خلفي' : 'Backgr.')}
            </button>
          </div>

          {/* Relevance Tier Filter */}
          <div>
            <select
              value={relevanceTier}
              onChange={(e) => setRelevanceTier(e.target.value as any)}
              className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-line-strong transition"
            >
              <option value="all" className="bg-panel text-ink">{t.shelf_all_tiers || (isArabic ? 'كافة المستويات' : 'All Relevance Tiers')}</option>
              <option value="high" className="bg-panel text-ink">{t.evidence_tier_high || (isArabic ? 'عالٍ (≥ 80%)' : 'High (≥ 80%)')} ({stats.tierCounts.high})</option>
              <option value="medium" className="bg-panel text-ink">{t.evidence_tier_medium || (isArabic ? 'متوسط (60%–79%)' : 'Medium (60%–79%)')} ({stats.tierCounts.medium})</option>
              <option value="low" className="bg-panel text-ink">{t.evidence_tier_low || (isArabic ? 'قياسي (< 60%)' : 'Standard (< 60%)')} ({stats.tierCounts.low})</option>
            </select>
          </div>

          {/* Domain Filter */}
          <div>
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-line-strong transition truncate"
            >
              <option value="all" className="bg-panel text-ink">{t.shelf_all_domains || (isArabic ? 'كافة النطاقات' : 'All Domains')}</option>
              {stats.topDomains.map((d) => (
                <option key={d.domain} value={d.domain} className="bg-panel text-ink">
                  {d.domain} ({d.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Filters Summary & Reset */}
        {isFiltered && (
          <div className="flex items-center justify-between pt-1 text-xs text-muted">
            <span>
              {isArabic
                ? `عرض ${filteredSources.length} من أصل ${stats.totalAdmitted} مصدراً`
                : `Showing ${filteredSources.length} of ${stats.totalAdmitted} sources`}
            </span>
            <button
              type="button"
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-xs text-secondary hover:text-ink font-medium transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t.shelf_reset_filters || (isArabic ? 'إعادة ضبط التصفية' : 'Reset Filters')}</span>
            </button>
          </div>
        )}
      </section>

      {/* 3. Grouped Milestone Sections */}
      {filteredSources.length === 0 ? (
        <div className="py-16 text-center rounded-xl border border-dashed border-line bg-panel p-6 space-y-3">
          <Layers className="w-8 h-8 text-muted mx-auto" />
          <h4 className="text-sm font-semibold text-ink">
            {t.shelf_no_sources || (isArabic ? 'لا توجد مصادر مطابقة لمعايير التصفية الحالية.' : 'No sources match the selected filter criteria.')}
          </h4>
          <p className="text-xs text-muted max-w-md mx-auto">
            {isArabic
              ? 'جرّب تعديل كلمات البحث أو إلغاء تصفية النطاقات والمحاور لإظهار المزيد من المصادر المقبولة.'
              : 'Try clearing the search query or adjusting domain/milestone filters to reveal admitted sources.'}
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-hover text-ink text-xs font-medium border border-line transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.shelf_reset_filters || (isArabic ? 'إعادة ضبط التصفية' : 'Reset Filters')}</span>
          </button>
        </div>
      ) : (
        <div className="space-y-7">
          {milestoneGroups
            .filter((grp) => grp.sources.length > 0)
            .map((grp) => (
              <section key={grp.milestoneId} className="space-y-3">
                {/* Milestone Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                    <h4 className="text-xs sm:text-sm font-bold text-ink truncate">
                      {grp.milestoneQuery}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-muted shrink-0">
                    <span>
                      {grp.totalCount} {isArabic ? 'مصدر' : 'sources'}
                    </span>
                    <span className="text-line-strong">•</span>
                    <span className="text-ink">
                      {grp.citedCount} {isArabic ? 'مستشهد به' : 'cited'}
                    </span>
                  </div>
                </div>

                {/* Source Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {grp.sources.map((source) => {
                    const faviconUrl = `https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(
                      source.url
                    )}&sz=32`;

                    return (
                      <article
                        key={source.index}
                        className="p-3.5 rounded-xl bg-panel hover:bg-surface border border-line hover:border-line-strong transition flex flex-col justify-between gap-3 group"
                      >
                        <div className="space-y-2">
                          {/* Card Top Row: Citation pill + Domain badge */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="px-1.5 py-0.5 rounded-md bg-surface text-ink font-mono text-[11px] font-bold border border-line shrink-0">
                                [{source.citationIndex || source.index}]
                              </span>
                              <img
                                src={faviconUrl}
                                alt=""
                                className="w-3.5 h-3.5 rounded-sm shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <span className="text-[11px] font-mono text-muted truncate">
                                {source.domain}
                              </span>
                            </div>

                            {/* Status indicator */}
                            {source.isCited ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/10 text-ink shrink-0">
                                {isArabic ? 'مستشهد به' : 'Cited'}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface text-muted shrink-0">
                                {isArabic ? 'خلفي' : 'Backgr.'}
                              </span>
                            )}
                          </div>

                          {/* Source Title */}
                          <h5 className="text-xs font-semibold text-ink line-clamp-2 leading-snug break-words group-hover:underline underline-offset-2">
                            {source.title || source.domain}
                          </h5>

                          {/* Passage preview */}
                          {source.passage && (
                            <p className="text-[11px] font-mono text-secondary line-clamp-2 leading-relaxed break-words">
                              {source.passage}
                            </p>
                          )}
                        </div>

                        {/* Card Bottom Row: Relevance & Action */}
                        <div className="pt-2 border-t border-line/60 flex items-center justify-between gap-2 text-[11px] select-none">
                          <div className="flex items-center gap-2 font-mono text-[10px] text-muted">
                            <span>{Math.round(source.score * 100)}% {t.shelf_match || (isArabic ? 'تطابق' : 'Match')}</span>
                            <span>•</span>
                            <span>{source.credibilityScore}% {t.shelf_auth || (isArabic ? 'موثوقية' : 'Auth')}</span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onInspectEvidence(source.citationIndex || source.index)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface hover:bg-hover text-ink text-[11px] font-medium border border-line transition cursor-pointer"
                              title={t.shelf_inspect_btn || (isArabic ? 'فحص الدليل' : 'Inspect Evidence')}
                            >
                              <Eye className="w-3 h-3 text-secondary" />
                              <span>{t.shelf_inspect_btn || (isArabic ? 'فحص' : 'Inspect')}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (window.electronAPI?.openExternal) {
                                  window.electronAPI.openExternal(source.url);
                                } else {
                                  window.open(source.url, '_blank', 'noopener,noreferrer');
                                }
                              }}
                              className="p-1 rounded text-muted hover:text-ink hover:bg-surface transition"
                              title={t.evidence_visit_source || (isArabic ? 'فتح الرابط' : 'Open Link')}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
};
