import { spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * billionContext.ts — supervised localhost proxy for context compression.
 *
 * `billion-context` is NOT a library: its bundle self-starts a server on
 * import, so the engine does not import it. LENS spawns the `bili` CLI as a
 * supervised child process, probes `/__bili/health`, and (when enabled) the
 * engine points model traffic at `http://127.0.0.1:<port>/bili/<upstream>` —
 * the URL-prefix mode documented by the package (no MITM/CA). The child is
 * bound to the engine lifetime and force-stopped on dispose.
 */

export interface BillionContextOptions {
  enabled?: boolean;
  /** Localhost TCP port the proxy listens on. */
  port?: number;
  /** Override the child executable (used by tests). */
  binary?: string;
  /** Health-check timeout in ms (default 8000). */
  healthTimeoutMs?: number;
  /** Cancellation: aborts the startup wait immediately. */
  signal?: AbortSignal;
}

export interface BillionContextHandle {
  port: number;
  pid: number | null;
  healthy: boolean;
  /** Base URL to give the model client (`http://127.0.0.1:<port>`). */
  baseUrl(): string;
  /** Stop and reap the child. Idempotent. */
  dispose(): Promise<void>;
}

let activeHandle: BillionContextHandle | null = null;
let currentPid: number | null = null;
let currentChild: ChildProcess | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Health probe over raw node:http — deliberately NOT globalThis.fetch, so
 * the supervisor's loopback probe is immune to app-level fetch
 * instrumentation (and test stubs). Honors an optional AbortSignal.
 */
function probeHealth(base: string, signal?: AbortSignal): Promise<{ ok: boolean; upstream?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; upstream?: string }) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      req.destroy();
      resolve(result);
    };
    const onAbort = () => finish({ ok: false });
    const req = http.get(`${base}/__bili/health`, { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body) as { ok?: boolean; upstream?: string };
            finish({ ok: parsed.ok === true, upstream: parsed.upstream });
          } catch {
            finish({ ok: true });
          }
        } else {
          finish({ ok: false });
        }
      });
      res.on('error', () => finish({ ok: false }));
    });
    req.on('timeout', () => finish({ ok: false }));
    req.on('error', () => finish({ ok: false }));
    if (signal) {
      if (signal.aborted) finish({ ok: false });
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function resolveBillionBinary(): string | null {
  // Ops/test override: point the supervisor at a specific bili binary
  // (tests use a stub script; operators can pin a version) without
  // bundling or importing billion-context in-process.
  const override = process.env.LENS_BILI_BINARY;
  if (override && fs.existsSync(override)) return override;
  const candidate = path.join(process.cwd(), 'node_modules', 'billion-context', 'dist', 'index.js');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Starts the compression proxy on `127.0.0.1:<port>` and waits for health.
 * Returns null when disabled or when the binary/health check fails.
 */
export async function startBillionContext(options: BillionContextOptions = {}): Promise<BillionContextHandle | null> {
  if (options.enabled === false) return null;
  if (activeHandle) return activeHandle;

  const port = options.port ?? 8787;
  const timeoutMs = options.healthTimeoutMs ?? 8000;
  const binary = options.binary ?? resolveBillionBinary();
  if (!binary) {
    console.warn('[billionContext] billion-context binary not found; compression proxy disabled.');
    return null;
  }

  // Spawn through the Node executable: the resolved binary is a .js bundle
  // (no exec bit / shebang guarantee on Linux/macOS, not a valid image on
  // Windows), so spawning it directly is not portable.
  const child = spawn(process.execPath, [binary, '--port', String(port)], {
    env: process.env,
    stdio: 'ignore',
    signal: options.signal,
  });
  // An unhandled 'error' event (ENOENT/EACCES/ENOEXEC) throws asynchronously
  // outside this promise and would crash the Electron main process; handle it
  // and fall back to the documented compression-disabled mode instead.
  child.on('error', (err) => {
    console.warn('[billionContext] proxy child failed to start:', err);
    if (currentChild === child) {
      currentChild = null;
      currentPid = null;
      activeHandle = null;
    }
  });
  child.on('exit', () => {
    // Clear the tracked handle once the child is gone so a stale pid can never
    // be signalled after OS pid reuse.
    if (currentChild === child) {
      currentChild = null;
      currentPid = null;
      activeHandle = null;
    }
  });
  child.unref?.();
  currentChild = child;
  currentPid = child.pid ?? null;

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      console.warn('[billionContext] startup aborted; compression disabled.');
      await disposeBillion();
      return null;
    }
    const probe = await probeHealth(base, options.signal);
    if (probe.ok) {
      const handle: BillionContextHandle = {
        port,
        pid: currentPid,
        healthy: true,
        baseUrl: () => base,
        dispose: () => disposeBillion(),
      };
      activeHandle = handle;
      console.log(`[billionContext] compression proxy healthy at ${base} (upstream ${probe.upstream ?? 'unknown'}).`);
      return handle;
    }
    await sleep(250);
  }

  console.warn(`[billionContext] proxy did not become healthy within ${timeoutMs}ms; compression disabled.`);
  await disposeBillion();
  return null;
}

/** Stop and reap the supervised child process. Idempotent. */
export async function disposeBillion(): Promise<void> {
  const child = currentChild;
  currentChild = null;
  currentPid = null;
  activeHandle = null;
  if (!child) return;
  try {
    // Kill the tracked ChildProcess handle, never a raw pid: process.kill on
    // a stale pid can signal an unrelated process after OS pid reuse, while
    // child.kill() is a no-op once the child has exited.
    child.kill('SIGKILL');
  } catch {
    // process already reaped
  }
}

/** Singleton handle accessor for tests and the engine's shutdown path. */
export function getBillionHandle(): BillionContextHandle | null {
  return activeHandle;
}