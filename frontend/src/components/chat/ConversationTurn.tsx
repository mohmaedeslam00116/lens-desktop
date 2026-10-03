import React from 'react';
import { ListTree } from 'lucide-react';
import type { Language } from '../../types';
import type { ChatArtifactKind, ChatLiveState, ChatTurn } from './types';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';

interface ConversationTurnProps {
  language: Language;
  turn: ChatTurn;
  live: ChatLiveState | null;
  onCancel: () => void;
  onFollowUp: (q: string) => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onInspectCitation: (turnId: string, index: number) => void;
  onOpenArtifact: (turnId: string, kind: ChatArtifactKind) => void;
  onReviewPlan: () => void;
}

/**
 * ConversationTurn — one user message followed by its LENS response
 * (activity, answer, citations, sources). A pending plan renders as an
 * inline conversation artifact that opens the preserved approval overlay.
 */
export const ConversationTurn: React.FC<ConversationTurnProps> = ({
  language,
  turn,
  live,
  onCancel,
  onFollowUp,
  onExport,
  onInspectCitation,
  onOpenArtifact,
  onReviewPlan,
}) => {
  const ar = language === 'ar';
  const showPlanCard = turn.status === 'running' && turn.interaction === 'deep-research' && turn.plan && !turn.report;
  return (
    <article className="chat-turn" data-testid="chat-turn" data-turn-id={turn.id}>
      <UserMessage query={turn.query} language={language} createdAt={turn.createdAt} />
      {showPlanCard && turn.plan && (
        <section className="chat-plan-card" aria-label={ar ? 'خطة البحث' : 'Research plan'} data-testid="chat-plan-card">
          <header className="chat-plan-head">
            <ListTree size={14} aria-hidden="true" />
            <h3>{ar ? 'خطة البحث' : 'Research plan'}</h3>
          </header>
          <p className="chat-plan-objective" dir="auto">{turn.plan.objective}</p>
          <ol className="chat-plan-steps">
            {turn.plan.milestones.slice(0, 5).map((m, i) => (
              <li key={m.id} dir="auto"><span aria-hidden="true">{i + 1}. </span>{m.query}</li>
            ))}
          </ol>
          <div className="chat-plan-actions">
            <button type="button" className="chat-plan-review" onClick={onReviewPlan}>
              {ar ? 'مراجعة الخطة وبدء البحث' : 'Review plan & start'}
            </button>
          </div>
        </section>
      )}
      <AssistantMessage
        language={language}
        turn={turn}
        live={turn.live ? live : null}
        onCancel={onCancel}
        onFollowUp={onFollowUp}
        onExport={onExport}
        onInspectCitation={(index) => onInspectCitation(turn.id, index)}
        onOpenArtifact={(kind) => onOpenArtifact(turn.id, kind)}
      />
    </article>
  );
};
