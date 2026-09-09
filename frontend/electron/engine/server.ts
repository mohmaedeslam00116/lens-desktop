import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import { LiveEvent, ResearchPlan, ResearchRequest, WideResearchRequest } from './types';
import { ModelClient } from './models';
import { DeepResearchAgent } from './agent';
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
}

export function normalizeResearchRequest(body: WideResearchRequest): WideResearchRequest {
  const isWide = body.mode === 'wide';
  return {
    ...body,
    mode: isWide ? 'wide' : 'standard',
    ...(isWide ? { maxSources: 200, maxHops: 2 } : {}),
  };
}

export function createResearchAgent(
  request: WideResearchRequest,
  sessionId: string,
  emitEvent: (event: LiveEvent) => void,
  activationManager?: SkillActivationManager,
): DeepResearchAgent | WideResearchAgent {
  return request.mode === 'wide'
    ? new WideResearchAgent(sessionId, emitEvent, {}, activationManager)
    : new DeepResearchAgent(sessionId, emitEvent, activationManager);
}

const sessionManager = new SessionLifecycleManager();
const sessions = new Map<string, ActiveSession>();
const globalSkillRegistry = new SkillRegistry();
export const skillService = new SkillManagerService(globalSkillRegistry);
globalSkillRegistry.discoverAll().catch(err => {
  console.warn('[Server] Error discovering agent skills:', err);
});

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let reportExportService: ReportExportService | null = null;

export interface EmbeddedServerOptions {
  reportExportService?: ReportExportService;
}

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-KEY');
}

export const MAX_JSON_REQUEST_SIZE = 2 * 1024 * 1024; // 2 MB safe maximum request size

function parseJsonBody<T>(req: http.IncomingMessage, maxBytes = MAX_JSON_REQUEST_SIZE): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
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
      data += chunk;
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(data ? JSON.parse(data) : {} as T);
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
  if (session.researchSession.state === 'awaiting_approval' || session.researchSession.state === 'planning') {
    session.researchSession.approvePlan(approvedPlan);
  }

  // Strict authorization gatekeeper check
  if (!session.researchSession.isPlanAuthorized()) {
    console.warn(`[Server] Session ${session.id} plan is not authorized. Aborting retrieval execution.`);
    return;
  }

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
        session.researchSession.complete();
      }
    } catch (err: any) {
      if (session.researchSession.signal.aborted) {
        return;
      }
      session.researchSession.fail(err);
    }
  });
}

export function startEmbeddedServer(port = 8000, options: EmbeddedServerOptions = {}): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    if (httpServer) {
      resolve({ port });
      return;
    }
    reportExportService = options.reportExportService || null;

    httpServer = http.createServer(async (req, res) => {
      setCorsHeaders(res);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = parsedUrl.pathname;

      try {
        // Health check
        if (pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', engine: 'Vane TypeScript Deep Research Engine' }));
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
            const statusCode = err.statusCode === 413 ? 413 : 400;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (statusCode === 413) {
              headers['Connection'] = 'close';
            }
            res.writeHead(statusCode, headers);
            res.flushHeaders?.();
            res.end(JSON.stringify({ error: err.message || 'Invalid export payload' }));
            if (statusCode === 413) {
              res.on('finish', () => {
                setImmediate(() => {
                  if (!req.destroyed) req.destroy();
                });
              });
            }
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

        // Not Found
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (statusCode === 413) {
          headers['Connection'] = 'close';
        }
        res.writeHead(statusCode, headers);
        res.flushHeaders?.();
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
        if (statusCode === 413) {
          res.on('finish', () => {
            setImmediate(() => {
              if (!req.destroyed) req.destroy();
            });
          });
        }
      }
    });

    // WebSocket Server for live events
    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
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
      if (err.code === 'EADDRINUSE') {
        console.log(`[EmbeddedEngine] Port ${port} already in use. Assuming previous instance active.`);
        resolve({ port });
      } else {
        reject(err);
      }
    });

    httpServer.listen(port, '127.0.0.1', () => {
      const address = httpServer?.address();
      const activePort = address && typeof address === 'object' ? address.port : port;
      console.log(`[EmbeddedEngine] Native Vane TypeScript Engine running on http://127.0.0.1:${activePort}`);
      resolve({ port: activePort });
    });
  });
}

export function stopEmbeddedServer(): Promise<void> {
  return new Promise((resolve) => {
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
