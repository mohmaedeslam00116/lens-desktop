/**
 * LENS Deep Research Engine — Structure-Aware & Contextual Chunk Enrichment Pipeline
 * Extracts hierarchical document sections (Markdown AST & HTML DOM) and enriches
 * chunks with structural breadcrumbs ([Title > Section > Subsection]) for superior
 * lexical (BM25) and dense vector retrieval without polluting final report synthesis.
 */

import * as cheerio from 'cheerio';

export interface StructuredSection {
  level: number;
  heading: string;
  path: string[];
  content: string;
}

export interface ContextualChunk {
  id: string;
  sourceIndex: number;
  citationId: number;
  chunkIndex: number;
  content: string;         // Clean text for report synthesis & citation display
  enrichedContent: string; // Breadcrumb + clean text for BM25 and vector embeddings
  sectionPath: string[];   // ['Document Title', 'Heading 1', 'Subheading 2']
  contextHeader: string;   // Formatted breadcrumb string
  tokenEstimate: number;
}

export interface ChunkOptions {
  maxChunkSize?: number;
  chunkOverlap?: number;
  defaultTitle?: string;
  sourceIndex?: number;
  citationId?: number;
}

/**
 * Parses Markdown documents into hierarchical sections by tracking ATX headings (#, ##, ###).
 */
