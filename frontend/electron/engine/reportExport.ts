import { createZipArchive } from './skills/zipArchive';

export interface ReportExportPayload {
  title: string;
  content: string;
  sources: string[];
  costs?: number;
  created_at?: string;
  language?: 'ar' | 'en';
}

export interface ReportExportService {
  renderPdf(html: string): Promise<Buffer>;
}

const MAX_TITLE_LENGTH = 300;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_SOURCES = 500;

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function containsArabic(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

export function validateReportExportPayload(value: unknown): ReportExportPayload {
  if (!value || typeof value !== 'object') throw new Error('Export payload must be an object.');
  const input = value as Record<string, unknown>;
  if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('Export title is required.');
  if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('Export content is required.');
  if (!Array.isArray(input.sources) || input.sources.some(source => typeof source !== 'string')) {
    throw new Error('Export sources must be an array of strings.');
  }

  const title = cleanText(input.title).trim();
  const content = cleanText(input.content).trim();
  const sources = input.sources.map(source => cleanText(source).trim()).filter(Boolean);
  if (title.length > MAX_TITLE_LENGTH) throw new Error('Export title is too long.');
  if (content.length > MAX_CONTENT_LENGTH) throw new Error('Export content is too long.');
  if (sources.length > MAX_SOURCES) throw new Error('Too many export sources.');
  if (sources.some(source => source.length > 2_000)) throw new Error('Export source is too long.');

  return {
    title,
    content,
    sources,
    costs: typeof input.costs === 'number' && Number.isFinite(input.costs) ? input.costs : undefined,
    created_at: typeof input.created_at === 'string' ? cleanText(input.created_at).trim() : undefined,
    language: input.language === 'ar' ? 'ar' : 'en',
  };
}

export function createExportHtml(payload: ReportExportPayload): string {
  const direction = payload.language === 'ar' || containsArabic(`${payload.title}\n${payload.content}`) ? 'rtl' : 'ltr';
  const arabic = payload.language === 'ar';
  const labels = arabic ? { cost: 'التكلفة', sources: 'المصادر' } : { cost: 'Cost', sources: 'Sources' };
  const createdAt = payload.created_at ? escapeHtml(payload.created_at) : '';
  const sourceList = payload.sources.map(source => `<li>${escapeHtml(source)}</li>`).join('');
  const cost = typeof payload.costs === 'number' ? `<p class="meta">${labels.cost}: ${payload.costs}</p>` : '';
  return `<!doctype html>
<html lang="${payload.language || 'en'}" dir="${direction}">
<head><meta charset="utf-8"><style>
@page { size: A4; margin: 20mm; }
body { color: #111111; background: #ffffff; font-family: Inter, Cairo, sans-serif; font-size: 11pt; line-height: 1.65; }
h1 { font-size: 22pt; line-height: 1.3; margin: 0 0 8px; } .meta { color: #555; font-size: 9pt; margin: 3px 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 24px 0; } h2 { font-size: 14pt; margin-top: 28px; } li { overflow-wrap: anywhere; margin: 5px 0; }
</style></head><body><h1>${escapeHtml(payload.title)}</h1><p class="meta">${createdAt}</p>${cost}<pre>${escapeHtml(payload.content)}</pre><h2>${labels.sources}</h2><ol>${sourceList}</ol></body></html>`;
}

function paragraph(text: string, bidi: boolean, style?: string): string {
  const properties = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${bidi ? '<w:bidi/>' : ''}`;
  return `<w:p><w:pPr>${properties}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function createDocxBuffer(payload: ReportExportPayload): Buffer {
  const bidi = payload.language === 'ar' || containsArabic(`${payload.title}\n${payload.content}`);
  const labels = payload.language === 'ar' ? { cost: 'التكلفة', sources: 'المصادر' } : { cost: 'Cost', sources: 'Sources' };
  const body = [
    paragraph(payload.title, bidi, 'Title'),
    payload.created_at ? paragraph(payload.created_at, bidi, 'Meta') : '',
    typeof payload.costs === 'number' ? paragraph(`${labels.cost}: ${payload.costs}`, bidi, 'Meta') : '',
    ...payload.content.split(/\r?\n/).map(line => paragraph(line || ' ', bidi)),
    paragraph(labels.sources, bidi, 'Heading1'),
    ...payload.sources.map((source, index) => paragraph(`${index + 1}. ${source}`, bidi)),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>',
  ].join('');
  const created = new Date().toISOString();
  return createZipArchive([
    {
      relativePath: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    },
    {
      relativePath: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    },
    {
      relativePath: 'word/_rels/document.xml.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    },
    {
      relativePath: 'word/styles.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter" w:cs="Cairo"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/><w:rPr><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>',
    },
    {
      relativePath: 'word/document.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    },
    {
      relativePath: 'docProps/core.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(payload.title)}</dc:title><dc:creator>LENS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`,
    },
  ]);
}

export function createExportFilename(title: string, extension: 'pdf' | 'docx'): string {
  const safeTitle = title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'LENS_Research_Report';
  return `${safeTitle}.${extension}`;
}
