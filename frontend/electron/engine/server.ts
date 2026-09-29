import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import { LiveEvent, ResearchPlan, ResearchRequest, WideResearchRequest } from './types';
import { ModelClient } from './models';
import { DeepResearchAgent } from './agent';
import { ParentResearchAgent, resetResearcherBudget } from './parentAgent';
// ADR-0010 closure (ticket #104): DeepResearchAgent's only remaining
// consumers are the followup Q&A static and the wide-mode session-completion
// path — the standard-loop route now goes exclusively through the parent.
import { evictPackageToolCache } from './piResearchTools';
import {
  runAgenticSearch,
  cancelAgenticSearch,
  agenticAdmissionGuard,
  createAgenticToolSurface,
  type AgenticRunState,
} from './agenticSearch';
import { createAgenticResearchSession } from './agenticSessionBootstrap';
import { primarySearchPlane } from './searchPlane';
import { primaryScrapePlane } from './scrapePlane';
import { WideResearchAgent, WideResearchRunResult } from './wideAgent';
import { DiscoverService } from './discover';
import { fetchEmbeddingModels, createEmbeddingModel } from './embeddings';
import { SessionLifecycleManager, ResearchSession } from './sessionLifecycle';
import { generateResearchPlan, regenerateResearchPlan } from './scoping';
import { SkillRegistry, SkillActivationManager, SkillManagerService } from './skills';
import {
  createDocxBuffer,
  createExportFilename,
  createExportHtml,
  ReportExportService,
  validateReportExportPayload,
} from './reportExport';

interface ActiveSession {
  id: string;
  request: WideResearchRequest;
  sockets: Set<WebSocket>;
  researchSession: ResearchSession;
  isCompleted: boolean;
  executionStarted?: boolean;
}

export function normalizeResearchRequest(body: WideResearchRequest): WideResearchRequest {
  const isWide = body.mode === 'wide';
  return {
    ...body,
    mode: isWide ? 'wide' : 'standard',
    ...(isWide ? { maxSources: 200, maxHops: 2 } : {}),
  };
}

const PROVIDER_KEY_FIELD: Record<string, string> = {
  openai: 'openai',
  gemini: 'gemini',
  anthropic: 'anthropic',
  groq: 'groq',
  deepseek: 'deepseek',
  openrouter: 'openrouter',
  mistral: 'mistral',
};

/** Start-time admission guard: cloud providers require a usable key (settings
 * key or direct field), Ollama requires a reachable endpoint. Returns a
 * bilingual, user-presentable message or null when the provider can plausibly
 * work. Keyed-provider engine errors still surface mid-run via `fail()`; this
 * guard only removes the guaranteed-hang case (visibility fix, ticket #119). */
export function providerAdmissionGuard(body: Partial<WideResearchRequest> | undefined): string | null {
  const provider = (body?.llm_provider || 'gemini').trim().toLowerCase();
  if (provider === 'ollama') {
    const endpoint = (body?.ollama_endpoint || '').trim();
    if (!endpoint) {
      return 'No Ollama endpoint configured. Open Settings → add your Ollama server URL (e.g. http://127.0.0.1:11434), then retry. | لم يتم إعداد خادم Ollama. افتح الإعدادات ← أضف عنوان الخادم (مثال: http://127.0.0.1:11434) ثم أعد المحاولة.';
    }
    return null;
  }
  const keyField = PROVIDER_KEY_FIELD[provider];
  if (!keyField) return null; // unknown provider id: let the engine fail with its own precise error
  const key = (body?.api_keys?.[keyField] || '').trim();
  if (!key) {
    return `No API key configured for "${provider}". Open Settings → paste your ${provider} key, then retry. | لا يوجد مفتاح API للمزود "${provider}". افتح الإعدادات ← أضف المفتاح ثم أعد المحاولة.`;
  }
  return null;
}

export function createResearchAgent(
  request: WideResearchRequest,
  sessionId: string,
  emitEvent: (event: LiveEvent) => void,
  activationManager?: SkillActivationManager,
): WideResearchAgent | ParentResearchAgent {
  // ADR-0010 phase 4/5 closure (ticket #104): the agency path IS the standard
  // research path. The legacy single-loop escape hatch (`legacy_mode` request
  // flag / `legacyMode` setting) was removed after its soak waiver — requests
  // still carrying the flag have it silently dropped (no schema validation;
  // documented in ADR-0012 and #104). Wide mode is never rerouted.
  if (request.mode !== 'wide') {
    return new ParentResearchAgent(sessionId, emitEvent, activationManager);
  }
  return new WideResearchAgent(sessionId, emitEvent, {}, activationManager);
}

