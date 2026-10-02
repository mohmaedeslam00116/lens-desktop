import React from 'react';
import type { Language } from '../../types';
import type { AgentInteraction } from './LensHarnessWorkspace';

/**
 * The answer-mode switch: Agentic Search (gate-free, agent-first — the
 * default) or Deep Research (plan-first opt-in with its approval overlay).
 * It lives WITH the composer that will submit the question, so the choice
 * is visible at the moment of asking — never detached in a footer.
 */

interface AgentInteractionSwitchProps {
  interaction: AgentInteraction;
  onSelect: (interaction: AgentInteraction) => void;
  language: Language;
}

export const AgentInteractionSwitch: React.FC<AgentInteractionSwitchProps> = ({
  interaction,
  onSelect,
  language,
}) => {
  const ar = language === 'ar';
  return (
    <fieldset className="harness-interaction" aria-label={ar ? 'نمط الإجابة' : 'Answer mode'}>
      <legend className="sr-only">{ar ? 'نمط الإجابة' : 'Answer mode'}</legend>
      <label className={`harness-interaction-option${interaction === 'agent' ? ' is-active' : ''}`}>
        <input
          className="sr-only"
          type="radio"
          name="agent-interaction"
          value="agent"
          checked={interaction === 'agent'}
          onChange={() => onSelect('agent')}
        />
        <span>{ar ? 'بحث وكيل' : 'Agentic Search'}</span>
      </label>
      <label className={`harness-interaction-option${interaction === 'deep-research' ? ' is-active' : ''}`}>
        <input
          className="sr-only"
          type="radio"
          name="agent-interaction"
          value="deep-research"
          checked={interaction === 'deep-research'}
          onChange={() => onSelect('deep-research')}
        />
        <span>{ar ? 'البحث المعمّق' : 'Deep Research'}</span>
      </label>
    </fieldset>
  );
};
