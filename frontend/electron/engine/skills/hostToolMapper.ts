import { HostToolMappingResult } from './types';

export interface NativeCapabilityBinding {
  canonicalName: string;
  nativeClass: string;
  description: string;
}

export const NATIVE_CAPABILITY_BINDINGS: Record<string, NativeCapabilityBinding> = {
  web_search: {
    canonicalName: 'web_search',
    nativeClass: 'MultiSearchProvider',
    description: 'MultiSearchProvider queries across search engines (DuckDuckGo, Tavily, Serper).'
  },
  read_url: {
    canonicalName: 'read_url',
    nativeClass: 'PageScraper',
    description: 'PageScraper HTTP extraction with readability cleaning and SSR fallback.'
  },
  read_resource: {
    canonicalName: 'read_resource',
    nativeClass: 'SkillLoader.loadSkillResource',
    description: 'Sandboxed relative resource loading within skill directory boundary.'
  }
};

/**
 * HostToolMapper validates and maps a skill's declared `allowed-tools` to native
 * LENS runtime capabilities while enforcing zero privilege escalation.
 *
 * Recognized capabilities:
 * - web_search / search: MultiSearchProvider queries across search engines.
 * - read_url / scrape_url: PageScraper HTTP extraction with readability cleaning.
 * - read_resource: Sandboxed relative resource loading within skill boundary.
 */
export class HostToolMapper {
  private static readonly CANONICAL_CAPABILITIES: Record<string, string> = {
    web_search: 'web_search',
    'web-search': 'web_search',
    search: 'web_search',
    read_url: 'read_url',
    'read-url': 'read_url',
    scrape_url: 'read_url',
    'scrape-url': 'read_url',
    page_scrape: 'read_url',
    read_resource: 'read_resource',
    'read-resource': 'read_resource',
    load_resource: 'read_resource'
  };

  /**
   * Maps an array of declared tool identifiers to recognized native host capabilities.
   * Emits safe diagnostic notices for any unsupported tools without throwing or granting escalation.
   */
  public static mapTools(declaredTools: string[] = []): HostToolMappingResult {
    const mappedSet = new Set<string>();
    const unmappedSet = new Set<string>();
    const notices: string[] = [];

    for (const tool of declaredTools) {
      const normalized = String(tool).trim().toLowerCase();
      if (!normalized) continue;

      const hasKey = Object.prototype.hasOwnProperty.call(this.CANONICAL_CAPABILITIES, normalized);
      const canonical = hasKey ? this.CANONICAL_CAPABILITIES[normalized] : undefined;
      if (canonical) {
        mappedSet.add(canonical);
      } else {
        unmappedSet.add(normalized);
        notices.push(
          `[HostToolNotice] Skill requested unmapped host tool "${normalized}". Tool will be omitted with zero privilege escalation.`
        );
      }
    }

    const mappedTools = Array.from(mappedSet);
    const unmappedTools = Array.from(unmappedSet);

    return {
      mappedTools,
      unmappedTools,
      notices,
      hasCapability: (capability: string) => {
        const norm = capability.toLowerCase();
        const canonical = Object.prototype.hasOwnProperty.call(this.CANONICAL_CAPABILITIES, norm)
          ? this.CANONICAL_CAPABILITIES[norm]
          : norm;
        return mappedSet.has(canonical);
      }
    };
  }

  /**
   * Returns binding details for a native capability if recognized.
   */
  public static getCapabilityBinding(capability: string): NativeCapabilityBinding | undefined {
    const norm = capability.toLowerCase();
    const canonical = Object.prototype.hasOwnProperty.call(this.CANONICAL_CAPABILITIES, norm)
      ? this.CANONICAL_CAPABILITIES[norm]
      : norm;
    return Object.prototype.hasOwnProperty.call(NATIVE_CAPABILITY_BINDINGS, canonical)
      ? NATIVE_CAPABILITY_BINDINGS[canonical]
      : undefined;
  }

  /**
   * Returns all canonical host tool capabilities supported natively by LENS.
   */
  public static getSupportedCapabilities(): string[] {
    return ['web_search', 'read_url', 'read_resource'];
  }
}
