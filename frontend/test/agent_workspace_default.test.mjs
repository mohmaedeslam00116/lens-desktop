import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * Ticket #145 — Agent workspace default: rail, composer, cards and chips on
 * the real feed (SPEC-028; direction #126). The harness workspace becomes the
 * DEFAULT workspace and Agentic Search the default-in-chat interaction
 * (v1 agent-management scope: one loop, explicit cancel):
 *
 *  - Default launch lands in the harness workspace (no opt-in preview gate).
 *  - A chat question starts an Agentic Search run against the engine's
 *    `/api/agent/start` surface; cards/chips render from the live feed only.
 *  - Steering queues visibly before applying; auto-retries are shown; cancel
 *    surfaces the explicit terminal state with the evidence admitted so far.
 *  - Deep Research keeps its plan-first path and the plan-approval overlay.
 */

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/** Source with comment lines stripped, so a mention in prose never satisfies a pin. */
const readSrc = async (path) => {
  const source = await read(path);
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
};

describe('The harness workspace is the default workspace', () => {
  it('App renders the harness workspace unconditionally — no opt-in preview gate', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.doesNotMatch(
      app,
      /isHarnessPreviewOpen/,
      'the opt-in harness-preview gate is gone from App',
    );
    assert.match(app, /<LensHarnessWorkspace/, 'App mounts the harness workspace as its root surface');
    assert.doesNotMatch(app, /onOpenHarness/, 'no sidebar harness opt-in prop remains');
  });

  it('the harness workspace is no longer an exit-able preview — it is the workspace', async () => {
    const codeOnly = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.doesNotMatch(
      codeOnly,
      /onExit/,
      'the harness workspace has no exit-to-legacy escape hatch',
    );
    assert.match(codeOnly, /data-testid="lens-harness"/, 'the harness shell is pinned');
  });
});

describe('A chat question starts an Agentic Search run', () => {
  it('App owns a startAgentRun transport to the engine agentic surface', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /startAgentRun/i, 'App has a named agentic-start transport');
    assert.match(app, /\/api\/agent\/start/, 'it posts to the engine agentic start route');
    assert.match(app, /\/ws\/agent\//, 'it attaches the live agentic event stream');
    assert.match(app, /session_url/, 'the accept payload names the stream to attach');
  });

  it('the workspace composer default is Agentic Search, with Deep Research opt-in', async () => {
    const codeOnly = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(codeOnly, /agentInteraction|interaction:\s*'agent'/, 'the workspace models the interaction kind explicitly');
    assert.match(codeOnly, /'deep-research'/, 'Deep Research remains an explicit opt-in in the composer');
    assert.match(codeOnly, /useState<AgentInteraction>\('agent'\)/, 'AGENTIC SEARCH IS THE DEFAULT when the composer has no explicit choice');
    assert.match(codeOnly, /onStartAgentRun/, 'the workspace hands the question to the agentic transport');
    assert.match(codeOnly, /onStartDeepResearch/, 'the Deep Research path keeps its own entry point');
    // Tool chips render from the live agentic feed only — never invented.
    assert.match(codeOnly, /agentRunFeed/, 'the workspace consumes the reduced live feed');
    assert.match(codeOnly, /<AgentRunFeed/, 'the workspace mounts the live run feed section');
    const feedSection = await readSrc('../src/components/harness/AgentRunFeed.tsx');
    assert.match(feedSection, /feed\.toolChips/, 'tool chips render from the live feed');
    assert.match(feedSection, /feed\.sources/, 'admitted sources render from the live feed');
    assert.match(feedSection, /feed\.retries/, 'auto-retries render as visible states');
    assert.match(feedSection, /feed\.steerNotice/, 'the steering queue renders as a visible state');
  });

  it('the request payload is real: question plus credentials, resolved endpoint — never a fabricated call', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /question:\s*trimmed|question:\s*query|question/, 'the payload carries the user question');
    assert.match(app, /agentAbortControllersRef|AbortController/, 'the agentic run is abortable client-side');
  });
});