const sessionManager = new SessionLifecycleManager();
const sessions = new Map<string, ActiveSession>();
const globalSkillRegistry = new SkillRegistry();
export const skillService = new SkillManagerService(globalSkillRegistry);
globalSkillRegistry.discoverAll().catch(err => {
  console.warn('[Server] Error discovering agent skills:', err);
});

/** The Agentic Search surface (ticket #142): the routes the engine exposes
 * beside the research routes. One runner per session; the routes never touch
 * Deep Research's plan-gated path. */
export const AGENTIC_ROUTES = ['/api/agent/start', '/api/agent/steer', '/api/agent/cancel'] as const;

/** The agentic-run request shape: one question, one admission surface. */
export interface AgenticStartRequest {
  question: string;
  provider?: string;
  api_key?: string;
  ollama_endpoint?: string;
  max_fetches?: number;
}

/** Server-side admission-time normalization of the start request. */
function normalizeAgentStartRequest(body: Partial<AgenticStartRequest> | undefined): AgenticStartRequest {
  const provider = typeof body?.provider === 'string' && body.provider.trim() ? body.provider.trim().toLowerCase() : 'gemini';
  return {
    question: String(body?.question ?? '').trim(),
    provider,
    api_key: typeof body?.api_key === 'string' ? body.api_key : undefined,
    ollama_endpoint: typeof body?.ollama_endpoint === 'string' ? body.ollama_endpoint : undefined,
    max_fetches: typeof body?.max_fetches === 'number' && Number.isFinite(body.max_fetches) && body.max_fetches > 0
      ? Math.floor(body.max_fetches)
      : 12,
  };
}

/**
 * Start-time admission guard for the agentic surface (mirrors #119): without
 * a usable provider the run can only hang, so it is rejected bilingually —
 * an HTTP 422, never a started run that starves in silence.
 */
export function providerAdmissionGuardForAgent(body: Partial<AgenticStartRequest> | undefined): string | null {
  return agenticAdmissionGuard({
    provider: body?.provider,
    apiKey: body?.api_key,
    ollamaEndpoint: body?.ollama_endpoint,
  });
}

interface ActiveAgentRun {
  state: AgenticRunState;
  session: any;
}
/** Live agentic runs by sessionId: one run per session, per the runner's
 * registry contract. The map is written at start (BEFORE the first emission,
 * so streaming subscribers always find their session) and removed at terminal. */
const activeAgentSessions = new Map<string, ActiveAgentRun>();

/** Fan one agentic LiveEvent out to the run's live event subscribers, and
 * remove the run from the live map at its terminal. Every event reaches the
 * subscriber with an incrementing `eventId` — the same delta-replay contract
 * the research sessions stream under — and lands in the bounded per-session
 * log so a late /ws/agent/:id attach replays what it missed. */
function emitAgentEvent(sessionId: string, event: LiveEvent): void {
  const run = activeAgentSessions.get(sessionId);
  if (!run) return;
  agentEventSeq.set(sessionId, (agentEventSeq.get(sessionId) ?? 0) + 1);
  const envelope: LiveEvent & { eventId?: number } = { ...event, eventId: agentEventSeq.get(sessionId) };
  const log = agentEventLog.get(sessionId) ?? [];
  log.push(envelope);
  if (log.length > AGENT_EVENT_LOG_CAP) log.shift();
  agentEventLog.set(sessionId, log);
  for (const subscriber of agentEventSubscribers) {
    try {
      subscriber(sessionId, envelope);
    } catch {
      // A broken subscriber never starves the run or its other observers.
    }
  }
  if (['finished', 'error', 'cancelled', 'budget_exhausted'].includes(event.type)) {
    activeAgentSessions.delete(sessionId);
    agentEventSeq.delete(sessionId);
    // The log outlives the run briefly so a subscriber attaching around the
    // terminal still replays it; the next run on a fresh sessionId never
    // sees it (ids are unique per start).
    setTimeout(() => agentEventLog.delete(sessionId), 30_000).unref?.();
  }
}

/** Live agentic-event subscribers (the /ws/agent/:id bridge registers here). */
const agentEventSubscribers = new Set<(sessionId: string, event: LiveEvent) => void>();
/** Per-session event counters backing the delta-replay envelope. */
const agentEventSeq = new Map<string, number>();
/** Bounded per-session event log: a subscriber that attaches after the run
 * started replays what it missed (the /ws/research delta contract, carried
 * over) — a run's early events are never lost to a slow attach. */
const agentEventLog = new Map<string, Array<LiveEvent & { eventId?: number }>>();
const AGENT_EVENT_LOG_CAP = 500;

