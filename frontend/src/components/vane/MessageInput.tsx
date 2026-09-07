import React, { useState, useRef } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { Language } from '../../types';

interface MessageInputProps {
  onSendMessage: (msg: string) => void;
  loading: boolean;
  language: Language;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  loading,
  language,
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
          aria-label={isArabic ? 'سؤال متابعة' : 'Follow-up question'}
          placeholder={isArabic ? 'اطرح سؤال متابعة أو اطلب تفاصيل إضافية...' : 'Ask a follow-up question...'}
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
    </div>
  );
};
