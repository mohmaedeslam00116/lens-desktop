import React, { useState } from 'react';
import { Search, Trash2, ArrowRight, BookOpen, Clock, Plus } from 'lucide-react';
import { ResearchHistoryItem, Language } from '../../types';

interface LibraryViewProps {
  history: ResearchHistoryItem[];
  onSelectReport: (item: ResearchHistoryItem) => void;
  onClearHistory: () => void;
  onNewResearch: () => void;
  language: Language;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ history, onSelectReport, onClearHistory, onNewResearch, language }) => {
  const ar = language === 'ar';
  const [filter, setFilter] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const filtered = history.filter(item => `${item.query} ${item.report}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  return (
    <section className="w-full max-w-4xl mx-auto px-6 py-10 space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-semibold text-ink">{ar ? 'مكتبتك البحثية' : 'Your research library'}</h1><p className="text-sm text-muted mt-2">{ar ? 'أفكار استكشفتها. معرفة يمكنك العودة إليها.' : 'Ideas explored. Knowledge worth returning to.'}</p></div>
        {history.length > 0 && <button onClick={() => setConfirmClear(true)} className="icon-button" aria-label={ar ? 'مسح السجل' : 'Clear history'} title={ar ? 'مسح السجل' : 'Clear history'}><Trash2 size={17} /></button>}
      </div>
      {confirmClear && <div className="flex flex-wrap items-center gap-3 p-4 border border-line rounded-lg" role="alert"><p className="flex-1 text-sm">{ar ? 'حذف جميع الأبحاث المحفوظة؟ لا يمكن التراجع عن هذا الإجراء.' : 'Delete all saved research? This cannot be undone.'}</p><button className="text-sm px-3 py-2" onClick={() => setConfirmClear(false)}>{ar ? 'إلغاء' : 'Cancel'}</button><button className="text-sm text-rose-400 px-3 py-2" onClick={() => { onClearHistory(); setConfirmClear(false); }}>{ar ? 'حذف الكل' : 'Delete all'}</button></div>}
      {history.length > 0 && <div className="relative"><Search size={16} className="absolute start-3 top-3 text-muted" /><input value={filter} onChange={e => setFilter(e.target.value)} aria-label={ar ? 'البحث في المكتبة' : 'Search library'} placeholder={ar ? 'ابحث بعنوان أو محتوى التقرير…' : 'Search titles or report contents…'} className="w-full ps-10 pe-4 py-3 text-sm bg-panel border border-line rounded-lg" /></div>}
      {filtered.length === 0 ? <div className="library-empty"><BookOpen size={32} strokeWidth={1.4} className="text-muted" /><h2>{filter ? (ar ? 'لا توجد نتائج مطابقة' : 'No matching research') : (ar ? 'أول سؤال هو البداية' : 'It starts with a question')}</h2><p>{filter ? (ar ? 'جرّب كلمات أخرى أو امسح البحث لعرض مكتبتك.' : 'Try another phrase or clear the search to see your library.') : (ar ? 'ستجد أبحاثك وتقاريرك هنا بعد اكتمالها، للقراءة والمتابعة والتصدير.' : 'Your completed reports will live here, ready to read, revisit, and export.')}</p>{filter ? <button className="primary-button mt-2" onClick={() => setFilter('')}>{ar ? 'مسح البحث' : 'Clear search'}</button> : <button className="primary-button mt-2" onClick={onNewResearch}><Plus size={15} />{ar ? 'ابدأ بحثًا جديدًا' : 'Start a research'}</button>}</div> : <div>{filtered.map(item => <button key={item.id} className="library-report" onClick={() => onSelectReport(item)}><div className="min-w-0"><h3 className="text-sm font-medium text-ink leading-relaxed">{item.query}</h3><div className="flex flex-wrap items-center gap-3 text-xs text-muted mt-2"><span className="flex items-center gap-1"><Clock size={12} />{new Date(item.timestamp).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span><span>{item.sources?.length || 0} {ar ? 'مصادر' : 'sources'}</span></div></div><ArrowRight size={17} className="direction-arrow text-muted" /></button>)}</div>}
    </section>
  );
};
