import React, { useState, useEffect, useCallback } from 'react';
import { 
  Compass, 
  Cpu, 
  TrendingUp, 
  FlaskConical, 
  Globe, 
  Trophy, 
  Film, 
  RefreshCw, 
  Search, 
  ArrowUpRight, 
  Sparkles, 
  ExternalLink,
  Clock,
  Radio
} from 'lucide-react';
import { Language, DiscoverArticle } from '../../types';

interface DiscoverViewProps {
  onSelectTopic: (topicQuery: string) => void;
  language: Language;
}

export const DiscoverView: React.FC<DiscoverViewProps> = ({ onSelectTopic, language }) => {
  const isArabic = language === 'ar';

  const topics = [
    { id: 'tech', label: isArabic ? 'تقنية وذكاء اصطناعي' : 'Tech & AI', icon: Cpu },
    { id: 'finance', label: isArabic ? 'مال واقتصاد' : 'Finance & Markets', icon: TrendingUp },
    { id: 'science', label: isArabic ? 'علوم وابتكار' : 'Science & Health', icon: FlaskConical },
    { id: 'world', label: isArabic ? 'أحداث عالمية' : 'World News', icon: Globe },
    { id: 'sports', label: isArabic ? 'رياضة' : 'Sports', icon: Trophy },
    { id: 'entertainment', label: isArabic ? 'ثقافة ومنوعات' : 'Culture & Arts', icon: Film },
  ];

  const [activeTopic, setActiveTopic] = useState('tech');
  const [searchFilter, setSearchFilter] = useState('');
  const [articles, setArticles] = useState<DiscoverArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLiveNews = useCallback(async (topicId: string, customQuery?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qParam = customQuery && customQuery.trim() ? `&q=${encodeURIComponent(customQuery.trim())}` : '';
      const res = await fetch(`http://127.0.0.1:8000/api/discover?topic=${topicId}&language=${language}${qParam}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setArticles(data.articles || []);
    } catch (err: any) {
      console.warn('[DiscoverView] Failed to fetch live articles:', err);
      setError(isArabic ? 'تعذر جلب الأخبار الحية، يرجى المحاولة مرة أخرى' : 'Unable to fetch live news, please retry');
    } finally {
      setLoading(false);
    }
  }, [language, isArabic]);

  useEffect(() => {
    fetchLiveNews(activeTopic, searchFilter);
  }, [activeTopic, fetchLiveNews]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLiveNews(activeTopic, searchFilter);
  };

  const openLink = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const heroArticle = articles.length > 0 ? articles[0] : null;
  const gridArticles = articles.length > 1 ? articles.slice(1) : [];

  return (
    <div className="w-full max-w-5xl mx-auto px-6 py-10 space-y-8">
      {/* 1. Header Section */}
      <div className="space-y-3 pb-6 border-b border-white/[0.06]">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-semibold text-ink">{isArabic ? 'استكشف' : 'Discover'}</h1>

          <button
            type="button"
            disabled={loading}
            onClick={() => fetchLiveNews(activeTopic, searchFilter)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-xs font-medium text-slate-300 hover:text-white transition disabled:opacity-40"
            title={isArabic ? 'تحديث الأخبار الآن' : 'Refresh live news'}
          >
            <RefreshCw className={`w-3 h-3 text-accent ${loading ? 'animate-spin' : ''}`} />
            <span>{isArabic ? 'تحديث حي' : 'Refresh'}</span>
          </button>
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              {isArabic 
                ? 'أخبار وموضوعات حية مستخلصة فورياً من مصادر الويب العالمية، جاهزة للبحث والاستقصاء العميق بضغطة زر.'
                : 'Real-time live news and emerging trends ready for instant autonomous deep research.'}
            </p>
          </div>

          {/* Search bar inside discover */}
          <form onSubmit={handleSearchSubmit} className="relative w-full md:w-72 shrink-0">
            <input
              type="text"
              aria-label={isArabic ? 'البحث في الأخبار' : 'Search news'}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder={isArabic ? 'ابحث في الأخبار الحية...' : 'Search live news...'}
              className="w-full pl-9 pr-3 rtl:pr-9 rtl:pl-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] focus:bg-panel border border-white/[0.07] focus:border-accent/40 focus:ring-1 focus:ring-accent/20 text-xs text-slate-200 placeholder-slate-500 transition focus:outline-none"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </form>
        </div>

        {/* Topic Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 pb-1 scrollbar-hide">
          {topics.map((t) => {
            const Icon = t.icon;
            const isActive = activeTopic === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setActiveTopic(t.id);
                  setSearchFilter('');
                }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition shrink-0 ${
                  isActive
                    ? 'bg-accent/15 text-accent border border-accent/30 shadow-sm'
                    : 'bg-white/[0.03] hover:bg-white/[0.07] text-slate-400 hover:text-slate-200 border border-white/[0.05]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Loading State */}
      {loading && (
        <div className="space-y-4">
          {/* Hero skeleton */}
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.04] animate-pulse space-y-4">
            <div className="w-24 h-4 bg-white/[0.06] rounded" />
            <div className="w-3/4 h-7 bg-white/[0.08] rounded" />
            <div className="w-1/2 h-4 bg-white/[0.05] rounded" />
          </div>

          {/* Grid skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div key={n} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.04] animate-pulse space-y-3">
                <div className="w-20 h-3 bg-white/[0.06] rounded" />
                <div className="w-full h-5 bg-white/[0.08] rounded" />
                <div className="w-2/3 h-3 bg-white/[0.05] rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Error Fallback */}
      {!loading && error && articles.length === 0 && (
        <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center space-y-3">
          <p className="text-sm text-slate-400">{error}</p>
          <button
            type="button"
            onClick={() => fetchLiveNews(activeTopic, searchFilter)}
            className="px-4 py-2 rounded-xl bg-accent text-slate-950 text-xs font-semibold hover:bg-accent/90 transition"
          >
            {isArabic ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}

      {/* 4. Live News Feed */}
      {!loading && articles.length > 0 && (
        <div className="space-y-6">
          {/* Featured Hero Article */}
          {heroArticle && (
            <div 
              onClick={() => onSelectTopic(heroArticle.researchQuery)}
              className="p-6 rounded-2xl bg-panel hover:bg-surface border border-white/[0.07] hover:border-accent/40 cursor-pointer transition-all duration-200 group   relative overflow-hidden"
            >
              {/* Subtle ambient light */}
              

              <div className="space-y-4 relative z-10">
                {/* Meta row */}
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <img
                      src={`https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(heroArticle.domain)}&sz=32`}
                      alt=""
                      className="w-4 h-4 rounded-sm shrink-0"
                      onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                    />
                    <span className="font-medium text-accent">{heroArticle.source}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500 font-mono text-[11px]">{heroArticle.domain}</span>
                  </div>

                  {heroArticle.timeAgo && (
                    <div className="flex items-center gap-1 text-slate-500 text-[11px] font-mono">
                      <Clock className="w-3 h-3" />
                      <span>{heroArticle.timeAgo}</span>
                    </div>
                  )}
                </div>

                {/* Main Headline */}
                <h2 className="text-lg sm:text-2xl font-bold text-slate-100 group-hover:text-white leading-snug tracking-tight">
                  {heroArticle.title}
                </h2>

                {/* Actions */}
                <div className="flex items-center justify-between pt-3 border-t border-white/[0.05] text-xs">
                  <div className="flex items-center gap-1.5 text-accent font-medium group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 transition">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isArabic ? 'بدء بحث وتقصي معمق فوراً' : 'Start Deep Research Investigation'}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </div>

                  <button
                    type="button"
                    onClick={(e) => openLink(heroArticle.link, e)}
                    className="flex items-center gap-1 text-slate-500 hover:text-slate-300 transition py-1 px-2 rounded-lg hover:bg-white/5"
                    title={isArabic ? 'فتح المصدر في المتصفح' : 'Open source URL'}
                  >
                    <span>{isArabic ? 'المصدر الأصلي' : 'Original Source'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Grid of news cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {gridArticles.map((art) => (
              <div
                key={art.id}
                onClick={() => onSelectTopic(art.researchQuery)}
                className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.05] hover:border-white/[0.12] cursor-pointer transition-all duration-150 flex flex-col justify-between gap-3 group shadow-sm"
              >
                <div className="space-y-2">
                  {/* Card publisher & time */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <div className="flex items-center gap-1.5 truncate">
                      <img
                        src={`https://s2.googleusercontent.com/s2/favicons?domain_url=${encodeURIComponent(art.domain)}&sz=32`}
                        alt=""
                        className="w-3.5 h-3.5 rounded-sm shrink-0 opacity-80 group-hover:opacity-100"
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                      <span className="truncate font-medium text-slate-400 group-hover:text-slate-200 transition">
                        {art.source}
                      </span>
                    </div>
                    {art.timeAgo && (
                      <span className="shrink-0 font-mono text-[10.5px]">{art.timeAgo}</span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-xs sm:text-[13px] font-semibold text-slate-200 group-hover:text-accent transition leading-snug line-clamp-3">
                    {art.title}
                  </h3>
                </div>

                {/* Card footer */}
                <div className="flex items-center justify-between pt-2 border-t border-white/[0.04] text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 group-hover:text-accent transition font-medium">
                    <span>{isArabic ? 'بحث عميق' : 'Research'}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </span>

                  <button
                    type="button"
                    onClick={(e) => openLink(art.link, e)}
                    className="hover:text-slate-300 p-1 rounded hover:bg-white/5 transition"
                    title={isArabic ? 'المصدر الأصلي' : 'Source'}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
