/**
 * TDD Unit and Integration Tests for Structure-Aware & Contextual Chunk Enrichment Pipeline
 * Part of LENS Multi-Stage Retrieval Pipeline (Ticket #5)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chunkerModule;
let bm25Module;
try {
  chunkerModule = require('../dist-electron/engine/chunker.js');
  bm25Module = require('../dist-electron/engine/bm25.js');
} catch (e) {
  console.log('[Test Setup] dist-electron not yet built; please run build:electron');
}

describe('Markdown Structure Extraction', () => {
  test('parseMarkdownSections extracts hierarchical ATX headings and maintains heading stack', () => {
    const { parseMarkdownSections } = chunkerModule;
    assert.ok(parseMarkdownSections, 'parseMarkdownSections must be exported');

    const markdown = `
# Global Tech Report 2026

Preamble paragraph discussing executive landscape.

## Quantum Computing

Overview of quantum hardware breakthroughs.

### Qubit Coherence

Detailed analysis of topological superconducting circuits.

## Energy Storage

Next-generation cell architectures.
`;

    const sections = parseMarkdownSections(markdown, 'Global Tech Report 2026');
    assert.ok(sections.length >= 3, `Expected at least 3 sections, got ${sections.length}`);

    // Section 1: Preamble or Quantum Computing
    const quantumSec = sections.find(s => s.heading === 'Quantum Computing');
    assert.ok(quantumSec);
    assert.deepStrictEqual(quantumSec.path, ['Global Tech Report 2026', 'Quantum Computing']);

    // Section 2: Qubit Coherence (level 3 nested under Quantum Computing)
    const qubitSec = sections.find(s => s.heading === 'Qubit Coherence');
    assert.ok(qubitSec);
    assert.deepStrictEqual(qubitSec.path, ['Global Tech Report 2026', 'Quantum Computing', 'Qubit Coherence']);

    // Section 3: Energy Storage (level 2 - must have popped Qubit Coherence off stack)
    const energySec = sections.find(s => s.heading === 'Energy Storage');
    assert.ok(energySec);
    assert.deepStrictEqual(energySec.path, ['Global Tech Report 2026', 'Energy Storage']);
  });

  test('parseMarkdownSections handles Arabic hierarchical headings', () => {
    const { parseMarkdownSections } = chunkerModule;

    const arMarkdown = `
# التقرير الاستراتيجي للذكاء الاصطناعي 2026

مقدمة تمهيدية حول التطورات الحديثة.

## نماذج التفكير والاستدلال

تطوير خوارزميات الاستدلال متعدّد الخطوات.

### التدقيق الذاتي والتحقق

فحص مخرجات النماذج للحد من الهلوسة.
`;

    const sections = parseMarkdownSections(arMarkdown, 'التقرير الاستراتيجي للذكاء الاصطناعي 2026');
    const auditSec = sections.find(s => s.heading.includes('التدقيق الذاتي'));
    assert.ok(auditSec, 'Must extract Arabic subheading');
    assert.strictEqual(auditSec.path.length, 3);
    assert.ok(auditSec.path[1].includes('نماذج التفكير'));
    assert.ok(auditSec.path[2].includes('التدقيق الذاتي'));
  });
});

describe('HTML DOM Structure Extraction', () => {
  test('parseHtmlSections parses HTML headings and extracts clean text without scripts or styling', () => {
    const { parseHtmlSections } = chunkerModule;
    assert.ok(parseHtmlSections, 'parseHtmlSections must be exported');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Autonomous Systems Review</title>
  <style>.ads { color: red; }</style>
  <script>console.log('tracker');</script>
</head>
<body>
  <nav><a href="/">Home</a></nav>
  <article>
    <h1>Autonomous Systems Review</h1>
    <p>Opening summary paragraph.</p>
    <h2>Perception Pipelines</h2>
    <p>LiDAR and computer vision sensor fusion models.</p>
    <h2>Planning & Control</h2>
    <p>Model predictive control for highway maneuvers.</p>
  </article>
  <footer>Copyright 2026</footer>
</body>
</html>
`;

    const sections = parseHtmlSections(html, 'Autonomous Systems Review');
    assert.ok(sections.length >= 2);

    const perceptionSec = sections.find(s => s.heading.includes('Perception Pipelines'));
    assert.ok(perceptionSec);
    assert.ok(perceptionSec.content.includes('sensor fusion'));
    assert.ok(!perceptionSec.content.includes('console.log'));
    assert.ok(!perceptionSec.content.includes('Copyright'));
  });
});

describe('Contextual Chunk Enrichment & Boundary Preservation', () => {
  test('chunkStructuredDocument prepends contextHeader in enrichedContent while keeping content clean', () => {
    const { chunkStructuredDocument } = chunkerModule;
    assert.ok(chunkStructuredDocument, 'chunkStructuredDocument must be exported');

    const markdown = `
# Semiconductor Roadmap 2026

## Lithography Innovations

High-NA EUV lithography achieves sub-2nm node patterning with enhanced overlay precision.
`;

    const chunks = chunkStructuredDocument(markdown, {
      defaultTitle: 'Semiconductor Roadmap 2026',
      citationId: 1
    });

    assert.ok(chunks.length > 0);
    const first = chunks[0];

    // Clean content should not have the breadcrumb header
    assert.ok(!first.content.startsWith('['), 'content must remain clean original text');
    assert.ok(first.content.includes('High-NA EUV lithography'));

    // Enriched content must prepend breadcrumb header
    assert.ok(first.enrichedContent.startsWith('[Semiconductor Roadmap 2026 > Lithography Innovations]'));
    assert.ok(first.enrichedContent.includes(first.content));
    assert.strictEqual(first.citationId, 1);
    assert.ok(first.tokenEstimate > 0);
  });

  test('chunkStructuredDocument respects paragraph and Arabic punctuation boundaries', () => {
    const { chunkStructuredDocument } = chunkerModule;

    const longArabicText = `
# أبحاث الطاقة المستدامة

## كفاءة الخلايا الكهروضوئية

تعتبر خلايا البيروفسكايت الشمسية قفزة نوعية في كفاءة التحويل الطاقي. حيث تجاوزت كفاءتها المختبرية حاجز 33 بالمائة.

هل يمكن تعميم هذا الإنتاج صناعياً؟ نعم، شريطة معالجة التدهور الناتج عن الرطوبة والحرارة العالية. وتعمل عدة مصانع تجريبية حالياً على تقنيات التغليف بالبوليمرات المتقدمة.
`.repeat(3);

    const chunks = chunkStructuredDocument(longArabicText, {
      defaultTitle: 'أبحاث الطاقة المستدامة',
      maxChunkSize: 250,
      chunkOverlap: 40
    });

    assert.ok(chunks.length >= 2, 'Should split long text into multiple chunks');

    for (const chunk of chunks) {
      assert.ok(chunk.content.length <= 300, `Chunk length ${chunk.content.length} exceeds reasonable bound`);
      assert.ok(chunk.enrichedContent.includes('[أبحاث الطاقة المستدامة'));
    }
  });

  test('Contextual Retrieval Validation: Header keywords match child chunk in BM25 search', () => {
    const { chunkStructuredDocument } = chunkerModule;
    const { BM25Index } = bm25Module;

    // Document where the child paragraph NEVER repeats the word 'Battery' or 'Storage'
    const doc = `
# Clean Energy Quarterly

## Solid-State Battery Architecture

Silicon-graphene anode composite demonstrates 520 Wh/kg specific energy and maintains 90% capacity after 1,200 fast-charge cycles.
`;

    const chunks = chunkStructuredDocument(doc, { defaultTitle: 'Clean Energy Quarterly' });
    assert.strictEqual(chunks.length, 1);

    const chunk = chunks[0];
    // The clean content does NOT contain the word 'Battery'
    assert.ok(!chunk.content.toLowerCase().includes('battery'), 'Child content deliberately does not contain keyword');

    // Index using enrichedContent (which contains the breadcrumb header)
    const index = new BM25Index();
    index.addDocument(chunk.id, chunk.enrichedContent, chunk);

    // Search for 'battery'
    const results = index.search('battery 520 Wh/kg');
    assert.ok(results.length > 0, 'Must retrieve chunk thanks to contextual heading enrichment');
    assert.strictEqual(results[0].id, chunk.id);
  });
});
