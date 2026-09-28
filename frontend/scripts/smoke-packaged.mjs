#!/usr/bin/env node
/**
 * Operator smoke test for the packaged LENS desktop build.
 *
 * The suite in `test/` runs the engine from source. Nothing in it proves that
 * the *shipped* artifact — Electron main, preload bridge, bundled renderer,
 * asar packaging, and the embedded engine inside them — boots and serves. This
 * script starts the packaged executable and checks the runtime contract the
 * product depends on, failing loudly with the captured output when any part of
 * it does not hold:
 *
 *   1. pre-flight  — the preferred port is free, so the run is interpretable
 *   2. readiness   — the engine answers on its readiness route
 *   3. identity    — the report names the LENS engine AND the launched process
 *                    (a foreign listener cannot satisfy both)
 *   4. window      — no load failure reached the workspace window
 *   5. lock        — a second launch exits instead of starting a rival engine
 *   6. shutdown    — a graceful close exits the app and releases the port
 *
 * Usage:
 *   node scripts/smoke-packaged.mjs [--exe <path>] [--port <n>] [--timeout <ms>]
 *
 * Exits 0 only when every check passed; otherwise it prints the failing checks,
 * the observed behaviour, and the app's captured stdout/stderr.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(HERE, '..');

const ENGINE_IDENTITY = 'LENS embedded research engine';
const READINESS_PATH = '/';

const DEFAULT_EXE = path.join(FRONTEND_ROOT, 'dist-installer', 'win-unpacked', 'LENS.exe');

function parseArgs(argv) {
  const options = { exe: DEFAULT_EXE, port: 8000, timeoutMs: 60000 };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inlineValue] = argv[i].split('=');
    const value = inlineValue ?? argv[i + 1];
    const consumed = inlineValue ? 0 : 1;
    if (flag === '--exe') { options.exe = path.resolve(value); i += consumed; }
    else if (flag === '--port') { options.port = Number(value); i += consumed; }
    else if (flag === '--timeout') { options.timeoutMs = Number(value); i += consumed; }
    else if (flag === '--help' || flag === '-h') { options.help = true; }
  }
  return options;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when anything at all is listening on the port. */
function isPortListening(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const settle = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/** Reads the engine's readiness report; null when nothing answers. */
async function readReadinessReport(port, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${READINESS_PATH}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const checks = [];
const capturedOutput = [];
function record(name, ok, observed) {
  checks.push({ name, ok, observed });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${observed ? ` — ${observed}` : ''}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log('Usage: node scripts/smoke-packaged.mjs [--exe <path>] [--port <n>] [--timeout <ms>]');
    return 0;
  }

  console.log('LENS packaged smoke test');
  console.log(`  executable: ${options.exe}`);
  console.log(`  port:       ${options.port}`);
  console.log(`  timeout:    ${options.timeoutMs}ms`);
  console.log('');

  if (!existsSync(options.exe)) {
    record('packaged executable exists', false, `not found at ${options.exe} — run npm run build:installer first`);
    return reportAndExit();
  }
  record('packaged executable exists', true, options.exe);

  // 1. Pre-flight. If something already holds the port, every later observation
  // is ambiguous: the engine may have taken a fallback port instead.
  const portBusyBeforeLaunch = await isPortListening(options.port);
  record(
    'preferred port is free before launch',
    !portBusyBeforeLaunch,
    portBusyBeforeLaunch
      ? `port ${options.port} already has a listener — stop it and re-run`
      : `port ${options.port} refused connections`
  );
  if (portBusyBeforeLaunch) return reportAndExit();

  // 2. Launch, capturing output so a failure can quote what the app said.
  const child = spawn(options.exe, [], {
    cwd: path.dirname(options.exe),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  const capture = (chunk) => {
    const text = chunk.toString();
    capturedOutput.push(text);
    process.stdout.write(text);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  let exitedEarly = null;
  child.once('exit', (code, signal) => { exitedEarly = { code, signal }; });

  const deadline = Date.now() + options.timeoutMs;
  let report = null;
  while (Date.now() < deadline) {
    if (exitedEarly) break;
    report = await readReadinessReport(options.port);
    if (report) break;
    await sleep(500);
  }

  if (!report) {
    record(
      'engine answers the readiness route',
      false,
      exitedEarly
        ? `the app exited before serving (code ${exitedEarly.code}, signal ${exitedEarly.signal})`
        : `no readiness report within ${options.timeoutMs}ms on port ${options.port}`
    );
    return reportAndExit(child);
  }
  record('engine answers the readiness route', true, `GET ${READINESS_PATH} responded`);

  // 3. Identity. The report must name the engine and the very process we
  // launched: a stray listener can imitate a status payload, but it cannot
  // claim our child's pid.
  const identityMatches = report.engine === ENGINE_IDENTITY;
  record(
    'engine identifies itself as LENS',
    identityMatches,
    identityMatches ? ENGINE_IDENTITY : `reported engine "${report.engine}"`
  );

  const pidMatches = Number(report.pid) === child.pid;
  record(
    'reported engine pid is the launched process',
    pidMatches,
    `reported ${report.pid}, launched ${child.pid}`
  );

  const portMatches = Number(report.port) === options.port;
  record(
    'engine bound the preferred port',
    portMatches,
    `reported ${report.port}, expected ${options.port}`
  );

  // 4. The workspace window must have loaded: a blank window is a shipped
  // product failure even when the engine is healthy.
  const transcript = capturedOutput.join('');
  const windowFailed = /did-fail-load|Failed to load URL/i.test(transcript);
  record(
    'workspace window loaded without a load failure',
    !windowFailed,
    windowFailed ? 'the app logged a window load failure' : 'no load failure logged'
  );

  return afterWindowChecks(options, child);
}

/** Resolves with the exit description, or null when the process outlives `deadlineMs`. */
function waitForExit(child, deadlineMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(null);
    }, deadlineMs);
    function onExit(code, signal) {
      clearTimeout(timer);
      resolve({ code, signal });
    }
    child.once('exit', onExit);
  });
}