describe('Steering, retries, and cancel are visible states', () => {
  it('the pure reducer models steering-queued, retry, and cancelled visibility', async () => {
    const { reduceAgentRun } = await import('../src/utils/agentRunFeed.mjs');
    const s0 = reduceAgentRun(undefined, { type: 'started', sessionId: 's1' });
    assert.equal(s0.phase, 'running');
    assert.deepEqual(s0.toolChips, []);

    const s1 = reduceAgentRun(s0, { type: 'tool_call', sessionId: 's1', toolName: 'web_search', args: { query: 'evidence' } });
    assert.equal(s1.toolChips.length, 1, 'a tool chip appears from the real event');
    assert.equal(s1.toolChips[0].toolName, 'web_search');
    assert.deepEqual(s1.toolChips[0].args, { query: 'evidence' });

    const s2 = reduceAgentRun(s1, { type: 'tool_result', sessionId: 's1', toolName: 'web_search', output: '[1] evidence found' });
    assert.match(s2.toolChips[0].resultText ?? '', /evidence found/, 'the chip shows the real tool output');

    const s3 = reduceAgentRun(s2, { type: 'source', sessionId: 's1', source: { url: 'https://x.example/1', title: 'X' } });
    assert.equal(s3.sources.length, 1, 'admitted sources accumulate live');
    assert.equal(s3.sources[0].url, 'https://x.example/1');

    const s4 = reduceAgentRun(s3, { type: 'steer_queued', sessionId: 's1', message: 'focus on the ledger' });
    assert.equal(s4.steerQueue.length, 1, 'a steering message shows as queued BEFORE it applies');
    assert.equal(s4.steerQueue[0].message, 'focus on the ledger');
    assert.equal(s4.steerNotice !== null, true, 'the queue state is visible');
    assert.match(s4.steerNotice.label, /queued|queued/i, 'the notice says queued, not applied');

    const s5 = reduceAgentRun(s4, { type: 'steer_applied', sessionId: 's1' });
    assert.equal(s5.steerQueue.length, 0, 'the queued entry leaves the queue when applied');
    assert.equal(s5.steerNotice, null);

    const s6 = reduceAgentRun(s5, { type: 'retry', sessionId: 's1', attempt: 1, reason: 'rate limited' });
    assert.equal(s6.retries.length, 1, 'an auto-retry is a visible state');
    assert.match(s6.retries[0].label, /attempt 1|rate limited/, 'the retry names its attempt and reason');

    const s7 = reduceAgentRun(s6, { type: 'cancelled', sessionId: 's1' });
    assert.equal(s7.phase, 'cancelled', 'cancel is an explicit terminal');
    assert.equal(s7.sources.length, 1, 'the evidence admitted so far survives cancel');
    assert.equal(s7.toolChips.length, 1, 'the tool trail survives cancel');
  });

  it('the reducer ignores events from other sessions and never fabricates a terminal', async () => {
    const { reduceAgentRun } = await import('../src/utils/agentRunFeed.mjs');
    const s0 = reduceAgentRun(undefined, { type: 'started', sessionId: 's1' });
    const ignored = reduceAgentRun(s0, { type: 'tool_call', sessionId: 'other', toolName: 'web_search', args: {} });
    assert.equal(ignored, s0, 'another session’s events do not mutate this run');
    const s1 = reduceAgentRun(s0, { type: 'tool_call', sessionId: 's1', toolName: 'fetch_content', args: { url: 'https://y.example' } });
    const s2 = reduceAgentRun(s1, { type: 'finished', sessionId: 's1' });
    assert.equal(s2.phase, 'finished', 'the real terminal lands');
  });

  it('budget_exhausted never freezes the feed: the warning records, the run continues, the terminal lands', async () => {
    const { reduceAgentRun, initialAgentRunState, isAgentRunTerminal } = await import('../src/utils/agentRunFeed.mjs');
    assert.equal(isAgentRunTerminal('budget_exhausted'), false, 'the warning is not a terminal');
    assert.equal(isAgentRunTerminal('finished'), true);
    assert.equal(isAgentRunTerminal('cancelled'), true);
    assert.equal(isAgentRunTerminal('error'), true);
    let feed = reduceAgentRun(initialAgentRunState('s1'), { type: 'started', sessionId: 's1' });
    feed = reduceAgentRun(feed, { type: 'report_chunk', sessionId: 's1', chunk: 'partial ' });
    feed = reduceAgentRun(feed, { type: 'budget_exhausted', sessionId: 's1', message: 'cap reached' });
    assert.equal(feed.phase, 'running', 'the feed stays live through the mid-run warning');
    feed = reduceAgentRun(feed, { type: 'report_chunk', sessionId: 's1', chunk: 'answer.' });
    assert.equal(feed.reportText, 'partial answer.', 'later chunks still accumulate after the warning');
    feed = reduceAgentRun(feed, { type: 'finished', sessionId: 's1' });
    assert.equal(feed.phase, 'finished', 'the explicit terminal lands after the warning');
  });

  it('the feed is seeded session-less, so the first real event seeds the real id (no deaf feed)', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.doesNotMatch(
      app,
      /initialAgentRunState\(''\)/,
      'seeding with an empty session id makes sameSession reject every real event — the feed would never leave idle'
    );
    assert.match(app, /setAgentRunFeed\(null\)/, 'the feed seeds to null and self-seeds from the first event');
  });

  it('a new agent run starts from a clean workspace — no previous-run state bleeds through', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(
      app,
      /const handleStartAgentRun[\s\S]{0,2600}setLiveReport\(''\)/,
      'the agent start clears the streamed report text'
    );
    assert.match(
      app,
      /const handleStartAgentRun[\s\S]{0,2600}liveReportRef\.current = '';/,
      'the agent start clears the report fallback ref the finished handler reads'
    );
    assert.match(
      app,
      /const handleStartAgentRun[\s\S]{0,2600}setVisitedSources\(\[\]\)/,
      'the agent start clears previously admitted sources'
    );
    assert.match(
      app,
      /const handleStartAgentRun[\s\S]{0,2600}setThoughts\(\[\]\)/,
      'the agent start clears thoughts'
    );
    assert.match(
      app,
      /const handleStartAgentRun[\s\S]{0,2600}agentWsRef\.current\?\.close\(\)/,
      'the agent start tears down a previous agent socket before attaching the new one'
    );
  });

  it('budget_exhausted never ends the run client-side: no socket close, no state clear, no frozen feed', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.doesNotMatch(
      app,
      /'cancelled' \|\| payload\.type === 'budget_exhausted'/,
      'the warning must not share the terminal branch that closes the socket and clears searching state'
    );
    assert.match(
      app,
      /payload\.type === 'budget_exhausted'/,
      'the warning has its own non-terminal handling'
    );
    assert.match(
      app,
      /ws\.onclose[\s\S]{0,400}agentWsRef\.current !== ws/,
      'a superseded socket close never settles another run’s state'
    );
  });

  it('New Research tears down the agent socket and the feed', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /agentWsRef/, 'the agent socket lives in a ref, not a local variable');
    assert.match(
      app,
      /const handleNewResearch[\s\S]{0,600}agentWsRef\.current\?\.close\(\)[\s\S]{0,300}setAgentRunFeed\(null\)/,
      'New Research closes the live agent socket and clears the feed'
    );
  });

  it('an unexpected socket close is an explicit terminal — the feed never stays running silently', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /onerror/, 'the agent socket has an error handler');
    assert.match(
      app,
      /ws\.onclose[\s\S]{0,800}type: 'error'/,
      'a close without a terminal event dispatches the explicit error terminal'
    );
  });

  it('cancel is wired end-to-end: a stop control posting to the engine cancel route', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /cancelAgentRun/i, 'App owns a cancel transport');
    assert.match(app, /\/api\/agent\/cancel/, 'it posts to the engine cancel route');
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /onCancelAgentRun/, 'the workspace exposes the stop control');
    const header = await readSrc('../src/components/harness/AgentSessionHeader.tsx');
    assert.match(header, /Square/, 'the session header carries a visible stop affordance while live');
    const feed = await readSrc('../src/components/harness/AgentRunFeed.tsx');
    assert.match(feed, /Square/, 'the live feed carries a visible stop affordance while running');
  });

  it('steering is wired end-to-end: the workspace hands a follow-up to the steer transport while a run is live', async () => {
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /onSteerAgentRun|onSteer/, 'the workspace exposes steering');
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /\/api\/agent\/steer/, 'App posts to the engine steer route');
    assert.match(app, /steer_queued|type: 'steer_queued'/, 'App applies the steer as a QUEUED visible state');
  });
});

