import React, { useState, useRef } from 'react';
import { ArrowUp, Loader2, ArrowDownUp } from 'lucide-react';
import { Language } from '../../types';
import { AgentInteractionSwitch } from '../harness/AgentInteractionSwitch';
import type { AgentInteraction } from '../harness/LensHarnessWorkspace';

interface MessageInputProps {
  onSendMessage: (msg: string) => void;
  loading: boolean;
  language: Language;
  /** True while an agentic run is live: sending STEERS it (queued visibly). */
  runLive?: boolean;
  interaction: AgentInteraction;
  onSelectInteraction: (interaction: AgentInteraction) => void;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  loading,
  language,
  runLive,
  interaction,
  onSelectInteraction,
}) => {
  const isArabic = language === 'ar';
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="sticky bottom-4 w-full max-w-3xl mx-auto px-4 z-30">
      <div className="harness-composer-switch">
        <AgentInteractionSwitch
          interaction={interaction}
          onSelect={onSelectInteraction}
          language={language}
        />
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex items-center bg-panel/95  border border-line focus-within:border-accent/50   rounded-2xl px-4 py-2.5 transition"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label={isArabic ? (runLive ? 'توجيه الوكيل' : 'سؤال متابعة') : (runLive ? 'Steer the agent' : 'Follow-up question')}
          placeholder={
            isArabic
              ? (runLive ? 'وجّه الوكيل أثناء عمله…' : 'اطرح سؤال متابعة أو اطلب تفاصيل إضافية...')
              : (runLive ? 'Steer the running agent…' : 'Ask a follow-up question...')
          }
          className="flex-1 min-w-0 bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none resize-none max-h-32 py-1"
        />

        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="primary-button ms-2"
          title={isArabic ? 'إرسال' : 'Send'}
          aria-label={isArabic ? 'إرسال' : 'Send'}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowUp className="w-4 h-4" />
          )}
        </button>
      </form>
      {runLive && (
        <p className="harness-steer-hint" role="status">
          <ArrowDownUp size={12} aria-hidden="true" />
          <span>
            {isArabic
              ? 'الوكيل يعمل — إرسالك يوجّهه عبر قائمة الانتظار المرئية.'
              : 'Agent is working — sending steers it (queued visibly).'}
          </span>
        </p>
      )}
    </div>
  );
};
