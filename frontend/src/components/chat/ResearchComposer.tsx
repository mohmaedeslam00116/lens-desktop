import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Cpu, Loader2 } from 'lucide-react';
import type { ApiSettings, Language, ResearchMode } from '../../types';

export type ComposerInteraction = 'agent' | 'deep-research';

interface ResearchComposerProps {
  language: Language;
  variant: 'new' | 'active';
  loading: boolean;
  runLive: boolean;
  interaction: ComposerInteraction;
  onSelectInteraction: (i: ComposerInteraction) => void;
  settings: ApiSettings;
  onOpenSettings: () => void;
  optimizationMode: 'speed' | 'balanced' | 'quality';
  setOptimizationMode: (m: 'speed' | 'balanced' | 'quality') => void;
  sourceFocus: 'web' | 'academic' | 'social';
  setSourceFocus: (f: 'web' | 'academic' | 'social') => void;
  researchMode: ResearchMode;
  setResearchMode: (m: ResearchMode) => void;
  initialValue?: string;
  onValueChange?: (v: string) => void;
  onSubmit: (question: string) => void;
}

/**
 * ResearchComposer — the single shared composer for new and active
 * conversations. Enter sends, Shift+Enter newlines, steering wins while a
 * run is live, and Deep Research progressively discloses its tuning. The
 * loading state is truthful: spinner only while the engine works.
 */
