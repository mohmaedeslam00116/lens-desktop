import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as crypto from 'crypto';
import { LiveEvent, ResearchPlan, ResearchRequest, WideResearchRequest } from './types';
import { ModelClient } from './models';
import { DeepResearchAgent } from './agent';
import { DiscoverService } from './discover';
import { fetchEmbeddingModels, createEmbeddingModel } from './embeddings';
import { SessionLifecycleManager, ResearchSession } from './sessionLifecycle';

interface ActiveSession {
  id: string;
  request: ResearchRequest | WideResearchRequest;
  sockets: Set<WebSocket>;
  researchSession: ResearchSession;
  isCompleted: boolean;
}

const sessionManager = new SessionLifecycleManager();
const sessions = new Map<string, ActiveSession>();
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

          // Launch Agent Execution Asynchronously in background
          setImmediate(async () => {
            const agent = new DeepResearchAgent(sessionId, (event: LiveEvent) => {
              researchSession.emitEvent(event);
            });

            try {
              researchSession.transitionTo('running');
              await agent.run(body, researchSession.signal);
              researchSession.complete();
            } catch (err: any) {
              if (researchSession.signal.aborted) {
                return;
              }
              researchSession.fail(err);
            }
          });

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

          const plan = sessionManager.approveSessionPlan(body.session_id, body.plan);
          if (!plan) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found or cannot approve plan' }));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session_id: body.session_id, plan }));
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
