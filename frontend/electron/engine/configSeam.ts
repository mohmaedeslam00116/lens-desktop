import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * configSeam.ts — the LENS settings → `web-search.json` write-through
 * (ADR-0013 D2/D7, ticket #112).
 *
 * Keys live in LENS settings (localStorage, renderer-owned) and write through
 * to the pi-web-access config path the vendored package already reads
 * (`<config-dir>/web-search.json`). DDG keyless remains the primary provider:
 * when no keys are configured, NO config file is written and behavior is
 * unchanged (zero-config parity).
 *
 * Semantics:
 * - **Merge-on-write**: existing vendored-managed keys (`ssrf`, `fetch`, …)
 *   are preserved; LENS owns only its provider-key fields.
 * - **Empty = remove**: a provider key set to `''` (or undefined) in settings
 *   removes the field from the file — clearing a key in LENS truly clears it.
 * - **Safe dir**: the file lives under a `0o700` directory (best-effort on
 *   Windows where POSIX modes don't apply).
 * - **Redaction**: errors never embed the file path or any key material; the
 *   log/telemetry surface only sees provider names and `{ set, cleared }`
 *   shapes — keys never appear in logs or telemetry.
 *
 * Immediate effect: the vendored credential resolver reads env vars per call,
 * so the setter ALSO exports `TAVILY_API_KEY` / `SERPER_API_KEY` to
 * `process.env` (in-process only, never persisted anywhere else). The config
 * file remains the durable copy; the vendored precedence (config file > env)
 * is preserved because the file IS written when a key exists.
 */

export interface LensSearchKeys {
  tavily?: string;
  serper?: string;
}

/** Vendored flat-key names LENS may manage (ADR-0013 D2: keyed providers are opt-in). */
const VENDOR_KEY_FIELDS: Array<{ lens: keyof LensSearchKeys; vendor: string; env: string }> = [
  { lens: 'tavily', vendor: 'tavilyApiKey', env: 'TAVILY_API_KEY' },
  { lens: 'serper', vendor: 'serperApiKey', env: 'SERPER_API_KEY' },
];

/** Only these LENS-owned fields may appear in the managed overlay. */
const MANAGED_FIELDS = new Set(VENDOR_KEY_FIELDS.map((f) => f.vendor));

function safeFilename(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Resolves the vendored config directory without reading any config. */
function resolveConfigDir(piAgentDir?: string): string {
  const explicit = piAgentDir || process.env.PI_CODING_AGENT_DIR;
  if (explicit) return explicit;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'pi');
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.pi', 'agent');
}

function redact(err: unknown): string {
  // Never embed path or key material in surfaced errors (no-leak clause).
  return err instanceof Error ? `${err.name}: config write failed` : 'config write failed';
}

/** Strips key material from an error's text before it reaches logs or
 * telemetry (no-leak clause, #112): the vendored providers redact their own
 * errors, but a warn path must never trust that blindly. */
export function redactKeyMaterial(err: unknown, keys: string | string[]): string {
  let text = String(err).slice(0, 300);
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    if (k && k.length >= 4) text = text.split(k).join('[redacted]');
  }
  return text;
}

/** Best-effort 0o600: writeFileSync applies `mode` only on creation, and the
 * vendored package may have created the file world-readable — the explicit
 * chmod re-tightens it on every write (no-op where POSIX modes don't apply). */
function tightenFileMode(file: string): void {
  try { fs.chmodSync(file, 0o600); } catch { /* non-POSIX platforms */ }
}

/**
 * Writes LENS-managed provider keys into the vendored `web-search.json`.
 * Creates/updates the file merge-safely; removes empty/undefined keys;
 * exports matching env vars for immediate in-process effect. Returns the
 * redacted change summary safe for logs/telemetry.
 */
export function writeSearchKeysToVendorConfig(
  keys: LensSearchKeys,
  options?: { piAgentDir?: string }
): { set: string[]; cleared: string[]; wrote: boolean } {
  const set: string[] = [];
  const cleared: string[] = [];

  const normalized: Record<string, string> = {};
  for (const { lens, vendor, env } of VENDOR_KEY_FIELDS) {
    const value = keys?.[lens];
    if (typeof value === 'string' && value.trim().length > 0) {
      normalized[vendor] = value.trim();
      set.push(lens);
      // Immediate in-process effect (vendored resolver reads env per call).
      // In-process only — never logged, never persisted elsewhere.
      try { process.env[env] = normalized[vendor]; } catch { /* frozen env: file copy still durable */ }
    } else {
      cleared.push(lens);
      try { delete process.env[env]; } catch { /* frozen env */ }
    }
  }

  const dir = resolveConfigDir(options?.piAgentDir);
  const file = path.join(dir, 'web-search.json');

  // No keys configured → zero-config parity: remove the managed overlay and
  // the file if nothing else remains (no file is created when none exists).
  if (set.length === 0) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (!MANAGED_FIELDS.has(k)) next[k] = v; // preserve vendored-managed fields
        }
        if (Object.keys(next).length === 0) {
          fs.rmSync(file, { force: true });
        } else {
          fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
          tightenFileMode(file);
        }
      }
    } catch {
      // Removal failures are non-fatal: no key material involved.
    }
    return { set, cleared, wrote: false };
  }

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      try {
        existing = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
      } catch {
        existing = {}; // unparseable file: rebuild with LENS overlay only
      }
    }
    const next: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(normalized)) next[k] = v;
    for (const { vendor } of VENDOR_KEY_FIELDS) {
      if (!(vendor in normalized) && vendor in next && MANAGED_FIELDS.has(vendor)) {
        delete next[vendor]; // a cleared LENS key is removed, not left stale
      }
    }
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
    tightenFileMode(file);
    return { set, cleared, wrote: true };
  } catch {
    throw new Error(redact(undefined));
  }
}

