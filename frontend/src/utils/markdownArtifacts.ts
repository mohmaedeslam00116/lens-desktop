import { ExtractedTable, ExtractedDiagram, KeyMetric, TocHeading } from '../types';

/**
 * Parses all GFM markdown tables from a report into structured objects with CSV export support.
 */
export function extractTables(markdown: string): ExtractedTable[] {
  if (!markdown) return [];

  const tables: ExtractedTable[] = [];
  // Regex to find GFM markdown tables
  const tableRegex = /((?:^[ \t]*\|.+?\|[ \t]*\r?\n)(?:^[ \t]*\|[ \t]*:?[-]+:?[ \t]*(?:\|[ \t]*:?[-]+:?[ \t]*)+\|[ \t]*\r?\n)(?:^[ \t]*\|.+?\|[ \t]*(?:\r?\n|$))+)/gm;

  let match: RegExpExecArray | null;
  let tableIndex = 1;

  while ((match = tableRegex.exec(markdown)) !== null) {
    const rawTable = match[0].trim();
    const lines = rawTable.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    // Line 0: headers
    const headerLine = lines[0];
    const headers = headerLine
      .split('|')
      .slice(1, -1)
      .map(h => h.trim());

    // Line 1 is delimiter (|---|---|)
    // Line 2+: rows
    const rows: string[][] = [];
    for (let i = 2; i < lines.length; i++) {
      const rowCols = lines[i]
        .split('|')
        .slice(1, -1)
        .map(c => c.trim());
      if (rowCols.length > 0) {
        rows.push(rowCols);
      }
    }

    // Try to find preceding heading for table title
    const textBefore = markdown.substring(0, match.index);
    const headingMatches = [...textBefore.matchAll(/#{1,3}\s+([^\r\n]+)/g)];
    let title = `جدول المقارنة والتحليل #${tableIndex}`;
    if (headingMatches.length > 0) {
      const lastHeading = headingMatches[headingMatches.length - 1][1].trim();
      title = lastHeading;
    }

    tables.push({
      id: `table-${tableIndex}`,
      title,
      headers,
      rows,
      rawMarkdown: rawTable
    });

    tableIndex++;
  }

  return tables;
}

/**
 * Converts table headers and rows to standard CSV string with proper escaping.
 */
export function tableToCSV(headers: string[], rows: string[][]): string {
  const escapeCell = (cell: string) => {
    const clean = cell.replace(/"/g, '""');
    return `"${clean}"`;
  };

  const headerRow = headers.map(escapeCell).join(',');
  const dataRows = rows.map(r => r.map(escapeCell).join(',')).join('\n');
  return `${headerRow}\n${dataRows}`;
}

/**
 * Extracts all Mermaid diagrams from markdown.
 */
export function extractMermaidDiagrams(markdown: string): ExtractedDiagram[] {
  if (!markdown) return [];

  const diagrams: ExtractedDiagram[] = [];
  const mermaidRegex = /```mermaid\s*([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  let index = 1;

  while ((match = mermaidRegex.exec(markdown)) !== null) {
    const code = match[1].trim();
    if (!code) continue;

    // Try to find preceding heading
    const textBefore = markdown.substring(0, match.index);
    const headingMatches = [...textBefore.matchAll(/#{1,3}\s+([^\r\n]+)/g)];
    let title = `مخطط المعمارية والتدفق #${index}`;
    if (headingMatches.length > 0) {
      title = headingMatches[headingMatches.length - 1][1].trim();
    }

    diagrams.push({
      id: `diagram-${index}`,
      title,
      code
    });
    index++;
  }

  return diagrams;
}

/**
 * Extracts Table of Contents headings from markdown.
 */
export function extractTocHeadings(markdown: string): TocHeading[] {
  if (!markdown) return [];

  const headings: TocHeading[] = [];
  const headingRegex = /^(#{1,3})\s+([^\r\n]+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].replace(/\[\^?\d+\]/g, '').trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\u0600-\u06FF\s-]/g, '')
      .replace(/\s+/g, '-');

    headings.push({ id, text, level });
  }

  return headings;
}

/**
 * Extracts key statistics / metrics from markdown text.
 */
export function extractKeyMetrics(markdown: string): KeyMetric[] {
  if (!markdown) return [];

  const metrics: KeyMetric[] = [];
  // Pattern to detect metric bullets like "- **Accuracy**: 95.4%" or "- **التكلفة**: $0.002"
  const metricRegex = /^[ \t]*[-*]\s+\*\*([^*]+)\*\*:\s*([^\n\r]+)/gm;

  let match: RegExpExecArray | null;
  while ((match = metricRegex.exec(markdown)) !== null && metrics.length < 8) {
    const label = match[1].trim();
    const rawVal = match[2].trim();
    // Only capture if looks like a metric or short value (< 80 chars)
    if (rawVal.length <= 80) {
      metrics.push({
        label,
        value: rawVal
      });
    }
  }

  return metrics;
}