/**
 * Build, register, and run one agentic session server-side: the #140 seam
 * builds the hosted session with the LENS-wrapped tool surface registered at
 * construction, the retrieval routes through the primary plane (ledgered —
 * ADR-0013 D5), and the runner drives one Turn-Group into explicit terminals.
 * This is the engine surface the renderer's Agentic Search talks to.
 *
 * Resolves once the session is constructed and REGISTERED — the accepting
 * HTTP response and the client's /ws/agent/:id attach precede the first
 * emission; the run itself starts on the next tick.
 */
export async function startAgenticSearchSession(
  sessionId: string,
  request: AgenticStartRequest
): Promise<void> {
  const state: AgenticRunState = { sources: [], reportChunks: [], fetchesUsed: 0 };
  const surface = createAgenticToolSurface({
    sessionId,
    state,
    maxFetches: request.max_fetches ?? 12,
    emit: (event) => emitAgentEvent(sessionId, event),
    search: async (query) => {
      const hits = await primarySearchPlane(query);
      return hits.map((hit) => ({ url: hit.url, title: hit.title, snippet: hit.snippet }));
    },
    fetchPage: async (url) => {
      const page = await primaryScrapePlane(url);
      return page.content ? { url: page.url, title: page.title, text: page.content } : null;
    },
  });
  const session = await createAgenticResearchSession(sessionId, surface, {
    provider: request.provider,
    apiKey: request.api_key,
  });
  activeAgentSessions.set(sessionId, { state, session });
  // Registered BEFORE the run starts: the first emissions find their session.
  setImmediate(() => {
    runAgenticSearch(session, {
      sessionId,
      question: request.question,
      state,
      emit: (event) => emitAgentEvent(sessionId, event),
    }).catch((err: any) => {
      console.error('[Server] Agentic run failed:', err?.message ?? String(err));
      emitAgentEvent(sessionId, {
        type: 'error',
        sessionId,
        state: 'failed',
        message: `Agentic run failed: ${err?.message ?? String(err)}`,
      } as LiveEvent);
    });
  });
}

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let reportExportService: ReportExportService | null = null;
let boundPort: number | null = null;

export interface EmbeddedServerOptions {
  reportExportService?: ReportExportService;
}

export const DEFAULT_SESSION_RETENTION_MS = 30 * 60 * 1000; // 30 minutes retention
const sessionCleanupTimers = new Map<string, NodeJS.Timeout>();

export function scheduleSessionCleanup(sessionId: string, delayMs = DEFAULT_SESSION_RETENTION_MS) {
  if (sessionCleanupTimers.has(sessionId)) {
    clearTimeout(sessionCleanupTimers.get(sessionId)!);
  }
  const timer = setTimeout(() => {
    const session = sessions.get(sessionId);
    if (session) {
      for (const socket of session.sockets) {
        try {
          socket.terminate();
        } catch {
          // Continue terminating the remaining retained sockets.
        }
      }
      session.sockets.clear();
    }
    sessionManager.removeSession(sessionId);
    sessions.delete(sessionId);
    sessionCleanupTimers.delete(sessionId);
    // Session-scoped package tools (pi-web-access ctx, rpiv-todo store) must
    // not outlive the session — evict to keep the per-session cache bounded.
    evictPackageToolCache(sessionId);
    // Session-scoped researcher allowance (ADR-0010 decision 8) likewise.
    resetResearcherBudget(sessionId);
  }, delayMs);
  if (timer.unref) {
    timer.unref();
  }
  sessionCleanupTimers.set(sessionId, timer);
}

export function isAllowedLocalOrigin(origin?: string): boolean {
  if (!origin) return true;
  if (origin === 'null') return false;
  try {
    const url = new URL(origin);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.protocol === 'file:' ||
      url.protocol === 'vscode-webview:'
    );
  } catch {
    return false;
  }
}

function setCorsHeaders(res: http.ServerResponse, origin?: string) {
  if (origin && isAllowedLocalOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-KEY');
}

export const MAX_JSON_REQUEST_SIZE = 2 * 1024 * 1024; // 2 MB safe maximum request size

/**
 * Failsafe deadline for finishing a 413 response after the client stops
 * uploading an oversized body. Generous on purpose: ending the response early
 * makes TCP discard it as an RST.
 */
export const PAYLOAD_TOO_LARGE_DRAIN_TIMEOUT_MS = 30_000;

function parseJsonBody<T>(req: http.IncomingMessage, maxBytes = MAX_JSON_REQUEST_SIZE): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxBytes) {
      aborted = true;
      const err: any = new Error('Payload Too Large');
      err.statusCode = 413;
      req.pause();
      req.resume();
      reject(err);
      return;
    }

    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        const err: any = new Error('Payload Too Large');
        err.statusCode = 413;
        req.pause();
        reject(err);
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {} as T);
      } catch (err) {
        const parseErr: any = new Error('Invalid JSON payload');
        parseErr.statusCode = 400;
        reject(parseErr);
      }
    });

    req.on('error', err => {
      if (aborted) return;
      reject(err);
    });
  });
}

