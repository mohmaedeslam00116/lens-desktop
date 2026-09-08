import React from 'react';
import { Activity, Database, Files, LibraryBig, Quote, SearchCheck } from 'lucide-react';
import { Language, WideResearchTelemetry as Telemetry } from '../../types';

interface WideResearchTelemetryProps {
  telemetry: Telemetry;
  language: Language;
  expansionHistory?: Telemetry[];
}

export const WideResearchTelemetry: React.FC<WideResearchTelemetryProps> = ({ telemetry, language, expansionHistory = [] }) => {
  const ar = language === 'ar';
  const metrics = [
    { label: ar ? 'مكتشفة' : 'Discovered', value: telemetry.discovered, icon: SearchCheck },
    { label: ar ? 'مجلوبة' : 'Fetched', value: telemetry.fetched, icon: Database },
    { label: ar ? 'فريدة' : 'Unique', value: telemetry.unique, icon: Files },
    { label: ar ? 'مقبولة' : 'Admitted', value: telemetry.admitted, icon: LibraryBig },
    { label: ar ? 'مستشهد بها' : 'Cited', value: telemetry.cited, icon: Quote },
  ];

  return (
    <section className="rounded-xl border border-line bg-surface p-4 space-y-3" aria-label={ar ? 'قياسات البحث الموسع' : 'Wide Research telemetry'} dir={ar ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-ink font-semibold"><Activity size={14} />{ar ? 'البحث الموسع' : 'Wide Research'}</span>
        <span className="font-mono text-muted">{ar ? 'ميزانية الاسترجاع:' : 'Retrieval budget:'} {telemetry.activeBudget} / {telemetry.maximumBudget}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {metrics.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-lg bg-hover border border-line p-2"><Icon size={13} className="text-muted mb-1" /><div className="font-mono text-ink">{value}</div><div className="text-[10px] text-muted">{label}</div></div>)}
      </div>
      {typeof telemetry.coverageScore === 'number' && <p className="text-xs text-muted">{ar ? 'تغطية الأدلة:' : 'Evidence coverage:'} <span className="font-mono text-ink">{Math.round(telemetry.coverageScore * 100)}%</span></p>}
      {expansionHistory.length > 0 && <ol className="border-t border-line pt-3 space-y-2 text-xs text-muted" aria-label={ar ? 'سجل توسيع الميزانية' : 'Budget expansion history'}>{expansionHistory.map((item, index) => item.expansion && <li key={`${item.expansion.from}-${item.expansion.to}-${index}`}><span className="text-ink">{item.expansion.from} → {item.expansion.to}</span>{': '}{item.expansion.reason}</li>)}</ol>}
    </section>
  );
};
