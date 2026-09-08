import React from 'react';
import { Activity, Database, Files, LibraryBig, Quote, SearchCheck } from 'lucide-react';
import { Language, WideResearchTelemetry as Telemetry } from '../../types';

interface WideResearchTelemetryProps {
  telemetry: Telemetry;
  language: Language;
}

export const WideResearchTelemetry: React.FC<WideResearchTelemetryProps> = ({ telemetry, language }) => {
  const ar = language === 'ar';
  const metrics = [
    { label: ar ? 'مكتشفة' : 'Discovered', value: telemetry.discovered, icon: SearchCheck },
    { label: ar ? 'مجلوبة' : 'Fetched', value: telemetry.fetched, icon: Database },
    { label: ar ? 'فريدة' : 'Unique', value: telemetry.unique, icon: Files },
    { label: ar ? 'مقبولة' : 'Admitted', value: telemetry.admitted, icon: LibraryBig },
    { label: ar ? 'مستشهد بها' : 'Cited', value: telemetry.cited, icon: Quote },
  ];

  return (
    <section className="rounded-xl border border-[#303030] bg-[#141414] p-4 space-y-3" aria-label={ar ? 'قياسات البحث الموسع' : 'Wide Research telemetry'} dir={ar ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-[#EDEDEB] font-semibold"><Activity size={14} />{ar ? 'البحث الموسع' : 'Wide Research'}</span>
        <span className="font-mono text-[#A0A0A0]">{telemetry.activeBudget} / {telemetry.maximumBudget} {ar ? 'مصدرًا' : 'sources'}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {metrics.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-lg bg-[#111111] border border-[#292929] p-2"><Icon size={13} className="text-[#A0A0A0] mb-1" /><div className="font-mono text-[#EDEDEB]">{value}</div><div className="text-[10px] text-[#8E8E8E]">{label}</div></div>)}
      </div>
      {typeof telemetry.coverageScore === 'number' && <p className="text-xs text-[#A0A0A0]">{ar ? 'تغطية الأدلة:' : 'Evidence coverage:'} <span className="font-mono text-[#EDEDEB]">{Math.round(telemetry.coverageScore * 100)}%</span></p>}
      {telemetry.expansion && <p className="text-xs text-[#D0D0D0]">{ar ? 'تم توسيع الميزانية' : 'Budget expanded'} {telemetry.expansion.from} → {telemetry.expansion.to}: {telemetry.expansion.reason}</p>}
    </section>
  );
};