function sendPayloadTooLargeResponse(req: http.IncomingMessage, res: http.ServerResponse, message = 'Payload Too Large'): void {
  res.writeHead(413, {
    'Content-Type': 'application/json',
    'Connection': 'close',
  });
  res.flushHeaders?.();

  // Drain the client's inbound stream FIRST. Node reads a response on a socket
  // whose inbound buffer is non-empty and destroys that socket on close —
  // which emits an RST and destroys the unread response bytes with it, so the
  // client observes ECONNRESET instead of 413. Waiting for 'end' (the client
  // finishes writing the oversized body) before ending the response keeps the
  // bytes intact; the deadline is only a failsafe for a client that never
  // finishes, and it is deliberately generous so parallel test load cannot
  // trigger an early destroy.
  let replied = false;
  const reply = () => {
    if (replied) return;
    replied = true;
    clearTimeout(deadline);
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: message }));
    }
  };

  const deadline = setTimeout(reply, PAYLOAD_TOO_LARGE_DRAIN_TIMEOUT_MS);
  deadline.unref?.();

  req.on('end', reply);
  // A client that aborts mid-upload can never read the response; releasing the
  // socket here just stops us from leaking the deadline.
  req.on('aborted', reply);
  req.resume();
}

function extractArchivePayload(body: any): Buffer | Array<{ path: string; content: string }> | null {
  if (body?.zipBase64) {
    return Buffer.from(body.zipBase64, 'base64');
  }
  if (Array.isArray(body?.files)) {
    return body.files;
  }
  return null;
}

function startAuthorizedExecution(session: ActiveSession, approvedPlan?: ResearchPlan) {
  if (session.executionStarted) {
    return;
  }
  if (session.researchSession.state === 'awaiting_approval' || session.researchSession.state === 'planning') {
    session.researchSession.approvePlan(approvedPlan);
  }

  // Strict authorization gatekeeper check
  if (!session.researchSession.isPlanAuthorized()) {
    console.warn(`[Server] Session ${session.id} plan is not authorized. Aborting retrieval execution.`);
    return;
  }

  session.executionStarted = true;

  // Bind approved plan to the request to freeze retrieval trajectory
  if (approvedPlan) {
    session.request.plan = approvedPlan;
  }

  setImmediate(async () => {
    const activationManager = new SkillActivationManager(globalSkillRegistry);
    const agent = createResearchAgent(
      session.request,
      session.id,
      (event: LiveEvent) => {
        session.researchSession.emitEvent(event);
      },
      activationManager
    );

    try {
      const result = await agent.run(session.request, session.researchSession.signal);
      if (session.researchSession.signal.aborted) return;
      if (session.request.mode === 'wide') {
        const wideResult = result as WideResearchRunResult | undefined;
        session.researchSession.complete({
          report: wideResult?.report,
          sources: wideResult?.sources,
          metrics: { costs: 0 },
        }, { emitFinished: false });
      } else {
        // Standard + agency(parent-delegated) path: the loop emits the
        // agent-level finished, then complete() emits the session-level one —
        // identical sequence for both paths, so parity holds.
        session.researchSession.complete();
      }
    } catch (err: any) {
      if (session.researchSession.signal.aborted) {
        return;
      }
      const raw = err?.message || String(err);
      // Watchdog/idle failures arrive as AbortError-ish messages; reword them
      // into a user-actionable sentence instead of a bare "aborted".
      const userMessage = /stalled|aborted/i.test(raw)
        ? 'Model request stalled or was interrupted. Check your provider connection and try again. | تعذر استجابة النموذج — تحقق من الاتصال بالمزود ثم أعد المحاولة.'
        : raw;
      session.researchSession.fail(new Error(userMessage));
    }
  });
}

