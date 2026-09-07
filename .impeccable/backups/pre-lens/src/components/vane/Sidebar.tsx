import React from 'react';
import { 
  Plus, 
  Home, 
  Compass,
  History, 
  Network, 
  Settings, 
  Globe, 
  Moon, 
  Sun,
  Sparkles
} from 'lucide-react';
import { Language } from '../../types';
import { BrandLogo } from '../brand/BrandLogo';

interface SidebarProps {
  activeTab: 'home' | 'discover' | 'history' | 'graph';
  onSelectTab: (tab: 'home' | 'discover' | 'history' | 'graph') => void;
  onNewResearch: () => void;
  onOpenSettings: () => void;
  language: Language;
  onToggleLanguage: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  onNewResearch,
  onOpenSettings,
  language,
  onToggleLanguage,
  theme,
  onToggleTheme,
}) => {
  const isArabic = language === 'ar';

  const navItems = [
    {
      id: 'home' as const,
      icon: Home,
      label: isArabic ? 'الرئيسية' : 'Home',
    },
    {
      id: 'discover' as const,
      icon: Compass,
      label: isArabic ? 'استكشف' : 'Discover',
    },
    {
      id: 'history' as const,
      icon: History,
      label: isArabic ? 'السجل' : 'Library',
    },
    {
      id: 'graph' as const,
      icon: Network,
      label: isArabic ? 'المخطط' : 'Graph',
    },
  ];

  return (
    <aside className="w-[72px] h-full flex flex-col items-center justify-between py-5 bg-[#0d1117] border-r border-[#21262d] select-none z-30 shrink-0">
      {/* Top Section: Logo & New Research button */}
      <div className="flex flex-col items-center gap-5 w-full">
        {/* Brand Icon */}
        <div 
          onClick={onNewResearch}
          className="cursor-pointer hover:scale-105 transition active:scale-95"
          title="كاشف | KASHIF AI"
        >
          <BrandLogo size="md" withText={false} />
        </div>

        {/* Plus Button (New Chat) */}
        <button
          onClick={onNewResearch}
          className="w-10 h-10 rounded-full bg-[#21262d] text-white/90 hover:text-white hover:bg-sky-500 transition duration-200 flex items-center justify-center shadow-sm hover:scale-105 active:scale-95"
          title={isArabic ? 'بحث جديد' : 'New Research'}
        >
          <Plus className="w-5 h-5" />
        </button>

        <div className="w-8 h-[1px] bg-[#21262d]" />

        {/* Navigation Items */}
        <div className="flex flex-col items-center gap-2 w-full px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full py-2.5 rounded-xl flex flex-col items-center gap-1 transition duration-200 group relative ${
                  isActive 
                    ? 'bg-[#161b22] text-sky-400 font-medium' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#161b22]/50'
                }`}
                title={item.label}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-sky-400' : 'group-hover:scale-110'} transition`} />
                <span className="text-[10px] tracking-tight">{item.label}</span>
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-sky-500 rounded-r" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Section: Preferences & Settings */}
      <div className="flex flex-col items-center gap-2 w-full px-2">
        {/* Language Toggle */}
        <button
          onClick={onToggleLanguage}
          className="w-10 h-10 rounded-xl text-slate-400 hover:text-white hover:bg-[#161b22] flex items-center justify-center transition"
          title={isArabic ? 'Switch to English' : 'التحويل للعربية'}
        >
          <Globe className="w-4 h-4" />
        </button>

        {/* Theme Toggle */}
        <button
          onClick={onToggleTheme}
          className="w-10 h-10 rounded-xl text-slate-400 hover:text-white hover:bg-[#161b22] flex items-center justify-center transition"
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Settings Dialog Trigger */}
        <button
          onClick={onOpenSettings}
          className="w-10 h-10 rounded-xl text-slate-400 hover:text-white hover:bg-[#161b22] flex items-center justify-center transition"
          title={isArabic ? 'الإعدادات والمفاتيح' : 'Settings'}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
