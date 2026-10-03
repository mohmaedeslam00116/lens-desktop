import React from 'react';
import { Languages, Moon, MoreHorizontal, PanelLeft, Sun } from 'lucide-react';
import type { ApiSettings, Language } from '../../types';

interface ChatHeaderProps {
  language: Language;
  conversationTitle: string;
  researching: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onToggleLanguage: () => void;
  onToggleSidebar: () => void;
  settings: ApiSettings;
  onOpenSettings: () => void;
}

/**
 * ChatHeader — the quiet top bar. `LENS / current conversation` plus
 * model, language, theme, more. Research state is a subtle indicator;
 * counters, timers and diagnostics live inside ResearchActivity.
 */
export const ChatHeader: React.FC<ChatHeaderProps> = ({
  language,
  conversationTitle,
  researching,
  theme,
  onToggleTheme,
  onToggleLanguage,
  onToggleSidebar,
  settings,
  onOpenSettings,
}) => {
  const ar = language === 'ar';
  const modelLabel = settings.custom_model_name || settings.model_name || settings.llm_provider;
  return (
    <header className="chat-header" data-testid="chat-header">
      <div className="chat-header-left">
        <button
          type="button"
          className="chat-header-rail-toggle"
          onClick={onToggleSidebar}
          aria-label={ar ? 'تبديل سجل البحث' : 'Toggle research history'}
          title={ar ? 'السجل' : 'History'}
        >
          <PanelLeft size={15} aria-hidden="true" />
        </button>
        <nav className="chat-breadcrumb" aria-label={ar ? 'الموقع الحالي' : 'Current location'}>
          <span dir="ltr">LENS</span>
          <span aria-hidden="true">/</span>
          <strong title={conversationTitle}>{conversationTitle || (ar ? 'محادثة جديدة' : 'New conversation')}</strong>
        </nav>
        {researching && (
          <span className="chat-header-live" role="status">
            <span className="chat-activity-dot" aria-hidden="true" data-running="true" />
            {ar ? 'يبحث…' : 'Researching…'}
          </span>
        )}
      </div>
      <div className="chat-header-controls">
        <button type="button" className="chat-header-model" onClick={onOpenSettings} title={ar ? 'النموذج' : 'Model'}>
          <bdi dir="ltr">{modelLabel}</bdi>
          <span aria-hidden="true">▾</span>
        </button>
        <button type="button" className="icon-button" onClick={onToggleLanguage} aria-label={ar ? 'تبديل اللغة' : 'Toggle language'}>
          <Languages size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onToggleTheme} aria-label={ar ? 'تبديل المظهر' : 'Toggle theme'}>
          {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-button" onClick={onOpenSettings} aria-label={ar ? 'المزيد' : 'More'}>
          <MoreHorizontal size={15} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};
