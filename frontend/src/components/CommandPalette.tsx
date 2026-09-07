import React, { useState, useEffect } from 'react';
import { Search, Plus, Settings, Globe, Download, Cpu, X, Zap } from 'lucide-react';
import { Language, ApiSettings, LLMProvider } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onNewResearch: () => void;
  onOpenSettings: () => void;
  onToggleLanguage: () => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  hasActiveReport: boolean;
  settings: ApiSettings;
  onUpdateSettings: (newSettings: ApiSettings) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = (props) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const dialogRef = useDialogFocus(props.isOpen, props.onClose);
  const ar = props.language === 'ar';
  useEffect(() => { if (props.isOpen) { setQuery(''); setSelected(0); } }, [props.isOpen]);
  if (!props.isOpen) return null;
  const commands = [
    { id: 'new', title: ar ? 'بحث جديد' : 'New research', icon: Plus, action: props.onNewResearch },
    { id: 'settings', title: ar ? 'إعدادات النماذج والمفاتيح' : 'Model and API settings', icon: Settings, action: props.onOpenSettings },
    { id: 'language', title: ar ? 'Switch to English' : 'التحويل للعربية', icon: Globe, action: props.onToggleLanguage },
    ...(props.hasActiveReport ? (['pdf', 'docx', 'markdown'] as const).map(format => ({ id: format, title: `${ar ? 'تصدير التقرير' : 'Export report'} · ${format.toUpperCase()}`, icon: Download, action: () => props.onExport(format) })) : []),
    ...(['gemini', 'openai', 'anthropic', 'deepseek', 'groq', 'ollama', 'openrouter'] as LLMProvider[]).map(provider => ({
      id: provider, title: `${ar ? 'استخدام' : 'Use'} ${provider}`, icon: Cpu,
      action: () => props.onUpdateSettings({ ...props.settings, llm_provider: provider, model_name: '', custom_model_name: '' }),
    })),
    ...(['duckduckgo', 'tavily'] as const).map(provider => ({ id: provider, title: `${ar ? 'البحث باستخدام' : 'Search with'} ${provider}`, icon: Zap, action: () => props.onUpdateSettings({ ...props.settings, search_provider: provider }) })),
  ];
  const filtered = commands.filter(command => command.title.toLowerCase().includes(query.trim().toLowerCase()));
  const run = (action: () => void) => { props.onClose(); action(); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/70 p-4" onClick={event => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={ar ? 'الأوامر' : 'Commands'} className="w-full max-w-xl bg-panel border border-line rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-line">
          <Search size={17} className="text-muted" />
          <input value={query} onChange={e => { setQuery(e.target.value); setSelected(0); }} aria-label={ar ? 'البحث في الأوامر' : 'Search commands'} placeholder={ar ? 'ابحث عن إجراء…' : 'Find an action…'} className="min-w-0 flex-1 bg-transparent text-sm outline-none" onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
            } else if (event.key === 'Enter' && filtered[selected]) { event.preventDefault(); run(filtered[selected].action); }
          }} />
          <button className="icon-button" onClick={props.onClose} aria-label={ar ? 'إغلاق الأوامر' : 'Close commands'}><X size={16} /></button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {!filtered.length && <p className="py-8 text-center text-sm text-muted">{ar ? 'لا توجد أوامر مطابقة.' : 'No matching commands.'}</p>}
          {filtered.map((command, index) => <button key={command.id} onClick={() => run(command.action)} className={`w-full flex items-center gap-3 p-3 rounded-lg text-start text-sm ${index === selected ? 'bg-surface text-ink' : 'text-muted hover:bg-surface'}`}><command.icon size={16} /><span>{command.title}</span></button>)}
        </div>
      </div>
    </div>
  );
};
