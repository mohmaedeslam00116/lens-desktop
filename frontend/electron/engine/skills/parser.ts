import { SkillError, SkillFrontmatter } from './types';

const SKILL_NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MAX_DESCRIPTION_LENGTH = 1024;

/**
 * Parses frontmatter YAML block leniently from a SKILL.md document.
 * Recovers unquoted colons in description and other fields without failing,
 * ensuring broad compatibility with community skills.
 */
export function parseLenientYamlFrontmatter(
  content: string,
  filePath?: string
): { frontmatter: SkillFrontmatter; body: string } {
  if (!content || typeof content !== 'string') {
    throw new SkillError(
      'MISSING_FRONTMATTER',
      'SKILL.md content is empty or invalid',
      filePath
    );
  }

  // Normalize line endings and strip BOM
  const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  // Match frontmatter between --- and ---
  const match = cleanContent.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/);
  if (!match) {
    throw new SkillError(
      'MISSING_FRONTMATTER',
      'SKILL.md must begin with frontmatter enclosed in --- delimiters',
      filePath
    );
  }

  const yamlBlock = match[1];
  const body = match[2] ? match[2].trim() : '';

  const rawFields: Record<string, any> = {};
  const lines = yamlBlock.split('\n');

  let currentKey: string | null = null;
  let currentList: string[] | null = null;
  let currentDict: Record<string, any> | null = null;
  let isBlockScalar = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    // Helper to append continuation text to current key
    const appendFieldValue = (key: string, text: string) => {
      const existing = rawFields[key] || '';
      rawFields[key] = existing ? `${existing} ${text}` : text;
    };

    // Skip empty lines and full comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const isIndented = /^\s/.test(rawLine);

    if (isIndented) {
      // 1. List items (- item)
      if (trimmedLine.startsWith('- ') && currentKey && currentList) {
        const itemVal = stripQuotes(trimmedLine.slice(2).trim());
        currentList.push(itemVal);
        continue;
      }

      // 2. Indented dictionary sub-keys (key: val under metadata)
      if (currentKey === 'metadata' && currentDict) {
        const subColonIdx = trimmedLine.indexOf(':');
        if (subColonIdx > 0) {
          const subKey = trimmedLine.slice(0, subColonIdx).trim();
          const subVal = stripQuotes(trimmedLine.slice(subColonIdx + 1).trim());
          currentDict[subKey] = subVal;
          continue;
        }
      }

      // 3. Multi-line scalar or block continuation (even if line contains colons)
      if (currentKey) {
        appendFieldValue(currentKey, trimmedLine);
        continue;
      }
    }

    // Top-level key: value (must NOT be indented)
    const colonIdx = rawLine.indexOf(':');
    if (colonIdx > 0) {
      const rawKey = rawLine.slice(0, colonIdx).trim().toLowerCase();
      const valRest = rawLine.slice(colonIdx + 1).trim();

      // Normalize key aliases
      const key =
        rawKey === 'allowedtools' || rawKey === 'allowed-tools'
          ? 'allowed-tools'
          : rawKey === 'disablemodelinvocation' || rawKey === 'disable-model-invocation'
          ? 'disable-model-invocation'
          : rawKey;

      currentKey = key;
      isBlockScalar = false;
      currentList = null;
      currentDict = null;

      if (valRest === '|' || valRest === '>') {
        isBlockScalar = true;
        rawFields[key] = '';
        continue;
      }

      if (key === 'allowed-tools') {
        if (!valRest) {
          currentList = [];
          rawFields['allowed-tools'] = currentList;
        } else if (valRest.startsWith('[') && valRest.endsWith(']')) {
          rawFields['allowed-tools'] = valRest
            .slice(1, -1)
            .split(',')
            .map(s => stripQuotes(s.trim()))
            .filter(Boolean);
        } else {
          rawFields['allowed-tools'] = valRest
            .split(',')
            .map(s => stripQuotes(s.trim()))
            .filter(Boolean);
        }
        continue;
      }

      if (key === 'metadata') {
        if (!valRest) {
          currentDict = {};
          rawFields['metadata'] = currentDict;
        } else {
          try {
            rawFields['metadata'] = JSON.parse(valRest);
          } catch {
            rawFields['metadata'] = valRest;
          }
        }
        continue;
      }

      // Lenient string parser:
      // Even if valRest contains unquoted colons (e.g. "Papers: arXiv: https://..."),
      // treat the entire rest of the line as the value!
      rawFields[key] = stripQuotes(valRest);
    }
  }

  // 1. Validate 'name'
  const name = rawFields['name'];
  if (!name || typeof name !== 'string' || !SKILL_NAME_REGEX.test(name)) {
    throw new SkillError(
      'INVALID_SKILL_NAME',
      `Skill 'name' is missing or invalid: "${name}". Name must match lowercase alphanumeric pattern: ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`,
      filePath
    );
  }

  // 2. Validate 'description'
  const description = rawFields['description'];
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    throw new SkillError(
      'INVALID_SKILL_DESCRIPTION',
      `Skill 'description' must be a non-empty string`,
      filePath
    );
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new SkillError(
      'INVALID_SKILL_DESCRIPTION',
      `Skill 'description' exceeds maximum allowed length of ${MAX_DESCRIPTION_LENGTH} characters (actual: ${description.length})`,
      filePath
    );
  }

  // 3. Validate 'license' (if present)
  const rawLicense = rawFields['license'];
  if (rawLicense !== undefined && rawLicense !== null) {
    if (typeof rawLicense !== 'string' || rawLicense.length > 100) {
      throw new SkillError(
        'INVALID_SKILL_LICENSE',
        `Skill 'license' must be a string up to 100 characters`,
        filePath
      );
    }
  }

  // 4. Validate 'compatibility' (if present)
  const rawCompatibility = rawFields['compatibility'];
  if (rawCompatibility !== undefined && rawCompatibility !== null) {
    if (typeof rawCompatibility !== 'string' || rawCompatibility.length > 500) {
      throw new SkillError(
        'INVALID_SKILL_COMPATIBILITY',
        `Skill 'compatibility' must be a string up to 500 characters`,
        filePath
      );
    }
  }

  // 5. Validate 'metadata' (if present)
  const rawMetadata = rawFields['metadata'];
  if (rawMetadata !== undefined && rawMetadata !== null) {
    if (typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
      throw new SkillError(
        'INVALID_SKILL_METADATA',
        `Skill 'metadata' must be a key-value object map`,
        filePath
      );
    }
  }

  // 6. Validate 'allowed-tools' (if present)
  const rawAllowedTools = rawFields['allowed-tools'];
  let validatedTools: string[] | undefined;
  if (rawAllowedTools !== undefined && rawAllowedTools !== null) {
    if (!Array.isArray(rawAllowedTools)) {
      throw new SkillError(
        'INVALID_SKILL_ALLOWED_TOOLS',
        `Skill 'allowed-tools' must be an array of tool names`,
        filePath
      );
    }
    const TOOL_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
    for (const tool of rawAllowedTools) {
      if (typeof tool !== 'string' || !TOOL_NAME_REGEX.test(tool)) {
        throw new SkillError(
          'INVALID_SKILL_ALLOWED_TOOLS',
          `Invalid tool name in 'allowed-tools': "${tool}". Must match ^[a-zA-Z0-9_-]+$`,
          filePath
        );
      }
    }
    validatedTools = rawAllowedTools;
  }

  // 7. Format frontmatter
  const frontmatter: SkillFrontmatter = {
    name,
    description: description.trim(),
    license: rawLicense ? String(rawLicense) : undefined,
    compatibility: rawCompatibility ? String(rawCompatibility) : undefined,
    metadata: rawMetadata && typeof rawMetadata === 'object' ? rawMetadata : undefined,
    allowedTools: validatedTools,
    disableModelInvocation:
      rawFields['disable-model-invocation'] === true ||
      rawFields['disable-model-invocation'] === 'true'
  };

  return { frontmatter, body };
}

function stripQuotes(str: string): string {
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    return str.slice(1, -1);
  }
  return str;
}
