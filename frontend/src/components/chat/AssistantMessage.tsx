import React, { Suspense, useState } from 'react';
import { Bot } from 'lucide-react';
import type { Language } from '../../types';
import type { ChatArtifactKind, ChatLiveState, ChatTurn } from './types';
import { ResearchActivity } from './ResearchActivity';
import { CitationList } from './CitationList';
import { InlineSources } from './InlineSources';
import { AssistantActions } from './AssistantActions';
import { FollowUpSuggestions } from './FollowUpSuggestions';
import { ReportCanvas } from '../vane/ReportCanvas';

interface AssistantMessageProps {
  language: Language;
  turn: ChatTurn;
  live: ChatLiveState | null;
  onCancel: () => void;
  onFollowUp: (q: string) => void;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onInspectCitation: (index: number) => void;
  onOpenArtifact: (kind: ChatArtifactKind) => void;
}

/**
 * AssistantMessage — the primary visual object. No dashboard card: LENS
 * mark, research activity (compact), answer body, citations, sources,
 * actions, follow-ups. Deep Research completions render summary + full
 * report as the same answer shape with an artifact launcher.
 */
export const AssistantMessage: React.FC<AssistantMessageProps> = ({
  language,
  turn,
  live,
  onCancel,
  onFollowUp,
  onExport,
  onInspectCitation,
  onOpenArtifact,
}) => {
  const ar = language === 'ar';
  const [copied, setCopied] = useState(false);
  const isLive = turn.live === true && live !== null;
  const report = turn.live ? (live?.liveReport || turn.report) : turn.report;
  const sources = turn.sources;
  const streaming = isLive && live !== null && live.loading && !report;

  const handleCopy = () => {
    try {
      navigator.clipboard?.writeText(report)?.then?.(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }).catch(() => {});
    } catch { /* convenience only */ }
  };

  return (
    <div className="chat-turn-assistant" data-testid="chat-assistant-message">
      <div className="chat-assistant-label">
        <span className="chat-assistant-mark" aria-hidden="true"><Bot size={14} /></span>
        <span>LENS</span>
        {turn.interaction === 'deep-research' && (
          <span className="chat-assistant-mode">{ar ? 'البحث المعمّق' : 'Deep Research'}</span>
        )}
      </div>

      {isLive && live && (
        <ResearchActivity language={language} live={live} onCancel={onCancel} />
      )}

      {turn.error ? (
        <p className="chat-assistant-error" role="alert" dir="auto">{turn.error}</p>
      ) : streaming ? (
        <p className="chat-assistant-streaming" role="status">
          <span className="chat-activity-dot" aria-hidden="true" data-running="true" />
          {ar ? 'أبحث الآن…' : 'Researching now…'}
        </p>
      ) : report ? (
        <div className="chat-assistant-body">
          <Suspense fallback={<p className="chat-assistant-pending">{ar ? 'جاري تحضير الرد…' : 'Preparing the answer…'}</p>}>
            <ReportCanvas
              content={report}
              sources={sources}
              language={language}
              onInspectCitation={onInspectCitation}
              onOpenShelf={() => onOpenArtifact('sources')}
            />
          </Suspense>
          <CitationList language={language} report={report} sources={sources} onInspectCitation={onInspectCitation} />
        </div>
      ) : null}

      {!isLive && report && (
        <InlineSources language={language} sources={sources} onInspectCitation={onInspectCitation} onOpenAll={() => onOpenArtifact('sources')} />
      )}

      {report && !isLive && (
        <>
          <AssistantActions
            language={language}
            hasReport={report.trim().length > 0}
            sourceCount={sources.length}
            hasPlan={Boolean(turn.plan)}
            hasGraph={(turn.graphNodes ?? []).length > 0}
            hasConversation={Boolean(turn.conversationProjection)}
            onCopy={handleCopy}
            copied={copied}
            onExport={onExport}
            onOpenArtifact={onOpenArtifact}
          />
          <FollowUpSuggestions language={language} query={turn.query} onFollowUp={onFollowUp} />
        </>
      )}
    </div>
  );
};