describe('The workspace reads as an agent session', () => {
  it('the active canvas opens with the agent session header, not a static card', async () => {
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /<AgentSessionHeader/, 'one question, one live agent: the run header leads the canvas');
    assert.match(workspace, /hideQueryHeader/, 'the report no longer repeats the question as a second H1');
    assert.doesNotMatch(workspace, /harness-session-card/, 'the static status card is gone');
  });

  it('the run feed narrates the live work instead of counting it', async () => {
    const feed = await readSrc('../src/components/harness/AgentRunFeed.tsx');
    assert.match(feed, /harness-agent-activity/, 'the current activity reads in plain language');
    assert.match(feed, /describeArgs/, 'tool arguments read as a one-line summary, never a raw JSON dump');
    assert.match(feed, /aria-expanded/, 'tool calls expand to their real outputs');
    assert.match(feed, /lastEvent === 'budget_exhausted'/, 'the mid-run budget warning surfaces visibly');
    assert.match(feed, /harness-agent-sources-list/, 'admitted sources list with titles, not just a count');
  });

  it('the answer mode lives with the composers, not detached in a footer', async () => {
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.doesNotMatch(workspace, /harness-composer-foot/, 'no detached footer radio');
    const followUp = await readSrc('../src/components/vane/MessageInput.tsx');
    assert.match(followUp, /AgentInteractionSwitch/, 'the follow-up composer carries the mode choice');
    assert.match(followUp, /runLive/, 'the follow-up composer knows when sending steers a live run');
    const empty = await readSrc('../src/components/vane/EmptyChatMessageInput.tsx');
    assert.match(empty, /AgentInteractionSwitch/, 'the first-question composer carries the mode choice');
    assert.match(empty, /showResearchTuning/, 'the agentic default entry hides Deep Research tuning controls');
  });

  it('the inspector replays the persisted conversation for the live session', async () => {
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /conversationProjection=\{conversationProjection\}/, 'App’s projection reaches the inspector');
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /conversationProjection=\{conversationProjection\}/, 'App hands the projection to the workspace');
  });

  it('the reasoning graph tab is backed by real session nodes', async () => {
    const box = await readSrc('../src/components/vane/MessageBox.tsx');
    assert.match(box, /graphNodes=\{graphNodes\}/, 'the graph view renders the session’s nodes, never a hardcoded empty list');
    assert.doesNotMatch(box, /graphNodes=\{\[\]\}/, 'no dead graph tab');
  });
});

