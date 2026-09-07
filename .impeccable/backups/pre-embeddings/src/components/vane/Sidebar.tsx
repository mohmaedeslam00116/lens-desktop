import React from 'react';
import { Plus, Home, Compass, BookOpen, Network, Settings, Globe, Moon, Sun } from 'lucide-react';
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

export const Sidebar: React.FC<SidebarProps> = (props) => {
  const ar = props.language === 'ar';
  const items = [
    { id: 'home' as const, icon: Home, label: ar ? 'الرئيسية' : 'Home' },
    { id: 'discover' as const, icon: Compass, label: ar ? 'استكشف' : 'Discover' },
    { id: 'history' as const, icon: BookOpen, label: ar ? 'المكتبة' : 'Library' },
    { id: 'graph' as const, icon: Network, label: ar ? 'الخريطة' : 'Graph' },
  ];
  return (
    <aside className="app-rail" aria-label={ar ? 'شريط التطبيق' : 'Application sidebar'}>
      <button className="rail-brand" onClick={props.onNewResearch} aria-label={ar ? 'LENS — الصفحة الرئيسية' : 'LENS — Home'}>
        <BrandLogo withText={false} />
      </button>
      <button className="rail-new" onClick={props.onNewResearch} title={ar ? 'بحث جديد (Ctrl+N)' : 'New research (Ctrl+N)'} aria-label={ar ? 'بحث جديد' : 'New research'}><Plus size={20} /></button>
      <nav className="rail-nav" aria-label={ar ? 'التنقل الرئيسي' : 'Main navigation'}>
        {items.map(({ id, icon: Icon, label }) => (
          <button key={id} className="rail-item" aria-current={props.activeTab === id ? 'page' : undefined} onClick={() => props.onSelectTab(id)} title={label}>
            <Icon size={19} strokeWidth={1.65} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="rail-preferences">
        <button className="icon-button" onClick={props.onToggleLanguage} title={ar ? 'Switch to English' : 'التحويل للعربية'} aria-label={ar ? 'Switch to English' : 'التحويل للعربية'}><Globe size={18} /></button>
        <button className="icon-button" onClick={props.onToggleTheme} title={props.theme === 'dark' ? (ar ? 'الوضع الفاتح' : 'Light mode') : (ar ? 'الوضع الداكن' : 'Dark mode')} aria-label={props.theme === 'dark' ? (ar ? 'الوضع الفاتح' : 'Light mode') : (ar ? 'الوضع الداكن' : 'Dark mode')}>
          {props.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button className="icon-button" onClick={props.onOpenSettings} title={ar ? 'الإعدادات' : 'Settings'} aria-label={ar ? 'الإعدادات' : 'Settings'}><Settings size={18} /></button>
      </div>
    </aside>
  );
};
