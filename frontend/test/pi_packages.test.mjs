import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import pkg from '../dist-electron/engine/piResearchTools.js';
const { buildResearchPackageTools, resetPackageToolCache, wrapPackageToolHandler } = pkg;

describe('pi packages bridge: vendored packages load in-process (issue packages integration)', () => {
  it('loads the five package tools through jiti from the vendored copy', async () => {
    resetPackageToolCache();
    const { tools } = await buildResearchPackageTools({ sessionId: 'test-session' });
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'fetch_content',
      'get_search_content',
      'source_check',
      'todo',
      'web_search',
    ]);
    for (const tool of tools) {
      assert.equal(typeof tool.description, 'string');
      assert.ok(tool.description.length > 10, `${tool.name} carries a description`);
      assert.equal(typeof tool.parameters, 'object');
      assert.notEqual(tool.parameters, null);
    }
  });

  it('todo tool end-to-end: create -> in_progress -> completed with the snapshot envelope', async () => {
    resetPackageToolCache();
    const { tools, handler } = await buildResearchPackageTools({ sessionId: 'todo-e2e' });
    const todo = tools.find((t) => t.name === 'todo');
    assert.ok(todo, 'todo tool registered');

    const created = await handler({ name: 'todo', arguments: { action: 'create', subject: 'Research vendored packages' } });
    assert.equal(created.success, true);
    const createdDetails = created.result?.details ?? created.result;
    assert.ok(created.result, 'create returns the envelope text');

    const listed = await handler({ name: 'todo', arguments: { action: 'list' } });
    assert.equal(listed.success, true);
    assert.ok(String(listed.result).includes('Research vendored packages'), 'list shows the created task');

    const progressed = await handler({ name: 'todo', arguments: { action: 'update', id: 1, status: 'in_progress', activeForm: 'testing the bridge' } });
    assert.equal(progressed.success, true);
    assert.ok(String(progressed.result).includes('in_progress'), 'update reports the transition');

    const completed = await handler({ name: 'todo', arguments: { action: 'update', id: 1, status: 'completed' } });
    assert.equal(completed.success, true);

    const after = await handler({ name: 'todo', arguments: { action: 'get', id: 1 } });
    assert.equal(after.success, true);
    assert.ok(String(after.result).includes('completed'), 'get shows the completed status');
  });

  it('handler rejects unknown tools and keeps activate_skill dispatch upstream', async () => {
    resetPackageToolCache();
    const { handler } = await buildResearchPackageTools({ sessionId: 'reject-session' });
    const unknown = await handler({ name: 'not_a_package_tool', arguments: {} });
    assert.equal(unknown.success, false);
    assert.ok(String(unknown.error).includes('Unsupported tool'));

    // activate_skill is NOT a package tool: the extra handler chain owns it.
    const routedUpstream = await wrapPackageToolHandler(
      [],
      async (call) => (call.name === 'activate_skill' ? { success: true, result: 'skill-up' } : { success: false })
    );
    const upstream = await routedUpstream({ name: 'activate_skill', arguments: { name: 'x' } });
    assert.equal(upstream.success, true);
    assert.equal(upstream.result, 'skill-up');
  });
});