export function startEmbeddedServer(port = 8000, options: EmbeddedServerOptions = {}): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    if (httpServer) {
      resolve({ port });
      return;
    }

    let listening = false;
    let settled = false;

    // Startup failed: the port is not ours. Release the half-built pieces so a
    // retry on another port starts clean, then report the real cause.
    const failStartup = (err: any) => {
      if (settled) return;
      settled = true;
      if (wss) {
        wss.removeAllListeners();
        wss = null;
      }
      httpServer = null;
      boundPort = null;
      reject(err);
    };

    reportExportService = options.reportExportService || null;

    httpServer = http.createServer(async (req, res) => {
      const origin = req.headers.origin;
      if (origin && !isAllowedLocalOrigin(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Untrusted cross-origin request rejected' }));
        return;
      }

      setCorsHeaders(res, origin);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = parsedUrl.pathname;

      try {
        // Health check. This doubles as the operator smoke test's readiness
        // probe, so it reports the owning process and bound port: only that
        // pair proves the caller reached THIS engine rather than an unrelated
        // listener that happens to answer on the same port.
        if (pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            engine: 'LENS embedded research engine',
            pid: process.pid,
            port: boundPort,
          }));
          return;
        }

        // Provider Models
        if (pathname === '/api/models' && req.method === 'GET') {
          const provider = parsedUrl.searchParams.get('provider') || 'gemini';
          const apiKey = parsedUrl.searchParams.get('api_key') || undefined;
          const endpoint = parsedUrl.searchParams.get('endpoint') || undefined;
          const type = parsedUrl.searchParams.get('type') || 'chat';

          if (type === 'embedding') {
            const models = await fetchEmbeddingModels(provider, apiKey, endpoint);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ provider, type: 'embedding', models }));
            return;
          }

          const models = await ModelClient.fetchDynamicModels(provider, apiKey, endpoint);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ provider, models }));
          return;
        }

        // Live Discover News Feed
        if (pathname === '/api/discover' && req.method === 'GET') {
          const topic = parsedUrl.searchParams.get('topic') || 'tech';
          const query = parsedUrl.searchParams.get('q') || undefined;
          const language = (parsedUrl.searchParams.get('language') as 'ar' | 'en') || 'ar';
          const articles = await DiscoverService.fetchNews(topic, query, language);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ topic, articles }));
          return;
        }

        // Skills Management API (Tracer 9)
        if (pathname === '/api/skills' && req.method === 'GET') {
          const skills = await skillService.listSkillsDetailed();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ skills }));
          return;
        }

        if (pathname === '/api/skills/toggle' && req.method === 'POST') {
          const body = await parseJsonBody<any>(req);
          const isEnabled = skillService.toggleSkillEnabled(body.name, body.enabled);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, name: body.name, isEnabled }));
          return;
        }

        if (pathname === '/api/skills/inspect' && req.method === 'POST') {
          const body = await parseJsonBody<any>(req);
          const payload = extractArchivePayload(body);
          if (!payload) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing zipBase64 or files payload' }));
            return;
          }

          const inspection = skillService.inspectPackage(payload, body.scope || 'workspace');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ inspection }));
          return;
        }

        if (pathname === '/api/skills/import' && req.method === 'POST') {
          const body = await parseJsonBody<any>(req);
          const payload = extractArchivePayload(body);
          if (!payload) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing zipBase64 or files payload' }));
            return;
          }

          try {
            const result = await skillService.importSkill(payload, {
              scope: body.scope || 'workspace',
              collisionAction: body.collisionAction || 'overwrite',
              renameTo: body.renameTo
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
          return;
        }

        if (pathname === '/api/skills/export' && req.method === 'GET') {
          const name = parsedUrl.searchParams.get('name');
          if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing skill name parameter' }));
            return;
          }

          try {
            const { filename, buffer } = await skillService.exportSkill(name);
            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'Content-Length': buffer.length
            });
            res.end(buffer);
          } catch (err: any) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
          return;
        }

        // Connection & Latency Test
        if (pathname === '/api/models/test' && req.method === 'POST') {
          const body = await parseJsonBody<any>(req);
          const result = await ModelClient.testConnection(
            body.provider,
            body.api_key,
            body.endpoint,
            body.model_name
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

        // Settings → web-search.json write-through (ADR-0013 D2/D7, #112):
        // keyed pi-web-access providers become opt-in. Keys are NEVER echoed
        // back — the response carries only the redacted change summary.
        if (pathname === '/api/settings/search-keys' && req.method === 'POST') {
          const body = await parseJsonBody<any>(req);
          const { writeSearchKeysToVendorConfig } = await import('./configSeam');
          const summary = writeSearchKeysToVendorConfig({
            tavily: typeof body?.keys?.tavily === 'string' ? body.keys.tavily : undefined,
            serper: typeof body?.keys?.serper === 'string' ? body.keys.serper : undefined,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...summary }));
          return;
        }
        if (pathname === '/api/settings/search-keys' && req.method === 'GET') {
          const { readSearchKeysStatus } = await import('./configSeam');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(readSearchKeysStatus()));
          return;
        }

        // Embedding Connection & Latency Test
        if (pathname === '/api/models/test-embedding' && req.method === 'POST') {
          const body = await parseJsonBody<any>(req);
          const startTime = Date.now();
          try {
            const modelInstance = createEmbeddingModel({
              provider: body.provider,
              model: body.model_name,
              apiKey: body.api_key,
              endpoint: body.endpoint,
              timeoutMs: 8000
            });
            const vectors = await modelInstance.embedText(['Test connection ping']);
            if (!vectors || vectors.length === 0 || !vectors[0] || vectors[0].length === 0) {
              throw new Error('Received empty vector from embedding provider');
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              latency_ms: Date.now() - startTime,
              dimensions: vectors[0].length,
              message: `Successfully connected to ${body.provider} (${vectors[0].length} dimensions).`
            }));
          } catch (err: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              latency_ms: Date.now() - startTime,
              error: err.message || 'Failed to connect to embedding model'
            }));
          }
          return;
        }

        // Start Deep Research Task
        if (pathname === '/api/research/start' && req.method === 'POST') {
          const body = await parseJsonBody<WideResearchRequest>(req);
          // Fail loudly at admission when no usable model provider is configured:
          // without this guard the run hangs silently (no provider → no tokens,
          // no exception) — the reported "stuck at checking" experience.
          const providerGuard = providerAdmissionGuard(body);
          if (providerGuard) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: providerGuard }));
            return;
          }
          const normalizedRequest = normalizeResearchRequest(body);
          const researchSession = sessionManager.createSession(normalizedRequest);
          const sessionId = researchSession.id;

          const session: ActiveSession = {
            id: sessionId,
            request: normalizedRequest,
            sockets: new Set(),
            researchSession,
            isCompleted: false
          };
          sessions.set(sessionId, session);

          // Listen to session events and broadcast to active sockets
          researchSession.subscribe((event: LiveEvent) => {
            const messageStr = JSON.stringify(event);
            for (const socket of session.sockets) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(messageStr);
              }
            }
            if (event.type === 'finished' || event.type === 'error' || event.type === 'cancelled') {
              session.isCompleted = true;
              scheduleSessionCleanup(sessionId);
            }
          });

          const isWideMode = normalizedRequest.mode === 'wide';

          if (isWideMode) {
            // Phase 1: Collaborative Plan Scoping Protocol
            setImmediate(async () => {
              try {
                const plan = await generateResearchPlan(normalizedRequest.query, {
                  language: normalizedRequest.language,
                  mode: 'wide',
                  reportType: normalizedRequest.report_type,
                  targetSources: 100,
                  maxHops: 2
                });
                researchSession.submitPlanProposed(plan);
              } catch (err: any) {
                researchSession.fail(err);
              }
            });
          } else {
            // Standard Mode: Run immediately
            startAuthorizedExecution(session);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ session_id: sessionId }));
          return;
        }

        // Cancel Active Research Session
        if (pathname === '/api/research/cancel' && req.method === 'POST') {
          const body = await parseJsonBody<{ session_id: string; reason?: string }>(req);
          if (!body.session_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing session_id parameter' }));
            return;
          }

          const draft = await sessionManager.cancelSession(body.session_id, body.reason);
          if (!draft) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_id: body.session_id, partialDraft: draft }));
          return;
        }

        // Approve Research Plan Endpoint
        if (pathname === '/api/research/plan/approve' && req.method === 'POST') {
          const body = await parseJsonBody<{ session_id: string; plan?: ResearchPlan }>(req);
          if (!body.session_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing session_id parameter' }));
            return;
          }

          const session = sessions.get(body.session_id);
          if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }

          const plan = sessionManager.approveSessionPlan(body.session_id, body.plan);
          if (!plan) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cannot approve plan in current session state' }));
            return;
          }

          startAuthorizedExecution(session, plan);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_id: body.session_id, plan }));
          return;
        }

        // Reject Research Plan Endpoint
        if (pathname === '/api/research/plan/reject' && req.method === 'POST') {
          const body = await parseJsonBody<{ session_id: string; reason?: string }>(req);
          if (!body.session_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing session_id parameter' }));
            return;
          }

          const session = sessions.get(body.session_id);
          if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }

          sessionManager.rejectSessionPlan(body.session_id, body.reason);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_id: body.session_id }));
          return;
        }

        // Regenerate Research Plan Endpoint
        if (pathname === '/api/research/plan/regenerate' && req.method === 'POST') {
          const body = await parseJsonBody<{ session_id: string; modifier?: string }>(req);
          if (!body.session_id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing session_id parameter' }));
            return;
          }

          const session = sessions.get(body.session_id);
          if (!session || !session.researchSession.plan) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session or plan not found' }));
            return;
          }

          const newPlan = await regenerateResearchPlan(
            session.researchSession.plan,
            body.modifier,
            {
              language: session.request.language,
              mode: session.request.mode,
              reportType: session.request.report_type
            }
          );
          session.researchSession.submitPlanProposed(newPlan);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_id: body.session_id, plan: newPlan }));
          return;
        }

        if ((pathname === '/api/export/pdf' || pathname === '/api/export/docx') && req.method === 'POST') {
          let payload;
          try {
            payload = validateReportExportPayload(await parseJsonBody<unknown>(req));
          } catch (err: any) {
            if (err.statusCode === 413) {
              sendPayloadTooLargeResponse(req, res, err.message || 'Payload Too Large');
              return;
            }
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Invalid export payload' }));
            return;
          }

          const isPdf = pathname.endsWith('/pdf');
          if (isPdf && !reportExportService) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'PDF export is available only in the desktop application.' }));
            return;
          }

          try {
            const buffer = isPdf
              ? await reportExportService!.renderPdf(createExportHtml(payload))
              : createDocxBuffer(payload);
            const extension = isPdf ? 'pdf' : 'docx';
            res.writeHead(200, {
              'Content-Type': isPdf
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'Content-Length': buffer.length,
              'Content-Disposition': `attachment; filename="${createExportFilename(payload.title, extension)}"`,
            });
            res.end(buffer);
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Unable to create export' }));
          }
          return;
        }

        // Follow-up question endpoint
        if (pathname === '/api/followup' && req.method === 'POST') {
          const body = await parseJsonBody<any>(req);
          const answer = await DeepResearchAgent.answerFollowup(
            body.query,
            body.report_content || '',
            body.chat_history || [],
            {
              provider: body.llm_provider || 'gemini',
              model: body.model_name,
              apiKey: body.api_keys?.[body.llm_provider] || body.api_keys?.gemini,
              endpoint: body.ollama_endpoint
            }
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ answer }));
          return;
        }

        if (pathname === '/api/agent/start' && req.method === 'POST') {
          const raw = await parseJsonBody<Partial<AgenticStartRequest>>(req);
          // Admission first (#119 mirrored at the agentic surface): without a
          // usable provider the run can only hang — reject bilingually.
          const agentGuard = providerAdmissionGuardForAgent(raw);
          if (agentGuard) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: agentGuard }));
            return;
          }
          const request = normalizeAgentStartRequest(raw);
          if (!request.question) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing question parameter | معامل السؤال مفقود' }));
            return;
          }
          const sessionId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const acceptPayload = { session_id: sessionId, session_url: `/ws/agent/${sessionId}` };
          // Construction is awaited so the accepting response and the client's
          // /ws/agent/:id attach always find a registered session; the run
          // starts on the next tick inside startAgenticSearchSession.
          try {
            await startAgenticSearchSession(sessionId, request);
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Failed to start the agentic run: ${err?.message ?? String(err)}` }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(acceptPayload));
          return;
        }

        // Steer the live agentic run for a session (queued mid-run).
        if (pathname === '/api/agent/steer' && req.method === 'POST') {
          const body = await parseJsonBody<{ session_id?: string; message?: string }>(req);
          const run = body.session_id ? activeAgentSessions.get(body.session_id) : undefined;
          if (!run) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No live agentic run for this session | لا يوجد تشغيل أجنتي حي لهذه الجلسة' }));
            return;
          }
          const message = String(body.message ?? '').trim();
          if (!message || typeof run.session.steer !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing message parameter | معامل الرسالة مفقود' }));
            return;
          }
          await run.session.steer(message);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_id: body.session_id }));
          return;
        }

        // Cancel the live agentic run for a session (explicit terminal).
        if (pathname === '/api/agent/cancel' && req.method === 'POST') {
          const body = await parseJsonBody<{ session_id?: string }>(req);
          const found = body.session_id ? activeAgentSessions.has(body.session_id) : false;
          const cancelled = found ? cancelAgenticSearch(body.session_id!) : false;
          if (!found || !cancelled) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No live agentic run for this session | لا يوجد تشغيل أجنتي حي لهذه الجلسة' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_id: body.session_id }));
          return;
        }

        // Not Found
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      } catch (err: any) {
        if (err.statusCode === 413) {
          sendPayloadTooLargeResponse(req, res, err.message || 'Payload Too Large');
          return;
        }
        const statusCode = err.statusCode || 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    });

    // WebSocket Server for live events
    wss = new WebSocketServer({ server: httpServer });

    // `ws` re-emits the HTTP server's errors on the WebSocketServer, so without
    // this listener a taken port crashes the process with an unhandled 'error'
    // event instead of reaching the caller's fallback.
    wss.on('error', (err: any) => {
      if (listening) {
        console.error('[EmbeddedEngine] WebSocket server error after startup:', err);
        return;
      }
      failStartup(err);
    });

    wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const origin = req.headers.origin;
      if (origin && !isAllowedLocalOrigin(origin)) {
        ws.close(1008, 'Untrusted origin');
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

      // Agentic Search event stream (/ws/agent/:id, ticket #142): subscribes
      // to the run's LiveEvents and streams them — one bridge, one contract.
      const agentMatch = parsedUrl.pathname.match(/^\/ws\/agent\/([a-zA-Z0-9-]+)$/);
      if (agentMatch) {
        const agentSessionId = agentMatch[1];
        if (!activeAgentSessions.has(agentSessionId)) {
          ws.close(1008, 'Session not found');
          return;
        }
        // Replay what the run already emitted, then subscribe live — the
        // research-session delta contract, carried onto the agentic stream.
        for (const event of agentEventLog.get(agentSessionId) ?? []) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
          }
        }
        const subscriber = (sessionId: string, event: LiveEvent) => {
          if (sessionId === agentSessionId && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
          }
        };
        agentEventSubscribers.add(subscriber);
        ws.on('close', () => {
          agentEventSubscribers.delete(subscriber);
        });
        return;
      }

      const match = parsedUrl.pathname.match(/\/ws\/research\/([a-zA-Z0-9-]+)/);
      const sessionId = match ? match[1] : null;

      if (!sessionId || !sessions.has(sessionId)) {
        ws.close(1008, 'Session not found');
        return;
      }

      const session = sessions.get(sessionId)!;
      session.sockets.add(ws);

      // Replay buffered events with delta support via query parameter: ?since=<lastEventId>
      const sinceParam = parsedUrl.searchParams.get('since');
      const lastEventId = sinceParam ? parseInt(sinceParam, 10) : 0;
      const replayEvents = session.researchSession.getEventsSince(isNaN(lastEventId) ? 0 : lastEventId);

      for (const event of replayEvents) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event));
        }
      }

      ws.on('message', (data: any) => {
        const text = data.toString();
        if (text === 'ping') {
          ws.send('pong');
          return;
        }

        try {
          const parsed = JSON.parse(text);
          if (parsed.type === 'get_events_since') {
            const sinceId = typeof parsed.lastEventId === 'number' ? parsed.lastEventId : 0;
            const deltaEvents = session.researchSession.getEventsSince(sinceId);
            for (const ev of deltaEvents) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(ev));
              }
            }
          } else {
            const action = parsed.action || parsed.type;
            if (action === 'plan_approved' || action === 'approve_plan') {
              const approvedPlan = parsed.plan || session.researchSession.plan;
              sessionManager.approveSessionPlan(session.id, approvedPlan);
              startAuthorizedExecution(session, approvedPlan);
            } else if (action === 'plan_rejected' || action === 'reject_plan') {
              sessionManager.rejectSessionPlan(session.id, parsed.reason);
            } else if (action === 'plan_regenerate' || action === 'regenerate_plan') {
              if (session.researchSession.plan) {
                regenerateResearchPlan(
                  session.researchSession.plan,
                  parsed.modifier,
                  {
                    language: session.request.language,
                    mode: session.request.mode,
                    reportType: session.request.report_type
                  }
                ).then((newPlan) => {
                  session.researchSession.submitPlanProposed(newPlan);
                }).catch((err) => {
                  session.researchSession.fail(err);
                });
              }
            }
          }
        } catch {
          // Ignore non-JSON control messages
        }
      });

      ws.on('close', () => {
        session.sockets.delete(ws);
      });
    });

    httpServer.on('error', (err: any) => {
      if (listening) {
        // The engine is already serving. A later socket error must be surfaced
        // without tearing down a live server or its WebSocket endpoint.
        console.error('[EmbeddedEngine] Server error after startup:', err);
        return;
      }
      // A bound port is ownership. Silently treating a foreign listener as
      // "the previous instance" would let LENS drive whatever answered on the
      // preferred port, so the failure reaches the caller instead of resolving.
      failStartup(err);
    });

    httpServer.listen(port, '127.0.0.1', () => {
      const address = httpServer?.address();
      boundPort = address && typeof address === 'object' ? address.port : port;
      listening = true;
      settled = true;
      console.log(`[EmbeddedEngine] LENS research engine running on http://127.0.0.1:${boundPort}`);
      resolve({ port: boundPort });
    });
  });
}

export function stopEmbeddedServer(): Promise<void> {
  return new Promise((resolve) => {
    boundPort = null;
    if (wss) {
      wss.close();
      wss = null;
    }
    if (httpServer) {
      if (typeof (httpServer as any).closeAllConnections === 'function') {
        (httpServer as any).closeAllConnections();
      }
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          httpServer = null;
          reportExportService = null;
          resolve();
        }
      };
      httpServer.close(done);
      setTimeout(done, 500).unref?.();
    } else {
      resolve();
    }
  });
}