describe('Settings renders Pi truth (P1 - Pi-only backend)', () => {
  it('the chat tab lists Pi providers and tests through Pi, never LENS-owned endpoints', async () => {
    const modal = await readSrc('../src/components/SettingsModal.tsx');
    assert.match(modal, /\/api\/pi\/providers/, 'provider and model lists come from the Pi catalog route');
    assert.match(modal, /\/api\/pi\/test/, 'the connection test runs on Pi transport');
    assert.match(modal, /apiBase/, 'the resolved engine endpoint is injected, never guessed');
    assert.doesNotMatch(modal, /127\.0\.0\.1:8000/, 'no hardcoded engine address');
    assert.doesNotMatch(modal, /\/api\/models\/test[^_-]/, 'the native ModelClient test path is gone from Settings');
    assert.doesNotMatch(modal, /GPT-4o \/ o3/, 'no hardcoded LENS provider pill survives');
  });

  it('the engine serves the Pi test route and no longer serves the native one', async () => {
    const server = await readSrc('../electron/engine/server.ts');
    assert.match(server, /\/api\/pi\/test/, 'Pi connection test route exists');
    assert.doesNotMatch(server, /pathname === '\/api\/models\/test'/, 'the native test route is deleted with its last caller');
  });

  it('Discover reaches the engine through the injected endpoint', async () => {
    const view = await readSrc('../src/components/vane/DiscoverView.tsx');
    assert.match(view, /apiBase/, 'the view takes the resolved endpoint');
    assert.doesNotMatch(view, /127\.0\.0\.1:8000/, 'no hardcoded engine address');
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /apiBase=\{API_BASE\}/, 'App injects the bridge-resolved endpoint');
  });
});

