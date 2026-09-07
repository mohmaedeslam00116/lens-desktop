import React from 'react';
import { Compass, Search, Settings, Globe, ChevronDown, Sparkles } from 'lucide-react';
import { Language, ApiSettings } from '../../types';

interface TitleBarProps {
  language: Language;
  onToggleLanguage: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  activeTitle?: string;
  settings: ApiSettings;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  language,
  onToggleLanguage,
  onOpenSettings,
  onOpenCommandPalette,
  activeTitle,
  settings
}) => {
  const getModelLabel = () => {
    if (settings.model_name) return settings.model_name;
    return language === 'ar' ? 'لم يُحدد نموذج' : 'No model';
  };

  return (
    <header 
      className="h-[35px] bg-vscode-titlebar border-b border-vscode-border flex items-center justify-between px-2 text-xs select-none z-30"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Left: App Logo & Minimal IDE Menu */}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-vscode-hover transition cursor-pointer">
          <Compass className="w-3.5 h-3.5 text-blue-400 animate-spin-slow" />
          <span className="font-semibold text-vscode-textActive tracking-tight text-[11px]">
            DeepResearch
          </span>
        </div>

        {/* IDE Menus */}
        <div className="hidden sm:flex items-center text-[11px] text-vscode-textMuted">
          <span className="px-2 py-0.5 rounded hover:bg-vscode-hover hover:text-vscode-textNormal cursor-pointer transition">ملف</span>
          <span className="px-2 py-0.5 rounded hover:bg-vscode-hover hover:text-vscode-textNormal cursor-pointer transition">تحرير</span>
          <span className="px-2 py-0.5 rounded hover:bg-vscode-hover hover:text-vscode-textNormal cursor-pointer transition">عرض</span>
          <span className="px-2 py-0.5 rounded hover:bg-vscode-hover hover:text-vscode-textNormal cursor-pointer transition">الوكيل</span>
        </div>
      </div>

      {/* Center: Command Search Bar */}
      <div 
        onClick={onOpenCommandPalette}
        className="flex-1 max-w-md mx-4 flex items-center justify-center cursor-pointer"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <div className="w-full flex items-center justify-between px-3 py-1 rounded bg-vscode-input border border-vscode-border hover:border-slate-600 transition text-[11px] text-vscode-textMuted shadow-inner">
          <div className="flex items-center gap-1.5 truncate">
            <Search className="w-3 h-3 text-vscode-textMuted flex-shrink-0" />
            <span className="truncate text-vscode-textNormal">
              {activeTitle ? `${activeTitle} — Deep Research` : 'البحث في الأوامر والجلسات...'}
            </span>
          </div>
          <kbd className="px-1 py-0.2 rounded bg-[#222222] text-vscode-textMuted border border-vscode-border font-mono text-[9px]">
            Ctrl+K
          </kbd>
        </div>
      </div>

      {/* Right: Model badge, Language, Settings, and Native Window Controls Offset */}
      <div 
        className="flex items-center gap-1.5 pr-32" 
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* Model Tag Pill */}
        <div 
          onClick={onOpenSettings}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-vscode-hover hover:bg-[#333] border border-vscode-border text-[10px] font-mono text-blue-400 cursor-pointer transition"
          title="النموذج النشط"
        >
          <Sparkles className="w-2.5 h-2.5" />
          <span>{getModelLabel()}</span>
        </div>

        {/* Language switcher */}
        <button
          onClick={onToggleLanguage}
          className="px-1.5 py-0.5 rounded text-vscode-textMuted hover:text-vscode-textNormal hover:bg-vscode-hover text-[11px] transition flex items-center gap-1"
          title="تغيير لغة العرض"
        >
          <Globe className="w-3 h-3 text-vscode-textMuted" />
          <span>{language === 'ar' ? 'EN' : 'عربي'}</span>
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="p-1 rounded text-vscode-textMuted hover:text-vscode-textNormal hover:bg-vscode-hover transition"
          title="الإعدادات"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