export function parseMarkdownSections(markdown: string, defaultTitle = 'Untitled Document'): StructuredSection[] {
  if (!markdown || !markdown.trim()) return [];

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: StructuredSection[] = [];

  const headingStack: Array<{ level: number; text: string }> = [];
  let currentContentLines: string[] = [];

  // Preamble section before first heading
  let currentLevel = 0;
  let currentHeading = defaultTitle;

  const flushCurrentSection = () => {
    const text = currentContentLines.join('\n').trim();
    if (text.length > 0) {
      const activePath = [defaultTitle];
      for (const h of headingStack) {
        if (!activePath.includes(h.text)) {
          activePath.push(h.text);
        }
      }
      sections.push({
        level: currentLevel,
        heading: currentHeading,
        path: activePath,
        content: text
      });
    }
    currentContentLines = [];
  };

  const headingRegex = /^(#{1,6})\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(headingRegex);
    if (match) {
      flushCurrentSection();

      const level = match[1].length;
      const headingText = match[2].trim().replace(/[*_`#]/g, '');

      // Maintain heading stack: pop any headings deeper or at the same level
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      headingStack.push({ level, text: headingText });
      currentLevel = level;
      currentHeading = headingText;
    } else {
      currentContentLines.push(line);
    }
  }

  flushCurrentSection();

  if (sections.length === 0 && markdown.trim().length > 0) {
    sections.push({
      level: 0,
      heading: defaultTitle,
      path: [defaultTitle],
      content: markdown.trim()
    });
  }

  return sections;
}

/**
 * Parses HTML documents into hierarchical sections by extracting headings (h1..h6) and text blocks.
 */
export function parseHtmlSections(html: string, defaultTitle = 'Untitled Web Page'): StructuredSection[] {
  if (!html || !html.trim()) return [];

  try {
    const $ = cheerio.load(html);

    // Remove noise elements
    $('script, style, nav, footer, noscript, svg, iframe, link, meta').remove();

    const titleFromHtml = $('title').first().text().trim() ||
                          $('h1').first().text().trim() ||
                          defaultTitle;

    const sections: StructuredSection[] = [];
    const headingStack: Array<{ level: number; text: string }> = [];

    let currentLevel = 0;
    let currentHeading = titleFromHtml;
    let currentTextBlocks: string[] = [];

    const flushCurrent = () => {
      const text = currentTextBlocks.join('\n\n').trim();
      if (text.length > 0) {
        const path = [titleFromHtml];
        for (const h of headingStack) {
          if (!path.includes(h.text)) {
            path.push(h.text);
          }
        }
        sections.push({
          level: currentLevel,
          heading: currentHeading,
          path,
          content: text
        });
      }
      currentTextBlocks = [];
    };

    $('h1, h2, h3, h4, h5, h6, p, article, section, blockquote, li, pre').each((_, el: any) => {
      const tagName = (el.tagName || el.name || '').toLowerCase();
      const text = $(el).text().trim();
      if (!text) return;

      const isHeading = /^h[1-6]$/.test(tagName);
      if (isHeading) {
        flushCurrent();

        const level = parseInt(tagName.charAt(1), 10);
        const headingText = text.replace(/\s+/g, ' ');

        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop();
        }

        headingStack.push({ level, text: headingText });
        currentLevel = level;
        currentHeading = headingText;
      } else {
        // Only take direct paragraphs/content to prevent duplicating nested texts
        if (tagName === 'p' || tagName === 'li' || tagName === 'blockquote' || tagName === 'pre') {
          currentTextBlocks.push(text);
        }
      }
    });

    flushCurrent();

    if (sections.length === 0) {
      // Fallback: extract plain body text
      const bodyText = ($('body').text() || $.text()).replace(/\s+/g, ' ').trim();
      if (bodyText) {
        sections.push({
          level: 0,
          heading: titleFromHtml,
          path: [titleFromHtml],
          content: bodyText
        });
      }
    }

    return sections;
  } catch {
    // If HTML parsing fails, fallback to treating it as plain text
    return parseMarkdownSections(html, defaultTitle);
  }
}

/**
 * Splits structured sections into bounded, context-enriched passages.
 */
export function chunkStructuredDocument(
  rawText: string,
  options: ChunkOptions = {}
): ContextualChunk[] {
  if (!rawText || !rawText.trim()) return [];

  const defaultTitle = options.defaultTitle || 'Untitled Document';
  const sourceIndex = typeof options.sourceIndex === 'number' ? options.sourceIndex : 0;
  const citationId = typeof options.citationId === 'number' ? options.citationId : sourceIndex + 1;
  const maxChunkSize = Math.max(150, Math.min(2000, options.maxChunkSize || 650));
  const chunkOverlap = Math.max(0, Math.min(Math.floor(maxChunkSize / 2), options.chunkOverlap ?? 80));

  // Determine if input is HTML or Markdown
  const isHtml = /<[a-z][\s\S]*>/i.test(rawText.slice(0, 1500));
  const sections = isHtml
    ? parseHtmlSections(rawText, defaultTitle)
    : parseMarkdownSections(rawText, defaultTitle);

  const chunks: ContextualChunk[] = [];
  let globalChunkIndex = 0;

  for (const section of sections) {
    const sectionPath = section.path.filter(p => p && p.trim().length > 0);
    const contextHeader = sectionPath.length > 0
      ? `[${sectionPath.join(' > ')}]`
      : `[${defaultTitle}]`;

    const cleanContent = section.content.trim();
    if (!cleanContent) continue;

    // If section content fits directly within chunk size limit
    if (cleanContent.length <= maxChunkSize) {
      const enrichedContent = `${contextHeader}\n${cleanContent}`;
      chunks.push({
        id: `chunk_${citationId}_${globalChunkIndex}`,
        sourceIndex,
        citationId,
        chunkIndex: globalChunkIndex++,
        content: cleanContent,
        enrichedContent,
        sectionPath,
        contextHeader,
        tokenEstimate: Math.ceil(enrichedContent.length / 4)
      });
      continue;
    }

    // Split long section into paragraphs and semantic boundaries
    let startIndex = 0;
    while (startIndex < cleanContent.length) {
      let endIndex = startIndex + maxChunkSize;

      if (endIndex >= cleanContent.length) {
        const remaining = cleanContent.slice(startIndex).trim();
        if (remaining.length > 30) {
          const enrichedContent = `${contextHeader}\n${remaining}`;
          chunks.push({
            id: `chunk_${citationId}_${globalChunkIndex}`,
            sourceIndex,
            citationId,
            chunkIndex: globalChunkIndex++,
            content: remaining,
            enrichedContent,
            sectionPath,
            contextHeader,
            tokenEstimate: Math.ceil(enrichedContent.length / 4)
          });
        }
        break;
      }

      // Try finding natural paragraph break first (\n\n)
      let splitPoint = -1;
      const windowText = cleanContent.slice(startIndex, endIndex);

      const paraBreak = windowText.lastIndexOf('\n\n');
      if (paraBreak > maxChunkSize * 0.35) {
        splitPoint = startIndex + paraBreak + 2;
      } else {
        // Try finding sentence break (. ! ? ؟ \n)
        const sentenceMatches = Array.from(windowText.matchAll(/([.!?؟\n])\s+/g));
        if (sentenceMatches.length > 0) {
          const lastSentence = sentenceMatches[sentenceMatches.length - 1];
          const lastMatchIndex = lastSentence.index ?? -1;
          if (lastMatchIndex > maxChunkSize * 0.4) {
            splitPoint = startIndex + lastMatchIndex + lastSentence[0].length;
          }
        }
      }

      // Fallback: word boundary
      if (splitPoint === -1) {
        const spaceBreak = windowText.lastIndexOf(' ');
        if (spaceBreak > maxChunkSize * 0.4) {
          splitPoint = startIndex + spaceBreak + 1;
        } else {
          splitPoint = endIndex;
        }
      }

      const chunkSlice = cleanContent.slice(startIndex, splitPoint).trim();
      if (chunkSlice.length > 30) {
        const enrichedContent = `${contextHeader}\n${chunkSlice}`;
        chunks.push({
          id: `chunk_${citationId}_${globalChunkIndex}`,
          sourceIndex,
          citationId,
          chunkIndex: globalChunkIndex++,
          content: chunkSlice,
          enrichedContent,
          sectionPath,
          contextHeader,
          tokenEstimate: Math.ceil(enrichedContent.length / 4)
        });
      }

      startIndex = Math.max(startIndex + 1, splitPoint - chunkOverlap);
    }
  }

  return chunks;
}