/**
 * Checks 5 and 6 — the two lifecycle guarantees a desktop app owes its operator.
 *
 * The second launch is the dangerous one: without the single-instance lock it
 * would start a rival engine that fights for the preferred port. And the close
 * path is what releases the port for the next run, so an app that only *looks*
 * closed would strand the port and break the following launch.
 */
async function afterWindowChecks(options, child) {
  // 5. A second launch must join the running instance, not start a rival one.
  const rival = spawn(options.exe, [], {
    cwd: path.dirname(options.exe),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  const rivalOutput = [];
  rival.stdout.on('data', (chunk) => rivalOutput.push(chunk.toString()));
  rival.stderr.on('data', (chunk) => rivalOutput.push(chunk.toString()));

  const rivalExit = await waitForExit(rival, 15000);
  record(
    'second launch exits instead of starting a rival engine',
    rivalExit !== null,
    rivalExit
      ? `exited with code ${rivalExit.code}`
      : `still running after 15000ms — the single-instance lock did not take effect (said: ${rivalOutput.join('').trim().slice(0, 200) || 'nothing'})`
  );
  if (rivalExit === null) {
    rival.kill();
  }

  // The running instance must still own the port: a rival that also bound it
  // (or replaced our listener) is exactly the failure the lock prevents.
  const reportAfterRival = await readReadinessReport(options.port);
  const stillOwner = Number(reportAfterRival?.pid) === child.pid;
  record(
    'running instance still owns the engine after the second launch',
    stillOwner,
    stillOwner
      ? `pid ${child.pid} still serving`
      : `reported pid ${reportAfterRival?.pid ?? 'none'}, expected ${child.pid}`
  );

  // 6. Graceful close. `taskkill` without /F posts a close request (WM_CLOSE) so
  // the app runs its real quit path; /F would hide a broken shutdown behind a
  // hard terminate and release the port even if LENS never stopped its engine.
  let closeRequested = true;
  if (process.platform === 'win32') {
    const killed = await new Promise((resolve) => {
      const taskkill = spawn('taskkill', ['/PID', String(child.pid)], { windowsHide: true });
      taskkill.once('exit', (code) => resolve(code === 0));
      taskkill.once('error', () => resolve(false));
    });
    closeRequested = killed;
  } else {
    child.kill('SIGTERM');
  }
  record(
    'close request reached the running app',
    closeRequested,
    process.platform === 'win32'
      ? (closeRequested ? `taskkill accepted pid ${child.pid}` : 'taskkill refused the close request')
      : 'SIGTERM sent'
  );

  const appExit = await waitForExit(child, 20000);
  record(
    'app exits on close',
    appExit !== null,
    appExit ? `exited with code ${appExit.code}` : 'still running after 20000ms'
  );

  if (appExit === null) {
    // Leave nothing behind for the next run to trip over.
    child.kill();
    await waitForExit(child, 5000);
  }

  // The port must be free: this is what makes a re-launch possible, and a
  // lingering listener is the symptom of an engine that outlived its window.
  let released = false;
  for (let attempt = 0; attempt < 20 && !released; attempt += 1) {
    released = !(await isPortListening(options.port));
    if (!released) await sleep(250);
  }
  record(
    'port is released after the app closes',
    released,
    released ? `nothing listening on ${options.port}` : `a listener still holds ${options.port}`
  );

  return reportAndExit();
}

function reportAndExit(child = null) {
  if (child && child.exitCode === null) {
    try { child.kill(); } catch { /* already gone */ }
  }

  const failed = checks.filter((check) => !check.ok);
  console.log('');
  console.log(`Checks: ${checks.length - failed.length}/${checks.length} passed`);

  if (failed.length > 0) {
    console.log('');
    console.log('Failed checks:');
    for (const check of failed) console.log(`  FAIL  ${check.name} — ${check.observed}`);

    const transcript = capturedOutput.join('').trim();
    if (transcript) {
      console.log('');
      console.log('App output:');
      console.log(transcript);
    }
  }

  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('Smoke test aborted:', err);
    process.exitCode = 1;
  });
