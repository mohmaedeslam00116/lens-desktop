/**
 * CompactionShield protects activated Agent Skill instructions from being
 * pruned, compressed, or summarized away during multi-hop LLM context compaction.
 *
 * It encloses active skill instructions within `<skill_content name="...">` tags
 * and enforces strict preservation contracts across recursive context reduction passes.
 */

export interface ShieldedBlock {
  name: string;
  content: string;
  raw: string;
  index: number;
}

export class CompactionShield {
  private static readonly PLACEHOLDER_PREFIX = '__LENS_SHIELD_BLOCK_';

  /**
   * Wraps a skill's instructions in `<skill_content name="...">` tags.
   */
  public static shield(skillName: string, content: string): string {
    const sanitizedName = skillName.trim().toLowerCase();
    // Guard against premature tag closure in content
    const sanitizedContent = content.replace(/<\/skill_content>/gi, '<\\/skill_content>');
    return `<skill_content name="${sanitizedName}">\n${sanitizedContent.trim()}\n</skill_content>`;
  }

  private static getShieldRegex(): RegExp {
    return /<skill_content\s+name="([^"]+)">([\s\S]*?)<\/skill_content>/g;
  }

  /**
   * Checks whether the provided text contains any shielded skill content blocks.
   */
  public static isShielded(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    return this.getShieldRegex().test(text);
  }

  /**
   * Extracts all shielded skill content blocks from text.
   */
  public static extractShieldedBlocks(text: string): ShieldedBlock[] {
    if (!text || typeof text !== 'string') return [];

    const blocks: ShieldedBlock[] = [];
    const regex = this.getShieldRegex();
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      blocks.push({
        name: match[1],
        content: match[2].trim(),
        raw: match[0],
        index: match.index
      });
    }

    return blocks;
  }

  /**
   * Strips `<skill_content>` tags from text, leaving inner contents.
   */
  public static stripTags(text: string): string {
    if (!text || typeof text !== 'string') return '';
    return text.replace(this.getShieldRegex(), '$2');
  }

  /**
   * Protects shielded `<skill_content>` blocks during a compaction or summarization pass.
   *
   * 1. Extracts all `<skill_content>` blocks and substitutes them with unique placeholders.
   * 2. Executes the external compactor function on the remaining context.
   * 3. Re-injects all shielded blocks intact.
   * 4. If an aggressive compactor omitted any placeholder, the missing shielded blocks
   *    are safely appended to guarantee zero skill loss.
   */
  public static async protectCompaction(
    fullText: string,
    compactor: (unshielded: string) => Promise<string> | string
  ): Promise<string> {
    if (!fullText || typeof fullText !== 'string') {
      return '';
    }

    const blocks = this.extractShieldedBlocks(fullText);
    if (blocks.length === 0) {
      // No shielded blocks present, execute compactor directly
      return compactor(fullText);
    }

    const placeholders: Map<string, string> = new Map();
    let textWithPlaceholders = fullText;

    // Replace each shielded block with a stable token
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const placeholder = `${this.PLACEHOLDER_PREFIX}${i}__`;
      placeholders.set(placeholder, block.raw);
      textWithPlaceholders = textWithPlaceholders.replace(block.raw, placeholder);
    }

    // Execute context compaction on unshielded text
    let compactedResult = await compactor(textWithPlaceholders);

    // Restore shielded blocks from placeholders
    const missingBlocks: string[] = [];
    for (const [placeholder, rawBlock] of placeholders.entries()) {
      if (compactedResult.includes(placeholder)) {
        compactedResult = compactedResult.replace(placeholder, rawBlock);
      } else {
        // Placeholder was discarded by summarizer; retain for appending
        missingBlocks.push(rawBlock);
      }
    }

    // Guarantee that no active skill content was lost
    if (missingBlocks.length > 0) {
      compactedResult = `${compactedResult.trim()}\n\n${missingBlocks.join('\n\n')}`;
    }

    return compactedResult;
  }
}
