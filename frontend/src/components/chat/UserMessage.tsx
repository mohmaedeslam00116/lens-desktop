import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Language } from '../../types';

interface UserMessageProps {
  query: string;
  language: Language;
  createdAt?: string;
}

/**
 * UserMessage — one user turn in the conversation timeline. A subtle
 * bubble, never a page heading: long prompts, multiline text, RTL,
 * selection and copy all work; timestamps stay hidden unless useful.
 */
export const UserMessage: React.FC<UserMessageProps> = ({ query, language, createdAt }) => {
  const ar = language === 'ar';
  const [copied, setCopied] = useState(false);
  const showTime = Boolean(createdAt);

  const handleCopy = () => {
    try {
      navigator.clipboard?.writeText(query)?.then?.(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }).catch(() => {});
    } catch { /* copy is a convenience, never a failure */ }
  };

  return (
    <div className="chat-turn-user" data-testid="chat-user-message">
      <div className="chat-user-label">
        <span>{ar ? 'أنت' : 'You'}</span>
        {showTime && (
          <time dateTime={createdAt} className="chat-user-time">
            {new Date(createdAt as string).toLocaleString(ar ? 'ar' : 'en')}
          </time>
        )}
      </div>
      <div className="chat-user-bubble" dir="auto">
        <p className="chat-user-text">{query}</p>
        <button
          type="button"
          className="chat-user-copy"
          onClick={handleCopy}
          aria-label={ar ? 'نسخ السؤال' : 'Copy question'}
          title={ar ? 'نسخ' : 'Copy'}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
};