describe('Pi owns auth + defaults (P2 - Pi-only backend)', () => {
  it('requests carry Pi ids only — no key envelopes', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.doesNotMatch(app, /api_keys:\s*settings\.keys/, 'research start carries no key map');
    assert.doesNotMatch(app, /api_key:\s*activeKey/, 'agent start carries no per-request key');
    assert.doesNotMatch(app, /settings\.keys\[settings\.llm_provider/, 'no local key gate reads plaintext');
    const request = await readSrc('../src/utils/researchRequest.mjs');
    assert.doesNotMatch(request, /api_keys/, 'the payload builder carries no key envelope');
    const server = await readSrc('../electron/engine/server.ts');
    assert.doesNotMatch(server, /PROVIDER_KEY_FIELD/, 'the key-field map is deleted');
    assert.doesNotMatch(server, /body\?\.api_keys/, 'the engine reads no request keys');
    assert.match(server, /\/api\/pi\/auth/, 'chat keys persist through the Pi auth route');
    assert.match(server, /\/api\/pi\/defaults/, 'defaults persist through the Pi defaults route');
  });

  it('Settings persists through Pi and holds no chat-key plaintext', async () => {
    const modal = await readSrc('../src/components/SettingsModal.tsx');
    assert.match(modal, /\/api\/pi\/auth/, 'Save writes the key into Pi auth.json');
    assert.match(modal, /\/api\/pi\/defaults/, 'Save writes the default provider/model into Pi settings');
    assert.match(modal, /keyInputs/, 'key inputs are transient component state');
    assert.doesNotMatch(modal, /toPiId/, 'the read-mapping is deleted with the LENS-id state');
    assert.doesNotMatch(modal, /SUPPORTED_LENS_IDS/, 'the LENS-id pill list is gone');
    // Track A (SPEC #155): the 8-id Pi allowlist is deleted with the closed
    // contract — pills iterate the live Pi catalog state instead.
    assert.doesNotMatch(modal, /SUPPORTED_PI_IDS/, 'the Pi-id allowlist is gone');
    assert.match(modal, /piProviders\.map\(/, 'pills render the Pi catalog');
    const types = await readSrc('../src/types/index.ts');
    assert.doesNotMatch(types, /gemini\?:\s*string/, 'no chat-key slots survive in ApiSettings');
    assert.match(types, /'google'/, 'the provider vocabulary speaks Pi ids');
  });

  it('the engine holds no parallel catalog, mapping, or key seams', async () => {
    const server = await readSrc('../electron/engine/server.ts');
    assert.doesNotMatch(server, /fetchDynamicModels/, 'the native catalog fetcher is deleted');
    const models = await readSrc('../electron/engine/models.ts');
    assert.doesNotMatch(models, /fetchDynamicModels/, 'the fetcher implementation is deleted');
    assert.doesNotMatch(models, /static async testConnection/, 'the native connection tester is deleted');
    const host = await readSrc('../electron/engine/agentSessionHost.ts');
    assert.doesNotMatch(host, /translateLensProviderId/, 'the id-translation seam is deleted');
    assert.doesNotMatch(host, /providerOverrides/, 'the per-request override surface is deleted');
    const researcher = await readSrc('../electron/engine/researcherAgent.ts');
    assert.doesNotMatch(researcher, /providerOverrides/, 'researchers carry Pi ids, never overrides');
    const bootstrap = await readSrc('../electron/engine/agenticSessionBootstrap.ts');
    assert.doesNotMatch(bootstrap, /apiKey/, 'the bootstrap carries no key');
  });
});

describe('Embeddings on Pi truth (P3 - Pi-only backend)', () => {
  it('embedding envelopes carry no keys — the factory resolves Pi-stored auth', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.doesNotMatch(app, /embedding_api_key/, 'research start carries no embedding key');
    const server = await readSrc('../electron/engine/server.ts');
    assert.doesNotMatch(server, /body\.api_key/, 'the embedding test route reads no body key');
    assert.doesNotMatch(server, /api_key=.*keyParam|searchParams\.get\('api_key'\)/, 'the embedding listing reads no query key');
    const agent = await readSrc('../electron/engine/agent.ts');
    assert.doesNotMatch(agent, /embeddingApiKey/, 'the legacy loop holds no embedding key variable');
    const wide = await readSrc('../electron/engine/wideAgent.ts');
    assert.doesNotMatch(wide, /request\.embedding_api_key/, 'wide synthesis holds no embedding key');
    const embeddings = await readSrc('../electron/engine/embeddings.ts');
    assert.match(embeddings, /resolveEmbeddingApiKey/, 'credentials resolve from Pi truth');
    assert.doesNotMatch(embeddings, /apiKey\?: string;\n\s*endpoint\?: string;\n\s*timeoutMs/, 'the factory config holds no key slot');
  });

  it('Settings holds no embedding plaintext and speaks the Pi provider id', async () => {
    const modal = await readSrc('../src/components/SettingsModal.tsx');
    assert.doesNotMatch(modal, /use_chat_key/, 'the key-sharing toggle is deleted');
    assert.doesNotMatch(modal, /activeEmbeddingApiKey/, 'the key-gated listing is deleted');
    assert.doesNotMatch(modal, /api_key: activeEmbeddingApiKey/, 'the test body carries no key');
    assert.match(modal, /\/api\/models\/test-embedding/, 'the test still proves the Pi-stored credential');
    const types = await readSrc('../src/types/index.ts');
    assert.doesNotMatch(types, /api_key\?: string;\n\s*use_chat_key/, 'no embedding key slots survive in settings');
    assert.match(types, /provider: EmbeddingProvider/, 'the embedding settings keep provider/model/endpoint only');
  });

  it('the engine vocabulary is one: Pi ids for chat and embeddings', async () => {
    const engineTypes = await readSrc('../electron/engine/types.ts');
    assert.doesNotMatch(engineTypes, /embedding_api_key/, 'the request type holds no embedding key');
    const embeddings = await readSrc('../electron/engine/embeddings.ts');
    assert.match(embeddings, /canonicalEmbeddingProvider/, 'one boundary tolerates legacy stored ids');
    assert.doesNotMatch(embeddings, /provider === 'gemini' \? 'text-embedding/, 'no caller re-derives defaults with its own mapping');
  });
});

describe('Ollama persists as a Pi overlay (P4 - Pi-only backend)', () => {
  it('requests carry Pi ids only — no endpoints on the wire', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.doesNotMatch(app, /ollama_endpoint: settings/, 'research/agent starts carry no endpoint');
    assert.doesNotMatch(app, /embedding_endpoint/, 'the embedding endpoint field is gone from requests');
    const server = await readSrc('../electron/engine/server.ts');
    assert.doesNotMatch(server, /body\?\.ollama_endpoint/, 'the engine reads no request endpoint');
    assert.doesNotMatch(server, /request\.ollama_endpoint/, 'no endpoint threads through the agentic start');
    assert.match(server, /\/api\/pi\/ollama/, 'the endpoint persists through the Pi overlay route');
    const host = await readSrc('../electron/engine/agentSessionHost.ts');
    assert.doesNotMatch(host, /ollamaEndpoint/, 'construction takes no endpoint');
    const researcher = await readSrc('../electron/engine/researcherAgent.ts');
    assert.doesNotMatch(researcher, /ollama_endpoint|ollamaEndpoint/, 'researchers carry Pi ids, never endpoints');
    const bootstrap = await readSrc('../electron/engine/agenticSessionBootstrap.ts');
    assert.doesNotMatch(bootstrap, /ollamaEndpoint/, 'the bootstrap carries no endpoint');
    const engineTypes = await readSrc('../electron/engine/types.ts');
    assert.doesNotMatch(engineTypes, /ollama_endpoint|embedding_endpoint/, 'the request types hold no endpoints');
  });

  it('the overlay is Pi-native storage, read everywhere the endpoint is needed', async () => {
    const overlay = await readSrc('../electron/engine/piOllama.ts');
    assert.match(overlay, /models\.json/, 'the overlay lives in Pi models.json');
    assert.match(overlay, /openai-completions/, 'the entry uses Pi native provider shape');
    const host = await readSrc('../electron/engine/agentSessionHost.ts');
    assert.match(host, /modelsPath/, 'runtimes load the overlay file');
    const embeddings = await readSrc('../electron/engine/embeddings.ts');
    assert.match(embeddings, /resolveOllamaEndpoint/, 'embeddings resolve the persisted endpoint');
    assert.doesNotMatch(embeddings, /model: config\.model \|\| 'nomic-embed-text',\n\s*endpoint: config\.endpoint/, 'the factory holds no endpoint slot');
    const adapter = await readSrc('../electron/engine/piAdapter.ts');
    assert.match(adapter, /resolveOllamaBaseUrl/, 'synthesis transports resolve the persisted endpoint');
  });

  it('the retired sync guard fails loudly instead of silently', async () => {
    const search = await readSrc('../electron/engine/agenticSearch.ts');
    assert.match(search, /retired \(tracer P4\)/, 'the request-key guard is retired, documented');
  });

  it('Settings saves the endpoint once and renders file truth', async () => {
    const modal = await readSrc('../src/components/SettingsModal.tsx');
    assert.match(modal, /\/api\/pi\/ollama/, 'Save persists and refresh reads the overlay route');
    assert.match(modal, /piOllama/, 'the Local tab renders persisted overlay status');
    assert.doesNotMatch(modal, /endpoint: current/, 'no endpoint travels test or list calls');
  });
});