export const ResearchComposer: React.FC<ResearchComposerProps> = ({
  language,
  variant,
  loading,
  runLive,
  interaction,
  onSelectInteraction,
  settings,
  onOpenSettings,
  optimizationMode,
  setOptimizationMode,
  sourceFocus,
  setSourceFocus,
  researchMode,
  setResearchMode,
  initialValue,
  onValueChange,
  onSubmit,
}) => {
  const ar = language === 'ar';
  const [local, setLocal] = useState('');
  const [modeOpen, setModeOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modeTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Dismiss the mode menu on Escape / outside click and return focus.
  useEffect(() => {
    if (!modeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setModeOpen(false);
        modeTriggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const el = document.querySelector('.chat-mode-menu');
      if (el && !el.contains(e.target as Node)) setModeOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [modeOpen]);
  const value = initialValue !== undefined ? initialValue : local;
  const setValue = (v: string) => {
    if (onValueChange) onValueChange(v);
    else setLocal(v);
  };
  const busy = loading && !runLive;
  const modelLabel = settings.custom_model_name || settings.model_name || settings.llm_provider;
  const showTuning = interaction === 'deep-research';

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (busy) return;
    // While live, sending steers the run (queued visibly) — always allowed.
    onSubmit(trimmed);
    setValue('');
    textareaRef.current?.focus();
  };

  return (
    <div className={`chat-composer chat-composer--${variant}`} data-testid="chat-composer">
      <form
        className="chat-composer-box"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <label htmlFor={variant === 'new' ? 'chat-new-question' : 'chat-followup'} className="sr-only">
          {ar ? 'سؤال البحث' : 'Research question'}
        </label>
        <textarea
          id={variant === 'new' ? 'chat-new-question' : 'chat-followup'}
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={variant === 'new' ? 3 : 1}
          placeholder={
            ar
              ? (runLive ? 'وجّه الوكيل أثناء عمله…' : variant === 'new' ? 'ما الذي تريد فهمه بعمق؟' : 'اطرح سؤال متابعة…')
              : (runLive ? 'Steer the running agent…' : variant === 'new' ? 'Ask anything about your research…' : 'Ask a follow-up…')
          }
          aria-describedby="chat-composer-hint"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="chat-composer-toolbar">
          <div className="chat-composer-tools">
            <div className="chat-mode-menu">
              <button
                ref={modeTriggerRef}
                type="button"
                className="chat-mode-trigger"
                onClick={() => setModeOpen((o) => !o)}
                aria-expanded={modeOpen}
                aria-haspopup="listbox"
                aria-label={ar ? 'نمط الإجابة' : 'Answer mode'}
              >
                <span>{interaction === 'agent' ? (ar ? 'بحث وكيل' : 'Agentic Search') : (ar ? 'البحث المعمّق' : 'Deep Research')}</span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {modeOpen && (
                <ul className="chat-mode-list" role="listbox" aria-label={ar ? 'نمط الإجابة' : 'Answer mode'}>
                  <li role="option" aria-selected={interaction === 'agent'}>
                    <button type="button" onClick={() => { onSelectInteraction('agent'); setModeOpen(false); }}>
                      <strong>{ar ? 'بحث وكيل' : 'Agentic Search'}</strong>
                      <span>{ar ? 'إجابات سريعة مدعومة بالويب' : 'Fast web-grounded answers'}</span>
                    </button>
                  </li>
                  <li role="option" aria-selected={interaction === 'deep-research'}>
                    <button type="button" onClick={() => { onSelectInteraction('deep-research'); setModeOpen(false); }}>
                      <strong>{ar ? 'البحث المعمّق' : 'Deep Research'}</strong>
                      <span>{ar ? 'خطط، ثم استقصِ، ثم لخّص' : 'Plan, investigate, synthesize'}</span>
                    </button>
                  </li>
                </ul>
              )}
            </div>
            {showTuning && (
              <>
                <label className="chat-composer-select">
                  <span className="sr-only">{ar ? 'وضع البحث' : 'Research mode'}</span>
                  <select value={researchMode} onChange={(e) => setResearchMode(e.target.value as ResearchMode)}>
                    <option value="standard">{ar ? 'قياسي' : 'Standard'}</option>
                    <option value="wide">{ar ? 'موسّع' : 'Wide'}</option>
                  </select>
                </label>
                <label className="chat-composer-select">
                  <span className="sr-only">{ar ? 'عمق البحث' : 'Depth'}</span>
                  <select value={optimizationMode} onChange={(e) => setOptimizationMode(e.target.value as ResearchComposerProps['optimizationMode'])}>
                    <option value="speed">{ar ? 'سريع' : 'Quick'}</option>
                    <option value="balanced">{ar ? 'متوازن' : 'Balanced'}</option>
                    <option value="quality">{ar ? 'عميق' : 'Deep'}</option>
                  </select>
                </label>
                <label className="chat-composer-select">
                  <span className="sr-only">{ar ? 'نطاق المصادر' : 'Source focus'}</span>
                  <select value={sourceFocus} onChange={(e) => setSourceFocus(e.target.value as ResearchComposerProps['sourceFocus'])}>
                    <option value="web">{ar ? 'الويب' : 'Web'}</option>
                    <option value="academic">{ar ? 'أكاديمي' : 'Academic'}</option>
                    <option value="social">{ar ? 'المجتمعات' : 'Community'}</option>
                  </select>
                </label>
              </>
            )}
            <button type="button" className="chat-model-control" onClick={onOpenSettings} title={ar ? 'اختيار النموذج' : 'Choose model'}>
              <Cpu size={13} aria-hidden="true" />
              <bdi dir="ltr">{modelLabel}</bdi>
            </button>
          </div>
          <button type="submit" className="chat-send" disabled={!value.trim() || busy} aria-label={ar ? 'إرسال' : 'Send'} title={ar ? 'إرسال' : 'Send'}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </form>
      <div className="chat-composer-meta">
        <span id="chat-composer-hint">{ar ? 'Enter للإرسال · Shift + Enter لسطر جديد' : 'Enter to send · Shift + Enter for a new line'}</span>
        {runLive && <span role="status">{ar ? 'الوكيل يعمل — إرسالك يوجّهه.' : 'Agent working — sending steers it.'}</span>}
        {!runLive && loading && <span role="status">{ar ? 'البحث يعمل — يمكن الإيقاف من نشاط البحث.' : 'Research running — you can stop it from the research activity.'}</span>}
      </div>
    </div>
  );
};
