import { spawn } from 'node:child_process';
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeHealth(base: string): Promise<{ ok: boolean; upstream?: string }> {
  try {
    const res = await fetch(`${base}/__bili/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false };
    try {
      const body = (await res.json()) as { ok?: boolean; upstream?: string };
      return { ok: body.ok === true, upstream: body.upstream };
    } catch {
      return { ok: true };
    }
  } catch {
    return { ok: false };
  }
}

export function resolveBillionBinary(): string | null {
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

  const child = spawn(binary, ['--port', String(port)], {
    env: process.env,
    stdio: 'ignore',
  });
  child.unref?.();
  currentPid = child.pid ?? null;

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeHealth(base);
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
  const pid = currentPid;
  currentPid = null;
  activeHandle = null;
  if (pid == null) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // process already reaped
  }
}

/** Singleton handle accessor for tests and the engine's shutdown path. */
export function getBillionHandle(): BillionContextHandle | null {
  return activeHandle;
}