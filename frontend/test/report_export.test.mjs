import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDocxBuffer,
  createExportHtml,
  validateReportExportPayload,
} from '../dist-electron/engine/reportExport.js';
import { readZipArchive } from '../dist-electron/engine/skills/zipArchive.js';
import { startEmbeddedServer, stopEmbeddedServer } from '../dist-electron/engine/server.js';

const payload = {
  title: 'بحث عربي English report',
  content: 'نتيجة موثقة [1]\n<script>alert("unsafe")</script>\nGrounded finding [2].',
  sources: ['https://example.com/source-1', 'https://example.com/source-2'],
  created_at: '2026-09-08T12:00:00.000Z',
  language: 'ar',
};

describe('Report export artifacts', () => {
  it('escapes report text for Chromium PDF rendering', () => {
    const html = createExportHtml(validateReportExportPayload(payload));
    assert.match(html, /بحث عربي English report/);
    assert.match(html, /نتيجة موثقة \[1\]/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });

  it('creates a valid DOCX package with report text, citations, sources, and bidi paragraphs', () => {
    const buffer = createDocxBuffer(validateReportExportPayload(payload));
    assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK');
    const entries = new Map(readZipArchive(buffer).map(entry => [entry.relativePath, entry.content.toString('utf8')]));
    for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']) {
      assert.ok(entries.has(required), `missing ${required}`);
    }
    const documentXml = entries.get('word/document.xml');
    assert.match(documentXml, /بحث عربي English report/);
    assert.match(documentXml, /\[1\]/);
    assert.match(documentXml, /https:\/\/example\.com\/source-1/);
    assert.match(documentXml, /<w:bidi\/>/);
  });

  it('rejects malformed report payloads before any renderer is called', () => {
    assert.throws(() => validateReportExportPayload({ title: '', content: 'x', sources: [] }), /title/i);
    assert.throws(() => validateReportExportPayload({ title: 'x', content: 'x', sources: 'nope' }), /sources/i);
  });

  it('serves PDF and DOCX downloads from the embedded server', async () => {
    const fakePdf = Buffer.from('%PDF-1.7\nLENS\n');
    const { port } = await startEmbeddedServer(0, {
      reportExportService: { renderPdf: async () => fakePdf },
    });
    try {
      const pdf = await fetch(`http://127.0.0.1:${port}/api/export/pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers.get('content-type'), /application\/pdf/);
      assert.match(pdf.headers.get('content-disposition'), /attachment/);
      assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), fakePdf);

      const docx = await fetch(`http://127.0.0.1:${port}/api/export/docx`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      assert.equal(docx.status, 200);
      assert.match(docx.headers.get('content-type'), /openxmlformats/);
      assert.equal(Buffer.from(await docx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    } finally {
      await stopEmbeddedServer();
    }
  });
});
