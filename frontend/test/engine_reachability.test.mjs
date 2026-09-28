import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startEmbeddedServer, stopEmbeddedServer } from '../dist-electron/engine/server.js';
import {
  ENGINE_IDENTITY,
  INTERPRETED_REASONS,
  interpretEngineHealthReport,
  isFallbackPort,
  probeEngineHealth,
} from '../src/utils/engineHealth.mjs';
import {
  DEFAULT_ENGINE_PORT,
  resolveEngineEndpoint,
  resolveEngineEndpointFromWindow,
} from '../src/utils/engineEndpoint.mjs';

/**
 * The engine and the renderer agree on two contracts that nothing else checked:
 * what the readiness route reports, and which port the workspace must talk to.
 *
 * Both were previously assumed. `main.ts` bound port 8000 and treated
 * `EADDRINUSE` as "a previous instance is active", so LENS would drive whatever
 * answered on that port, and an unreachable engine stayed invisible until the
 * first search failed. These tests boot the real engine and fail loudly if
 * either side drifts.
 */

/** Answers like a healthy service without being LENS. */
function startForeignListener() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', engine: 'some-other-service', port: 1234 }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

describe('Embedded engine reachability contract', () => {
  it('reports the identity, pid, and bound port the renderer requires', async () => {
    const { port } = await startEmbeddedServer(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(response.status, 200);

      const report = await response.json();
      assert.equal(report.status, 'ok');
      assert.equal(
        report.engine,
        ENGINE_IDENTITY,
        'the readiness route must name the engine the renderer requires'
      );
      assert.equal(report.port, port, 'the report must name the port it is actually bound to');
      assert.ok(Number.isInteger(report.pid) && report.pid > 0, 'the report must name its process');

      // The renderer's interpreter must accept the real engine's own report.
      const verdict = interpretEngineHealthReport(report, port);
      assert.equal(verdict.ok, true);
      assert.equal(verdict.reason, 'ok');
    } finally {
      await stopEmbeddedServer();
    }
  });

  it('refuses to mistake a foreign listener for the engine', async () => {
    const { server, port } = await startForeignListener();
    try {
      // A live, healthy, non-LENS listener: reachability alone would pass.
      const reachable = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(reachable.status, 200);

      const probe = await probeEngineHealth({ baseUrl: `http://127.0.0.1:${port}` });
      assert.equal(probe.status, 'offline');
      assert.equal(probe.reason, 'invalid_report');
    } finally {
      await closeServer(server);
    }
  });

  it('reports an unreachable engine instead of throwing', async () => {
    // Bind and release a port so the address is almost certainly free.
    const { server, port } = await startForeignListener();
    await closeServer(server);

    const probe = await probeEngineHealth({ baseUrl: `http://127.0.0.1:${port}` });
    assert.equal(probe.status, 'offline');
    assert.ok(
      probe.reason === 'unreachable' || probe.reason === 'timeout',
      `expected a transport failure reason, got ${probe.reason}`
    );
  });

  it('flags a report whose port belongs to someone else', () => {
    const foreign = interpretEngineHealthReport(
      { status: 'ok', engine: ENGINE_IDENTITY, port: 6553, pid: 1 },
      DEFAULT_ENGINE_PORT
    );
    assert.equal(foreign.ok, false);
    assert.equal(foreign.reason, 'port_owner_mismatch');
    assert.equal(foreign.reportedPort, 6553);
  });

  it('exposes only reasons the interface can translate', () => {
    // The interface switches on these strings; an unlisted reason would render
    // the wrong sentence for a real condition.
    for (const report of [
      null,
      'not-json',
      {},
      { status: 'ok' },
      { status: 'ok', engine: 'other' },
      { status: 'degraded', engine: ENGINE_IDENTITY },
    ]) {
      const verdict = interpretEngineHealthReport(report, null);
      assert.equal(verdict.ok, false);
      assert.ok(
        INTERPRETED_REASONS.includes(verdict.reason),
        `${verdict.reason} is not among the interpreted reasons`
      );
    }
  });

  it('detects a fallback port but not the preferred one', () => {
    assert.equal(isFallbackPort(8001, DEFAULT_ENGINE_PORT), true);
    assert.equal(isFallbackPort(DEFAULT_ENGINE_PORT, DEFAULT_ENGINE_PORT), false);
    assert.equal(isFallbackPort(null, DEFAULT_ENGINE_PORT), false);
  });
});

