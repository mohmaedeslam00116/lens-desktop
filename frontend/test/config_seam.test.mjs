import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  writeSearchKeysToVendorConfig,
  readSearchKeysStatus,
  readProvisionedKey,
  hasProvisionedKey,
  redactKeyMaterial,
  clearSearchKeysFromVendorConfig,
} from '../dist-electron/engine/configSeam.js';
import { startEmbeddedServer, stopEmbeddedServer } from '../dist-electron/engine/server.js';

const realEnvTavily = process.env.TAVILY_API_KEY;
const realEnvSerper = process.env.SERPER_API_KEY;
const realPiDir = process.env.PI_CODING_AGENT_DIR;

describe('Settings → web-search.json config seam (ticket #112 — ADR-0013 D2/D7)', () => {
  let dir;
  let prevPiDir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lens-seam-'));
    prevPiDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SERPER_API_KEY;
  });

  afterEach(() => {
    if (prevPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevPiDir;
    if (realEnvTavily === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = realEnvTavily;
    if (realEnvSerper === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = realEnvSerper;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('writes a valid web-search.json the vendored shape reads (tavilyApiKey / serperApiKey)', () => {
    const summary = writeSearchKeysToVendorConfig({ tavily: 'tvly-secret-1', serper: 'serp-secret-2' });
    assert.deepEqual(summary, { set: ['tavily', 'serper'], cleared: [], wrote: true });

    const parsed = JSON.parse(readFileSync(join(dir, 'web-search.json'), 'utf-8'));
    assert.equal(parsed.tavilyApiKey, 'tvly-secret-1');
    assert.equal(parsed.serperApiKey, 'serp-secret-2');

    // Immediate in-process effect: env exported for the vendored resolver.
    assert.equal(process.env.TAVILY_API_KEY, 'tvly-secret-1');
    assert.equal(process.env.SERPER_API_KEY, 'serp-secret-2');
  });

  it('merges on write: vendored-managed fields (ssrf, fetch) are preserved, LENS fields overwritten', () => {
    writeFileSync(
      join(dir, 'web-search.json'),
      JSON.stringify({ ssrf: { allowRanges: ['127.0.0.0/8'] }, fetch: { timeout: 20 }, tavilyApiKey: 'old-key' })
    );
    writeSearchKeysToVendorConfig({ tavily: 'new-key' });

    const parsed = JSON.parse(readFileSync(join(dir, 'web-search.json'), 'utf-8'));
    assert.deepEqual(parsed.ssrf, { allowRanges: ['127.0.0.0/8'] }, 'vendored field preserved');
    assert.equal(parsed.fetch.timeout, 20, 'vendored field preserved');
    assert.equal(parsed.tavilyApiKey, 'new-key', 'LENS field overwritten');
    assert.equal(parsed.serperApiKey, undefined, 'cleared key removed');
  });

  it('empty = remove: clearing a key removes the field and the env export', () => {
    writeSearchKeysToVendorConfig({ tavily: 'tvly-here', serper: 'serp-here' });
    assert.equal(process.env.TAVILY_API_KEY, 'tvly-here');

    // Clear both LENS-owned keys: the overlay empties, so the file is removed
    // entirely (zero-config contract) and both env exports clear.
    writeSearchKeysToVendorConfig({ tavily: '', serper: undefined });
    assert.equal(existsSync(join(dir, 'web-search.json')), false, 'empty overlay removes the file');
    assert.equal(process.env.TAVILY_API_KEY, undefined, 'env cleared with the key');
    assert.equal(process.env.SERPER_API_KEY, undefined);

    // A vendored-managed field survives a clear (merge-on-write + removal).
    writeFileSync(join(dir, 'web-search.json'), JSON.stringify({ ssrf: { allowRanges: ['10.0.0.0/8'] } }));
    writeSearchKeysToVendorConfig({ tavily: 'again', serper: 'x' });
    writeSearchKeysToVendorConfig({ tavily: '', serper: '' });
    const parsed = JSON.parse(readFileSync(join(dir, 'web-search.json'), 'utf-8'));
    assert.deepEqual(parsed.ssrf, { allowRanges: ['10.0.0.0/8'] }, 'vendored field preserved');
    assert.equal(parsed.tavilyApiKey, undefined, 'cleared key removed');
  });

  it('zero-config parity: with no keys, NO config file is written', () => {
    const summary = writeSearchKeysToVendorConfig({});
    assert.equal(summary.wrote, false);
    assert.equal(existsSync(join(dir, 'web-search.json')), false, 'no file exists');

    // Clearing the last keys removes the file when nothing vendored-managed remains.
    writeSearchKeysToVendorConfig({ tavily: 'temp' });
    assert.ok(existsSync(join(dir, 'web-search.json')));
    writeSearchKeysToVendorConfig({});
    assert.equal(existsSync(join(dir, 'web-search.json')), false, 'file removed when empty');
  });

  it('readProvisionedKey mirrors vendored precedence: file > env; hasProvisionedKey leaks nothing', () => {
    assert.equal(hasProvisionedKey('tavily'), false, 'nothing provisioned');
    assert.equal(readProvisionedKey('tavily'), undefined);

    writeSearchKeysToVendorConfig({ tavily: 'file-key' });
    assert.equal(hasProvisionedKey('tavily'), true);
    assert.equal(readProvisionedKey('tavily'), 'file-key');

    // Env alone (no file): provisioned via environment.
    process.env.SERPER_API_KEY = 'env-key';
    assert.equal(hasProvisionedKey('serper'), true);
    assert.equal(readProvisionedKey('serper'), 'env-key');
  });

  it('redactKeyMaterial strips key material from error text (no-leak clause)', () => {
    const err = new Error('Tavily API error 401: key tvly-secret-1 rejected');
    const text = redactKeyMaterial(err, 'tvly-secret-1');
    assert.ok(!text.includes('tvly-secret-1'), 'key material removed');
    assert.ok(text.includes('[redacted]'), 'redaction marker present');
    assert.ok(text.includes('401'), 'diagnostic context preserved');
  });

  it('exposes the redacted status + write-through over the engine API; responses never echo keys', async () => {
    const { port } = await startEmbeddedServer(0, {});
    try {
      // POST with keys → success + redacted summary only.
      const post = await fetch(`http://127.0.0.1:${port}/api/settings/search-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: { tavily: 'tvly-via-api', serper: '' } }),
      });
      const postBody = await post.json();
      assert.equal(post.status, 200);
      assert.equal(postBody.success, true);
      assert.deepEqual(postBody.set, ['tavily']);
      assert.ok(!JSON.stringify(postBody).includes('tvly-via-api'), 'response never echoes the key');

      // The file holds the key; the GET status is boolean-only.
      assert.equal(readProvisionedKey('tavily'), 'tvly-via-api');
      const get = await fetch(`http://127.0.0.1:${port}/api/settings/search-keys`);
      const status = await get.json();
      assert.deepEqual(status, { tavily: true, serper: false });
    } finally {
      stopEmbeddedServer();
    }
  });
});
