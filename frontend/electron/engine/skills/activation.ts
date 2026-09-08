import { LiveEvent } from '../types';
import { LLMToolDefinition } from '../models';
import { ActivatedSkill, SkillPackage, SkillScope } from './types';
import { SkillRegistry } from './registry';
import { HostToolMapper } from './hostToolMapper';
import { CompactionShield } from './compactionShield';

export class SkillActivationManager {
  private registry: SkillRegistry;
  private activeSkills: Map<string, ActivatedSkill> = new Map();

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  /**
   * Clears all currently active skills.
   */
  public clear(): void {
    this.activeSkills.clear();
  }

  /**
   * Returns whether a skill is actively loaded in this session.
   */
  public hasActiveSkill(name: string): boolean {
    return this.activeSkills.has(name.toLowerCase());
  }

  /**
   * Returns an active skill by name.
   */
  public getActiveSkill(name: string): ActivatedSkill | undefined {
    return this.activeSkills.get(name.toLowerCase());
  }

  /**
   * Returns all active skills in order of activation.
   */
  public getActiveSkills(): ActivatedSkill[] {
    return Array.from(this.activeSkills.values());
  }

  /**
   * Returns the list of names of all currently activated skills.
   */
  public getActivatedNames(): string[] {
    return Array.from(this.activeSkills.keys());
  }

  /**
   * Path 1: Controller-Assisted Pre-activation.
   *
   * Automatically pre-activates skills listed in an approved ResearchPlan
   * or passed directly into research options.
   * Ensures 100% activation reliability even for local LLMs lacking tool-calling capabilities (Ollama / Llama 3.1).
   */
  public async preActivateSkills(
    skillNames: string[],
    emitEvent?: (event: LiveEvent) => void,
    options?: { language?: string }
  ): Promise<ActivatedSkill[]> {
    const activatedList: ActivatedSkill[] = [];

    for (const rawName of skillNames) {
      const normalized = rawName.trim().toLowerCase();
      if (!normalized) continue;

      if (this.activeSkills.has(normalized)) {
        activatedList.push(this.activeSkills.get(normalized)!);
        continue;
      }

      const pkg = this.registry.getSkill(normalized);
      if (!pkg) {
        // Skill name not found in registry; skip pre-activation gracefully
        continue;
      }

      if (!this.registry.isSkillEnabled(normalized)) {
        // Skill is disabled by user configuration; skip pre-activation
        continue;
      }

      const activated = this.activatePackage(pkg, 'pre_activated', emitEvent, options?.language);
      activatedList.push(activated);
    }

    return activatedList;
  }

  /**
   * Path 2: Dynamic Tool-Calling `activate_skill(name)`.
   *
   * Tool schema declaration for tool-capable providers (Gemini, OpenAI, Anthropic).
   */
  public getToolDefinition(): LLMToolDefinition {
    return {
      name: 'activate_skill',
      description:
        'Activates an Agent Skill from the catalog and retrieves its complete instructions, domain guidelines, and procedures into context.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'The unique lowercase alphanumeric name of the skill to activate (e.g. "academic-paper-analysis", "arxiv-search").'
          }
        },
        required: ['name']
      }
    };
  }

  /**
   * Backwards-compatible alias for getToolDefinition.
   */
  public getActivateSkillToolDefinition(): LLMToolDefinition {
    return this.getToolDefinition();
  }

  /**
   * Handles dynamic tool invocation of `activate_skill` by an LLM.
   */
  public async handleActivateSkillToolCall(
    args: { name: string },
    emitEvent?: (event: LiveEvent) => void,
    options?: { language?: string }
  ): Promise<{
    success: boolean;
    name?: string;
    scope?: SkillScope;
    description?: string;
    mappedTools?: string[];
    unmappedTools?: string[];
    instructions?: string;
    error?: string;
    message?: string;
  }> {
    if (!args || typeof args.name !== 'string') {
      return {
        success: false,
        error: 'INVALID_ARGUMENTS',
        message: 'activate_skill requires a valid "name" string parameter.'
      };
    }

    const normalized = args.name.trim().toLowerCase();
    const pkg = this.registry.getSkill(normalized);

    if (!pkg) {
      return {
        success: false,
        error: 'SKILL_NOT_FOUND',
        message: `Skill "${normalized}" is not found in the available catalog.`
      };
    }

    if (!this.registry.isSkillEnabled(normalized)) {
      return {
        success: false,
        error: 'SKILL_DISABLED',
        message: `Skill "${normalized}" has been disabled by user and cannot be activated.`
      };
    }

    // If already active, use existing activation; otherwise activate package
    const activated =
      this.activeSkills.get(normalized) ||
      this.activatePackage(pkg, 'dynamic_tool', emitEvent, options?.language);

    return {
      success: true,
      name: activated.name,
      scope: activated.scope,
      description: pkg.frontmatter.description,
      mappedTools: activated.mappedTools,
      unmappedTools: activated.unmappedTools,
      instructions: activated.shieldedContent
    };
  }

  /**
   * Formats all currently active skills into a robust prompt context block
   * for LLM synthesis and query generation.
   */
  public getPromptContext(): string {
    const active = this.getActiveSkills();
    if (active.length === 0) {
      return '';
    }

    const lines: string[] = [
      '# Active Research Skills & Domain Guidance',
      'The following specialized research skills are active for this session. Adhere strictly to their instructions:',
      ''
    ];

    for (const skill of active) {
      lines.push(skill.shieldedContent);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Internal helper activating a skill package.
   */
  private activatePackage(
    pkg: SkillPackage,
    method: 'pre_activated' | 'dynamic_tool',
    emitEvent?: (event: LiveEvent) => void,
    language = 'ar'
  ): ActivatedSkill {
    const mapping = HostToolMapper.mapTools(pkg.frontmatter.allowedTools || []);
    const shieldedContent = CompactionShield.shield(pkg.name, pkg.rawBody);

    // In-memory snapshotting: isolate active session from concurrent on-disk modifications
    if (!pkg.resourceSnapshot) {
      pkg.resourceSnapshot = new Map();
    }
    pkg.resourceSnapshot.set('skill.md', pkg.rawBody);

    const activated: ActivatedSkill = {
      name: pkg.name,
      scope: pkg.scope,
      shieldedContent,
      activationMethod: method,
      mappedTools: mapping.mappedTools,
      unmappedTools: mapping.unmappedTools,
      notices: mapping.notices,
      activatedAt: Date.now()
    };

    this.activeSkills.set(pkg.name, activated);

    // Emit live event telemetry with bilingual parity
    if (emitEvent) {
      const isAr = language === 'ar';
      const noticesNotice = mapping.notices.length > 0
        ? (isAr ? ` [تنبيه أدوات غير مدعومة: ${mapping.unmappedTools.join(', ')}]` : ` [Unmapped tools notice: ${mapping.unmappedTools.join(', ')}]`)
        : '';
      emitEvent({
        type: 'skill_activated',
        skillName: pkg.name,
        skillScope: pkg.scope,
        activationMethod: method,
        mappedTools: mapping.mappedTools,
        unmappedTools: mapping.unmappedTools,
        notices: mapping.notices,
        thought: isAr
          ? `تفعيل المهارة البحثية: ${pkg.name} (${method === 'pre_activated' ? 'تثبيت خطة البحث' : 'استدعاء ديناميكي'})${noticesNotice}`
          : `Activating research skill: ${pkg.name} (${method === 'pre_activated' ? 'plan pre-activation' : 'dynamic tool call'})${noticesNotice}`
      });
    }

    return activated;
  }
}
