/**
 * Concise conversation titles derived from real query data — never
 * manufactured summaries, counts, or conclusions. Strips engine focus
 * prefixes (`[Academic …]:`), collapses whitespace, and truncates at a
 * word boundary with an ellipsis.
 */
export function deriveConversationTitle(query: string, maxLength = 60): string {
  const withoutPrefix = String(query ?? '').replace(/^\[[^\]]+\]:\s*/, '');
  const collapsed = withoutPrefix.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  if (collapsed.length <= maxLength) return collapsed;
  const slice = collapsed.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxLength * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}
