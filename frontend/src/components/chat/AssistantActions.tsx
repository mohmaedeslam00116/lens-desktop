import React from 'react';
import { BookOpen, FileText, ListTree, MessagesSquare, Network } from 'lucide-react';
import type { Language } from '../../types';
import type { ChatArtifactKind } from './types';

interface AssistantActionsProps {
  language: Language;
  hasReport: boolean;
  sourceCount: number;
  hasPlan: boolean;
  hasGraph: boolean;
  hasConversation: boolean;
  onCopy: () => void;
  copied: boolean;
  onExport: (format: 'pdf' | 'docx' | 'markdown') => void;
  onOpenArtifact: (kind: ChatArtifactKind) => void;
}

/**
 * AssistantActions — copy/regenerate/export plus contextual artifact
 * launchers. Artifact buttons render only when the artifact exists; the
 * conversation stays the primary state, artifacts stay contextual.
 */
export const AssistantActions: React.FC<AssistantActionsProps> = ({
  language,
  hasReport,
  sourceCount,
  hasPlan,
  hasGraph,
  hasConversation,
  onCopy,
  copied,
  onExport,
  onOpenArtifact,
}) => {
  const ar = language === 'ar';
  return (
    <div className="chat-assistant-actions" aria-label={ar ? 'إجراءات الرد' : 'Response actions'}>
      <button type="button" className="chat-action" onClick={onCopy}>
        <span>{copied ? (ar ? 'تم النسخ' : 'Copied') : (ar ? 'نسخ' : 'Copy')}</span>
      </button>
      <button type="button" className="chat-action" onClick={() => onExport('markdown')}>
        <span>{ar ? 'تصدير' : 'Export'}</span>
      </button>
      {hasReport && (
        <button type="button" className="chat-action" onClick={() => onOpenArtifact('report')}>
          <FileText size={13} aria-hidden="true" />
          <span>{ar ? 'عرض التقرير الكامل' : 'View report'}</span>
        </button>
      )}
      {sourceCount > 0 && (
        <button type="button" className="chat-action" onClick={() => onOpenArtifact('sources')}>
          <BookOpen size={13} aria-hidden="true" />
          <span>{ar ? `المصادر ${sourceCount}` : `Sources ${sourceCount}`}</span>
        </button>
      )}
      {hasPlan && (
        <button type="button" className="chat-action" onClick={() => onOpenArtifact('plan')}>
          <ListTree size={13} aria-hidden="true" />
          <span>{ar ? 'الخطة' : 'Plan'}</span>
        </button>
      )}
      {hasGraph && (
        <button type="button" className="chat-action" onClick={() => onOpenArtifact('graph')}>
          <Network size={13} aria-hidden="true" />
          <span>{ar ? 'الخريطة' : 'Graph'}</span>
        </button>
      )}
      {hasConversation && (
        <button type="button" className="chat-action" onClick={() => onOpenArtifact('conversation')}>
          <MessagesSquare size={13} aria-hidden="true" />
          <span>{ar ? 'المحادثة الأجنتية' : 'Conversation'}</span>
        </button>
      )}
    </div>
  );
};