describe('Settings renders the full Pi catalog (Track A - SPEC #155)', () => {
  it('no provider allowlist survives in the renderer', async () => {
    const modal = await readSrc('../src/components/SettingsModal.tsx');
    assert.doesNotMatch(modal, /SUPPORTED_PI_IDS/, 'the 8-id allowlist is deleted');
    assert.match(modal, /piProviders\.map\(/, 'pills iterate the Pi catalog state, not a list');
    const types = await readSrc('../src/types/index.ts');
    assert.match(types, /export type LLMProvider = string/, 'the chat provider id space is open Pi truth');
    assert.doesNotMatch(types, /search_provider: 'duckduckgo' \| 'tavily' \| 'serper'/, 'the search provider id space is open');
  });

  it('the footer reports the app version, never a hardcoded one', async () => {
    const modal = await readSrc('../src/components/SettingsModal.tsx');
    assert.doesNotMatch(modal, /v1\.0\.0/, 'the stale hardcoded footer version is gone');
    assert.match(modal, /package\.json/, 'the footer reads the app version from the package');
  });

  it('the Search tab renders engine truth, not three hardcoded cards', async () => {
    const modal = await readSrc('../src/components/SettingsModal.tsx');
    assert.match(modal, /\/api\/pi\/search-providers/, 'the tab loads the engine search catalog');
    assert.doesNotMatch(
      modal,
      /id: 'duckduckgo', name: 'DuckDuckGo'/,
      'the hardcoded DuckDuckGo/Tavily/Serper triple is gone'
    );
    const server = await readSrc('../electron/engine/server.ts');
    assert.match(server, /\/api\/pi\/search-providers/, 'the engine serves the search catalog route');
  });

  it('quick-switch shortcuts cover the known Pi ids over the open id space', async () => {
    const palette = await readSrc('../src/components/CommandPalette.tsx');
    assert.match(palette, /'mistral'/, 'the palette no longer drops mistral');
    assert.match(palette, /'serper'/, 'the palette no longer drops serper');
  });
});

describe('Deep Research keeps its plan-first path', () => {
  it('the plan-approval overlay survives and the deep-research route is intact', async () => {
    const app = await readSrc('../src/App.tsx');
    assert.match(app, /PlanApprovalModal/, 'the approval overlay is still mounted');
    assert.match(app, /handleApprovePlan|handleRegeneratePlan|handleDiscardPlan/, 'the plan actions are intact');
    assert.match(app, /research_mode|approvedPlan|\/api\/research\/start/, 'the Deep Research request path is intact');
  });

  it('the workspace keeps an explicit deep-research entry — agentic default, never agentic monopoly', async () => {
    const workspace = await readSrc('../src/components/harness/LensHarnessWorkspace.tsx');
    assert.match(workspace, /deep-research|Deep Research|البحث المعمّق/, 'Deep Research stays visible in the workspace');
  });
});
