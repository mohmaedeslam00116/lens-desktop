import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startEmbeddedServer, stopEmbeddedServer } from '../dist-electron/engine/server.js';

/**
 * Track A — catalog-driven Settings (SPEC #155, ticket #156).
 *
 * The eligible search providers are engine truth served from a seam, not a
 * renderer allowlist: `GET /api/pi/search-providers` lists `{ id, name,
 * badge, descEn, descAr, keyField? }` with zero key material. Track C swaps
 * the seam backend to the upgraded extension surface; this contract holds.
 */

const get = async (port, path) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(response.status, 200, `${path} must answer 200`);
  return response.json();
};

describe('Pi search-provider catalog (Track A Pi truth)', () => {
  it('serves the eligible search providers with bilingual copy and no key material', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      const body = await get(port, '/api/pi/search-providers');
      assert.ok(Array.isArray(body.providers), 'providers is a list');
      assert.ok(body.providers.length >= 3, 'at least the plane providers list');

      const ids = body.providers.map((p) => p.id);
      assert.ok(ids.includes('duckduckgo'), 'the keyless default lists');
      assert.ok(ids.includes('tavily'), 'the keyed providers list');
      assert.ok(ids.includes('serper'), 'the keyed providers list');

      const serialized = JSON.stringify(body);
      assert.doesNotMatch(serialized, /apiKey|api_key|tvly-|serper-/, 'no key material travels the route');

      for (const provider of body.providers) {
        assert.equal(typeof provider.id, 'string');
        assert.equal(typeof provider.name, 'string');
        assert.equal(typeof provider.badge, 'string');
        assert.equal(typeof provider.descEn, 'string', `${provider.id} carries English copy`);
        assert.equal(typeof provider.descAr, 'string', `${provider.id} carries Arabic copy`);
        assert.ok(
          provider.keyField === undefined || typeof provider.keyField === 'string',
          `${provider.id} keyField is absent or a field name — never a secret`
        );
      }
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('the seam is the single source: server serves exactly what the seam returns', async () => {
    const { __testSeams } = await import('../dist-electron/engine/piSearchProviders.js');
    const seam = __testSeams.getSearchProviderCatalog();
    assert.ok(Array.isArray(seam) && seam.length >= 3);

    const { port } = await startEmbeddedServer(0);
    try {
      const body = await get(port, '/api/pi/search-providers');
      assert.deepEqual(
        body.providers.map((p) => p.id),
        seam.map((p) => p.id),
        'the route serves the seam verbatim — no renderer-side list can drift'
      );
    } finally {
      await stopEmbeddedServer();
    }
  });
});