describe('Engine endpoint resolution', () => {
  it('uses the endpoint the preload bridge reports', () => {
    const endpoint = resolveEngineEndpoint({
      endpoint: {
        port: 8123,
        baseUrl: 'http://127.0.0.1:8123',
        wsBaseUrl: 'ws://127.0.0.1:8123',
        status: 'ready',
        error: null,
      },
    });

    assert.equal(endpoint.port, 8123);
    assert.equal(endpoint.baseUrl, 'http://127.0.0.1:8123');
    assert.equal(endpoint.wsBaseUrl, 'ws://127.0.0.1:8123');
    assert.equal(endpoint.status, 'ready');
  });

  it('falls back to the declared preference without a bridge', () => {
    const endpoint = resolveEngineEndpoint(undefined);
    assert.equal(endpoint.port, DEFAULT_ENGINE_PORT);
    assert.equal(endpoint.baseUrl, `http://127.0.0.1:${DEFAULT_ENGINE_PORT}`);
    assert.equal(endpoint.wsBaseUrl, `ws://127.0.0.1:${DEFAULT_ENGINE_PORT}`);
  });

  it('carries a startup failure through to the interface', async () => {
    const endpoint = resolveEngineEndpoint({
      endpoint: { port: null, baseUrl: null, wsBaseUrl: null, status: 'failed', error: 'EADDRINUSE' },
    });

    assert.equal(endpoint.status, 'failed');
    assert.equal(endpoint.error, 'EADDRINUSE', 'the operator-facing reason must survive resolution');
    // The preference is still reported so the notice can name the port that was lost.
    assert.equal(endpoint.port, DEFAULT_ENGINE_PORT);

    // No address is routable. A failed startup means the preferred port is only
    // a guess, and whatever holds it is not LENS — handing the workspace that
    // address would send research starts (API keys included) to a stranger, so
    // the failed endpoint resolves to no address at all.
    assert.equal(endpoint.baseUrl, null);
    assert.equal(endpoint.wsBaseUrl, null);

    // The probe must refuse to touch the network rather than guess the port.
    let attempts = 0;
    const result = await probeEngineHealth({
      baseUrl: endpoint.baseUrl,
      expectedPort: endpoint.port,
      fetchImpl: () => {
        attempts += 1;
        throw new Error('the probe must not request a guessed address');
      },
    });

    assert.equal(attempts, 0, 'a failed startup must not produce a request to a guessed port');
    assert.equal(result.status, 'offline');
    assert.equal(result.reason, 'unreachable');
  });

  it('reads the bridge off the renderer window', () => {
    const endpoint = resolveEngineEndpointFromWindow({
      electronAPI: {
        engine: { endpoint: { port: 9123, baseUrl: 'http://127.0.0.1:9123/', status: 'ready' } },
      },
    });

    assert.equal(endpoint.port, 9123);
    assert.equal(endpoint.baseUrl, 'http://127.0.0.1:9123', 'trailing slashes must be trimmed');
    assert.equal(endpoint.wsBaseUrl, 'ws://127.0.0.1:9123');
  });
});

describe('Embedded engine startup failure behaviour', () => {
  it('reports a held port instead of claiming the existing listener is LENS', async () => {
    const { server, port } = await startForeignListener();
    try {
      // This is what `main.ts` retries on: it must fail, not resolve.
      await assert.rejects(
        () => startEmbeddedServer(port),
        (error) => error.code === 'EADDRINUSE',
        'binding a held port must fail loudly'
      );
    } finally {
      await closeServer(server);
    }
  });

  it('recovers onto an ephemeral port after a held preferred port is released', async () => {
    const { server, port } = await startForeignListener();
    await closeServer(server);

    // The path `main.ts` takes when the preferred port is busy: the failed
    // attempt must leave no half-built listener behind, so binding a fresh
    // port still succeeds and reports its own port.
    const { port: boundPort } = await startEmbeddedServer(0);
    try {
      assert.notEqual(boundPort, port, 'the engine must not reuse the foreign port');

      const report = await (await fetch(`http://127.0.0.1:${boundPort}/`)).json();
      assert.equal(report.status, 'ok');
      assert.equal(report.port, boundPort);
      assert.equal(interpretEngineHealthReport(report, boundPort).ok, true);
    } finally {
      await stopEmbeddedServer();
    }

    // A stopped engine must free its port, or the next launch would hit
    // EADDRINUSE and fall back for no reason.
    await assert.rejects(() => fetch(`http://127.0.0.1:${boundPort}/`));
  });
});