/** Redacted read-side summary for settings UI/tests: which providers are provisioned. Never returns key material. */
export function readSearchKeysStatus(options?: { piAgentDir?: string }): { tavily: boolean; serper: boolean } {
  const dir = resolveConfigDir(options?.piAgentDir);
  const file = path.join(dir, 'web-search.json');
  const status = { tavily: false, serper: false };
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
      if (typeof parsed.tavilyApiKey === 'string' && parsed.tavilyApiKey.length > 0) status.tavily = true;
      if (typeof parsed.serperApiKey === 'string' && parsed.serperApiKey.length > 0) status.serper = true;
    }
  } catch {
    // Unreadable config: report unprovisioned; never surface the error detail.
  }
  return status;
}

/** Read-side provisioning for the search plane: is the provider provisioned
 * via the config seam or environment? Boolean only — never key material. */
export function hasProvisionedKey(provider: 'tavily' | 'serper'): boolean {
  if (provider === 'tavily') {
    if (process.env.TAVILY_API_KEY) return true;
    return readSearchKeysStatus().tavily;
  }
  if (process.env.SERPER_API_KEY) return true;
  return readSearchKeysStatus().serper;
}

/** Read-side provisioning for the search plane: resolves the caller's key.
 * Precedence mirrors the vendored resolver: config file > environment. The
 * file value survives restarts (the vendored module's own config cache may
 * have memoized an empty config from before the key existed, so the explicit
 * read is what makes file-provisioned keys work in a long-lived process).
 * Returns key material BY DESIGN — the only caller is the plane's one-call
 * env override, which never logs it. */
export function readProvisionedKey(provider: 'tavily' | 'serper'): string | undefined {
  const dir = resolveConfigDir();
  const file = path.join(dir, 'web-search.json');
  const vendorField = provider === 'tavily' ? 'tavilyApiKey' : 'serperApiKey';
  const envName = provider === 'tavily' ? 'TAVILY_API_KEY' : 'SERPER_API_KEY';
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
      const value = parsed[vendorField];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
  } catch {
    // Unreadable config: fall through to the environment.
  }
  return process.env[envName] || undefined;
}

/** Removes LENS-managed key fields from the vendored config (test seam / teardown). */
export function clearSearchKeysFromVendorConfig(options?: { piAgentDir?: string }): void {
  writeSearchKeysToVendorConfig({}, options);
}

export const __testSeams = { safeFilename, resolveConfigDir, VENDOR_KEY_FIELDS };
