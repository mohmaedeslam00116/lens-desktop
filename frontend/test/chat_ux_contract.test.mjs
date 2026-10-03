import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const codeOnly = (source) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

describe('Conversation shell — ChatGPT-style composition', () => {
  it('App opens into the conversation via LensHarnessWorkspace (engine contracts intact)', async () => {
    const app = await read('../src/App.tsx');
    assert.match(app, /<LensHarnessWorkspace/, 'home renders the harness workspace');
    assert.match(app, /<SettingsModal/, 'settings overlay stays available');
    assert.match(app, /<CommandPalette/, 'command palette stays available');
    assert.match(app, /<PlanApprovalModal/, 'plan approval overlay stays available');
    assert.match(app, /\/api\/agent\/start/, 'agentic start contract unchanged');
    assert.match(app, /\/api\/research\/start/, 'deep research start contract unchanged');
  });

  it('New Research creates a clean conversation (turns cleared, session reset)', async () => {
    const app = await read('../src/App.tsx');
    assert.match(app, /setPastTurns\(\[\]\)/, 'new research clears the conversation turns');
    assert.match(app, /setCurrentTurnId\(null\)/, 'new research clears the current turn');
    const shell = await read('../src/components/chat/ChatShell.tsx');
    assert.match(shell, /onNewResearch/, 'sidebar exposes New Research');
  });

  it('Sidebar contains actual history with active highlighting and collapse', async () => {
    const sidebar = await read('../src/components/chat/ChatSidebar.tsx');
    assert.match(sidebar, /history\.map|filtered\.map|today\.map/, 'rows render from real history state');
    assert.match(sidebar, /aria-current/, 'active conversation is identifiable');
    assert.match(sidebar, /is-collapsed/, 'sidebar can collapse');
    assert.match(sidebar, /chat-history-filter/, 'local history search filters existing sessions');
    assert.doesNotMatch(codeOnly(sidebar), /fetch\(.*\/api\/history/, 'no backend history search introduced');
    const css = await read('../src/index.css');
    assert.match(css, /\.chat-sidebar/, 'sidebar has dedicated styles');
    assert.match(css, /@media \(max-width: 900px\)/, 'mobile sidebar becomes a drawer');
  });

  it('Top bar is quiet: title plus model/language/theme, research as subtle state', async () => {
    const header = await read('../src/components/chat/ChatHeader.tsx');
    assert.match(header, /LENS/, 'wordmark present');
    assert.match(header, /conversationTitle/, 'current conversation named');
    assert.match(header, /Researching/, 'research appears as a subtle indicator');
    assert.doesNotMatch(codeOnly(header), /elapsed|toolCount|sourceCount|search_provider.*count|diagnostics/, 'no telemetry dashboards in the top bar');
  });

  it('Conversation width is chat measure, report keeps document measure', async () => {
    const css = await read('../src/index.css');
    assert.match(css, /\.chat-thread\s*\{[^}]*max-width|min\(100%, 860px\)|860px/, 'conversation uses a narrow chat measure');
  });
});

describe('Composer — one shared ResearchComposer', () => {
  it('a single composer serves new and active conversations', async () => {
    const composer = await read('../src/components/chat/ResearchComposer.tsx');
    assert.match(composer, /variant/, 'two states, one component');
    assert.match(composer, /chat-composer--/, 'variant styling without divergent treatments');
    const shell = await read('../src/components/chat/ChatShell.tsx');
    assert.match(shell, /ResearchComposer/, 'shell renders the shared composer');
    assert.match(shell, /chat-composer-dock/, 'composer stays docked near the bottom');
  });

  it('Enter sends, Shift+Enter inserts newline', async () => {
    const composer = await read('../src/components/chat/ResearchComposer.tsx');
    assert.match(composer, /e\.key === 'Enter' && !e\.shiftKey/, 'Enter sends');
    assert.match(composer, /isComposing/, 'IME composition respected');
  });

  it('Agentic Search is the default, Deep Research selectable in-composer, model stays reachable', async () => {
    const composer = await read('../src/components/chat/ResearchComposer.tsx');
    assert.match(composer, /Agentic Search/, 'agentic default named');
    assert.match(composer, /Deep Research/, 'deep research selectable inside composer');
    assert.match(composer, /chat-mode-list|chat-mode-trigger/, 'selection lives in the composer toolbar');
    assert.match(composer, /Choose model|modelLabel/, 'model selection remains accessible');
    assert.match(codeOnly(composer), /researchMode|optimizationMode|sourceFocus/, 'deep tuning disclosed progressively');
  });

  it('loading state is truthful and live runs support steering', async () => {
    const composer = await read('../src/components/chat/ResearchComposer.tsx');
    assert.match(composer, /disabled=\{!value\.trim\(\) \|\| busy\}/, 'send gated on content and truthful busyness');
    assert.match(composer, /runLive/, 'steering state reaches the composer');
    assert.match(composer, /steers it|Steer the running/, 'steering communicated honestly');
  });
});

describe('Conversation — turns, continuity, history', () => {
  it('user and assistant messages render as timeline turns', async () => {
    const turn = await read('../src/components/chat/ConversationTurn.tsx');
    assert.match(turn, /UserMessage/, 'user turn rendered');
    assert.match(turn, /AssistantMessage/, 'assistant turn rendered');
    const thread = await read('../src/components/chat/ConversationThread.tsx');
    assert.match(thread, /turns\.map/, 'multiple turns stay vertically ordered');
    assert.match(thread, /role="log"/, 'stream exposed as a log for assistive tech');
  });

  it('user message is a bubble with copy, RTL-safe, timestamp-gated', async () => {
    const user = await read('../src/components/chat/UserMessage.tsx');
    assert.match(user, /chat-user-bubble/, 'bubble treatment, not a page heading');
    assert.match(user, /dir="auto"/, 'RTL/LTR follows content');
    assert.match(user, /Copy question/, 'copy affordance');
    assert.doesNotMatch(codeOnly(user), /<h1/, 'never a large heading');
  });

  it('assistant answer is the primary object with citations, sources, actions, follow-ups', async () => {
    const assistant = await read('../src/components/chat/AssistantMessage.tsx');
    assert.match(assistant, /LazyReportCanvas|React\.lazy/, 'answer body rides the deferred canvas, never a static renderer');
    assert.match(assistant, /CitationList/, 'inline citations part of the answer');
    assert.match(assistant, /InlineSources/, 'sources under the answer');
    assert.match(assistant, /AssistantActions/, 'copy/export/artifact actions');
    assert.match(assistant, /FollowUpSuggestions/, 'continuation under the answer');
    assert.doesNotMatch(codeOnly(assistant), /PerplexityRadar|Reasoning Graph|Source Shelf.*Workspace/, 'no dashboard mode switcher');
  });

  it('follow-ups stay in the same conversation (turns accumulate, never replace)', async () => {
    const app = await read('../src/App.tsx');
    assert.match(app, /snapshotFinishedTurn/, 'finished turns persist before the next run');
    assert.match(app, /pastTurns/, 'past turns accumulate in the thread');
    assert.match(app, /chatTurns/, 'thread renders past plus current');
  });

  it('history restores the conversation, defaulting to it', async () => {
    const app = await read('../src/App.tsx');
    assert.match(app, /handleSelectReport/, 'history selection restores conversation state');
    assert.match(app, /setPastTurns\(\[\]\)/, 'restore defaults to the conversation turn');
  });

  it('live and historical sessions share one component', async () => {
    const thread = await read('../src/components/chat/ConversationThread.tsx');
    assert.match(thread, /live/, 'live state flows into the same thread');
    const assistant = await read('../src/components/chat/AssistantMessage.tsx');
    assert.match(assistant, /turn\.live/, 'live flag selects the progressive path');
  });
});

describe('Research — honest activity inside the assistant turn', () => {
  it('live activity appears inside the turn and collapses after completion', async () => {
    const activity = await read('../src/components/chat/ResearchActivity.tsx');
    assert.match(activity, /setOpen\(running\)/, 'auto-expands while running');
    assert.match(activity, /Research activity/, 'collapses to a summary line');
    assert.match(activity, /searches ·.*sources|بحث ·/, 'summary carries real counts');
    const assistant = await read('../src/components/chat/AssistantMessage.tsx');
    assert.match(assistant, /ResearchActivity/, 'activity lives inside the assistant turn');
  });

  it('no fabricated activity: every line maps to real engine events', async () => {
    const activity = await read('../src/components/chat/ResearchActivity.tsx');
    assert.match(activity, /toolChips|thoughts|subqueries|agents|currentStatus/, 'only real event sources rendered');
    assert.doesNotMatch(activity, /Thinking\.\.\.|Analyzing\.\.\.|Reviewing\.\.\./, 'no invented progress copy');
  });

  it('tool calls translate to human language with technical detail second', async () => {
    const activity = await read('../src/components/chat/ResearchActivity.tsx');
    assert.match(activity, /Searching the web|Reading source/, 'human explanation first');
    assert.match(activity, /humanizeTool/, 'raw args stay behind the human line');
  });

  it('Deep Research plan appears in the conversation with review before start', async () => {
    const turn = await read('../src/components/chat/ConversationTurn.tsx');
    assert.match(turn, /chat-plan-card/, 'plan renders as an inline artifact');
    assert.match(turn, /onReviewPlan/, 'review opens the preserved approval overlay');
    const app = await read('../src/App.tsx');
    assert.match(app, /<PlanApprovalModal/, 'approval business behavior preserved');
  });
});

describe('Evidence — citations and sources in place', () => {
  it('inline citations open the preserved EvidenceInspectionDrawer', async () => {
    const shell = await read('../src/components/chat/ChatShell.tsx');
    assert.match(shell, /EvidenceInspectionDrawer/, 'drawer preserved and mounted');
    assert.match(shell, /targetCitationIndex/, 'citation index drives inspection');
    const citations = await read('../src/components/chat/CitationList.tsx');
    assert.match(citations, /onInspectCitation/, 'citation click inspects in place');
  });

  it('view-all opens the complete shelf without losing position', async () => {
    const inline = await read('../src/components/chat/InlineSources.tsx');
    assert.match(inline, /View all/, 'complete shelf reachable from the answer');
    const drawer = await read('../src/components/chat/ArtifactDrawer.tsx');
    assert.match(drawer, /FacetGroupedShelf/, 'full shelf renders in the contextual drawer');
    assert.match(drawer, /Escape/, 'drawer closes without navigation loss');
  });

  it('URLs stay LTR inside RTL conversations', async () => {
    const inline = await read('../src/components/chat/InlineSources.tsx');
    assert.match(inline, /dir="ltr"/, 'domains/URLs pinned LTR');
    const composer = await read('../src/components/chat/ResearchComposer.tsx');
    assert.match(composer, /dir="ltr"|bdi/, 'model ids stay LTR');
  });
});

describe('Artifacts — contextual, never permanent', () => {
  it('drawer is closed by default and opens only on request', async () => {
    const shell = await read('../src/components/chat/ChatShell.tsx');
    assert.match(shell, /useState<ChatArtifact \| null>\(null\)/, 'closed by default');
    assert.match(shell, /openArtifact/, 'opens only through explicit artifact actions');
    const drawer = await read('../src/components/chat/ArtifactDrawer.tsx');
    assert.match(drawer, /if \(!artifact \|\| !turn\) return null/, 'no empty drawer steals width');
  });

  it('graph, plan and report remain accessible as artifacts', async () => {
    const actions = await read('../src/components/chat/AssistantActions.tsx');
    assert.match(actions, /View report/, 'report launcher');
    assert.match(actions, /Sources/, 'sources launcher');
    assert.match(actions, /Plan/, 'plan launcher');
    assert.match(actions, /Graph/, 'graph launcher');
    assert.match(actions, /hasReport|hasPlan|hasGraph/, 'launchers render only when the artifact exists');
  });

  it('conversation shell stays cheap: heavy views load lazily', async () => {
    const shell = await read('../src/components/chat/ChatShell.tsx');
    assert.doesNotMatch(codeOnly(shell), /from '\.\.\/vane\/ReportRenderer'|from 'react-markdown'/, 'no static heavy imports in the shell');
    assert.doesNotMatch(codeOnly(shell), /chat-harness-compat|<span hidden/, 'no hidden mounted trees in the shell');
    const drawer = await read('../src/components/chat/ArtifactDrawer.tsx');
    assert.match(drawer, /React\.lazy/, 'graph/report chunks load on demand');
    const assistant = await read('../src/components/chat/AssistantMessage.tsx');
    assert.match(assistant, /React\.lazy/, 'the answer canvas loads lazily too, not just the drawer copy');
    assert.doesNotMatch(codeOnly(assistant), /from '\.\.\/vane\/ReportCanvas'/, 'no static canvas import in the thread');
  });

  it('stop works for every live run: agentic and Deep Research cancel through their own routes', async () => {
    const app = await read('../src/App.tsx');
    assert.match(app, /\/api\/agent\/cancel/, 'agentic stop posts to its route');
    assert.match(app, /\/api\/research\/cancel/, 'deep stop posts to its own route');
    assert.match(app, /handleCancelRun/, 'one unified stop fans out by live run kind');
    const activity = await read('../src/components/chat/ResearchActivity.tsx');
    assert.match(activity, /<button[^>]*className="chat-activity-stop"/, 'stop is a real sibling button, never nested inside the toggle');
    assert.doesNotMatch(codeOnly(activity), /role="button"/, 'no fake button roles');
  });

  it('titles are concise derivations of real queries, never full dumps', async () => {
    const app = await read('../src/App.tsx');
    assert.match(app, /deriveConversationTitle\(trimmed\)/, 'saved reports title through the concise helper');
    const sidebar = await read('../src/components/chat/ChatSidebar.tsx');
    assert.match(sidebar, /deriveConversationTitle/, 'rows render the concise derivation');
    const helper = await read('../src/utils/conversationTitle.ts');
    assert.match(helper, /maxLength/, 'titles truncate at a bounded length');
  });

  it('mode menu dismisses with Escape and outside click', async () => {
    const composer = await read('../src/components/chat/ResearchComposer.tsx');
    assert.match(composer, /Escape/, 'escape closes the mode menu');
    assert.match(composer, /pointerdown/, 'outside click closes the mode menu');
  });
});

describe('Accessibility and motion', () => {
  it('keyboard, focus, escape and labels hold', async () => {
    const drawer = await read('../src/components/chat/ArtifactDrawer.tsx');
    assert.match(drawer, /Escape/, 'escape closes drawers');
    assert.match(drawer, /role="dialog"/, 'dialog semantics');
    const thread = await read('../src/components/chat/ConversationThread.tsx');
    assert.match(thread, /aria-label/, 'meaningful labels for screen readers');
    const css = await read('../src/index.css');
    assert.match(css, /:focus-visible/, 'focus stays visible');
  });

  it('RTL mirrors logically and reduced motion is respected', async () => {
    const shell = await read('../src/components/chat/ChatShell.tsx');
    assert.match(shell, /dir=\{ar \? 'rtl' : 'ltr'\}/, 'direction follows language');
    const css = await read('../src/index.css');
    assert.match(css, /prefers-reduced-motion/, 'reduced motion respected');
  });
});

describe('Chat module layout', () => {
  it('ships the conversation-native components with research artifacts separate', async () => {
    const files = await readdir(new URL('../src/components/chat', import.meta.url));
    for (const expected of [
      'ChatShell.tsx', 'ChatSidebar.tsx', 'ChatHeader.tsx', 'ConversationThread.tsx',
      'ConversationTurn.tsx', 'UserMessage.tsx', 'AssistantMessage.tsx', 'ResearchActivity.tsx',
      'InlineSources.tsx', 'CitationList.tsx', 'AssistantActions.tsx', 'FollowUpSuggestions.tsx',
      'ResearchComposer.tsx',
    ]) {
      assert.ok(files.includes(expected), `chat/${expected} exists`);
    }
  });
});
