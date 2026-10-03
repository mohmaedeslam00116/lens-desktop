import React, { useEffect, useRef } from 'react';
import type { Language } from '../../types';
import type { ChatArtifactKind, ChatLiveState, ChatTurn } from './types';
import { ConversationTurn } from './ConversationTurn';

interface ConversationThreadProps {
  language: Language;
  turns: ChatTurn[];
  live: ChatLiveState | null;
  onCancel: () => void;
  onFollowUp: (q: string) => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onInspectCitation: (turnId: string, index: number) => void;
  onOpenArtifact: (turnId: string, kind: ChatArtifactKind) => void;
  onReviewPlan: () => void;
  emptyHero: React.ReactNode;
}

/**
 * ConversationThread — the vertical message stream. The same component
 * renders live runs (progressive events) and restored history (persisted
 * turns): one conceptual conversation model, never two interfaces.
 */
export const ConversationThread: React.FC<ConversationThreadProps> = ({
  language,
  turns,
  live,
  onCancel,
  onFollowUp,
  onExport,
  onInspectCitation,
  onOpenArtifact,
  onReviewPlan,
  emptyHero,
}) => {
  const ar = language === 'ar';
  const endRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [turns.length, live?.liveReport.length, live?.currentStatus]);

  if (turns.length === 0) {
    return <>{emptyHero}</>;
  }

  return (
    <div className="chat-thread" data-testid="chat-thread" dir={ar ? 'rtl' : 'ltr'} role="log" aria-live="polite" aria-label={ar ? 'المحادثة' : 'Conversation'}>
      {turns.map((turn) => (
        <ConversationTurn
          key={turn.id}
          language={language}
          turn={turn}
          live={live}
          onCancel={onCancel}
          onFollowUp={onFollowUp}
          onExport={onExport}
          onInspectCitation={onInspectCitation}
          onOpenArtifact={onOpenArtifact}
          onReviewPlan={onReviewPlan}
        />
      ))}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
};
