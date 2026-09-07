import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import { LiveEvent, ResearchPlan, ResearchRequest, WideResearchRequest } from './types';
import { ModelClient } from './models';
import { DeepResearchAgent } from './agent';
import { DiscoverService } from './discover';
import { fetchEmbeddingModels, createEmbeddingModel } from './embeddings';
import { SessionLifecycleManager, ResearchSession } from './sessionLifecycle';
import { generateResearchPlan, regenerateResearchPlan } from './scoping';
import { SkillRegistry, SkillActivationManager } from './skills';

interface ActiveSession {
  id: string;
  request: WideResearchRequest;
  sockets: Set<WebSocket>;
  researchSession: ResearchSession;
  isCompleted: boolean;
}

const sessionManager = new SessionLifecycleManager();
const sessions = new Map<string, ActiveSession>();
const globalSkillRegistry = new SkillRegistry();
globalSkillRegistry.discoverAll().catch(err => {
  console.warn('[Server] Error discovering agent skills:', err);
});

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-KEY');
}

function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {} as T);
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
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
    const agent = new DeepResearchAgent(
      session.id,
      (event: LiveEvent) => {
        session.researchSession.emitEvent(event);
      },
      activationManager
    );

    try {
      await agent.run(session.request, session.researchSession.signal);
      session.researchSession.complete();
    } catch (err: any) {
      if (session.researchSession.signal.aborted) {
        return;
      }
      session.researchSession.fail(err);
    }
  });
}

export function startEmbeddedServer(port = 8000): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    if (httpServer) {
      resolve({ port });
      return;
    }

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
          const researchSession = sessionManager.createSession(body);
          const sessionId = researchSession.id;

          const session: ActiveSession = {
            id: sessionId,
            request: body,
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

          const isWideMode = body.mode === 'wide' || body.report_type === 'storm';

          if (isWideMode) {
            // Phase 1: Collaborative Plan Scoping Protocol
            setImmediate(async () => {
              try {
                const plan = await generateResearchPlan(body.query, {
                  language: body.language,
                  mode: body.mode,
                  reportType: body.report_type,
                  targetSources: body.maxSources || 100,
                  maxHops: body.maxHops !== undefined ? body.maxHops : 2
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
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
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
      console.log(`[EmbeddedEngine] Native Vane TypeScript Engine running on http://127.0.0.1:${port}`);
      resolve({ port });
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
      httpServer.close(() => {
        httpServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
