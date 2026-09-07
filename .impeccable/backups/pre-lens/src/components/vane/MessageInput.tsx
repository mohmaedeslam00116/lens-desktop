import React, { useState, useRef } from 'react';
import { ArrowRight, Loader2, Sparkles, Send } from 'lucide-react';
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="sticky bottom-4 w-full max-w-3xl mx-auto px-4 z-30">
      <form
        onSubmit={handleSubmit}
        className="flex items-center bg-[#161b22]/95 backdrop-blur-md border border-[#21262d] focus-within:border-sky-500/50 shadow-2xl shadow-black/50 rounded-2xl px-4 py-2.5 transition"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={isArabic ? 'اطرح سؤال متابعة أو اطلب تفاصيل إضافية...' : 'Ask a follow-up question...'}
          className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none resize-none max-h-32 py-1"
        />

        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="w-8 h-8 rounded-full bg-sky-500 hover:bg-sky-400 disabled:opacity-35 disabled:hover:bg-sky-500 text-white flex items-center justify-center transition shrink-0 ml-2 rtl:mr-2 rtl:ml-0 shadow-sm active:scale-95"
          title="Send"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
        </button>
      </form>
    </div>
  );
};
