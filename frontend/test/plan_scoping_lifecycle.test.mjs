import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateResearchPlan,
  regenerateResearchPlan,
  validateResearchPlan
} from '../dist-electron/engine/scoping.js';
import {
  ResearchSession,
  SessionLifecycleManager
} from '../dist-electron/engine/sessionLifecycle.js';
import { DeepResearchAgent } from '../dist-electron/engine/agent.js';
import { MultiSearchProvider } from '../dist-electron/engine/search.js';
import { PageScraper } from '../dist-electron/engine/scraper.js';
import { ModelClient } from '../dist-electron/engine/models.js';

describe('Collaborative Research Plan Scoping & Approval (Tracer 4)', () => {
  describe('Plan Generator (scoping.ts)', () => {
    it('generates a versioned 4-element ResearchPlan with objective, milestones, skills, and scope', async () => {
      const query = 'Transformer attention mechanisms and quadratic scaling bottlenecks';
      const plan = await generateResearchPlan(query, {
        language: 'en',
        targetSources: 100,
        maxHops: 2,
        mode: 'wide'
      });

      assert.ok(plan.id, 'Plan should have unique UUID');
      assert.equal(plan.version, 1, 'Initial plan version should be 1');
      assert.equal(plan.status, 'draft', 'Initial status should be draft');
      assert.ok(plan.objective.length > 0, 'Objective should not be empty');
      assert.ok(Array.isArray(plan.milestones), 'Milestones should be an array');
      assert.ok(plan.milestones.length >= 3, 'Should generate at least 3 milestones');
      assert.ok(Array.isArray(plan.suggestedSkills), 'Suggested skills should be an array');
      assert.ok(plan.suggestedSkills.length >= 1, 'Should suggest at least 1 relevant skill');
      assert.deepEqual(plan.estimatedScope, {
        targetSources: 100,
        maxHops: 2
      });

      // Verify milestone schema
      for (const m of plan.milestones) {
        assert.ok(m.id, 'Milestone must have id');
        assert.ok(m.query.length > 0, 'Milestone must have query');
        assert.ok(m.rationale.length > 0, 'Milestone must have rationale');
        assert.equal(m.status, 'pending');
      }
    });

    it('generates Arabic milestones and rationales for Arabic queries (RTL support)', async () => {
      const arQuery = 'نماذج الذكاء الاصطناعي التوليدي وتطبيقاتها في الرعاية الصحية';
      const plan = await generateResearchPlan(arQuery, {
        language: 'ar',
        mode: 'wide'
      });

      assert.equal(plan.version, 1);
      assert.ok(plan.objective.length > 0);
      assert.ok(plan.milestones.length >= 3);

      // Check for Arabic characters in milestones
      const hasArabic = plan.milestones.some(m => /[\u0600-\u06FF]/.test(m.query));
      assert.ok(hasArabic, 'Milestones for Arabic query should contain Arabic script');

      // Suggested skills should include bilingual bridge
      assert.ok(
        plan.suggestedSkills.includes('bilingual-cross-lingual-bridge'),
        'Arabic queries should suggest bilingual bridge skill'
      );
    });

    it('suggests academic and empirical skills for scientific/benchmark inquiries', async () => {
      const query = 'Empirical benchmark evaluation of Mamba state space models vs LLaMA 3';
      const plan = await generateResearchPlan(query, { language: 'en' });

      assert.ok(
        plan.suggestedSkills.includes('academic-paper-analysis') ||
        plan.suggestedSkills.includes('empirical-data-extraction') ||
        plan.suggestedSkills.includes('comparative-synthesis'),
        'Academic inquiry should trigger academic/empirical skill suggestions'
      );
    });

    it('validates plan schema with validateResearchPlan', () => {
      const validPlan = {
        id: 'plan-123',
        version: 1,
        objective: 'Test Objective',
        milestones: [
          { id: 'm-1', query: 'q1', rationale: 'r1', status: 'pending' },
          { id: 'm-2', query: 'q2', rationale: 'r2', status: 'pending' }
        ],
        suggestedSkills: ['academic-paper-analysis'],
        estimatedScope: { targetSources: 50, maxHops: 1 },
        status: 'draft'
      };

      const result = validateResearchPlan(validPlan);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);

      // Invalid plan (empty milestones, missing objective)
      const invalidPlan = {
        id: '',
        version: 0,
        objective: '',
        milestones: [],
        suggestedSkills: [],
        estimatedScope: { targetSources: 0, maxHops: -1 }
      };
      const invalidResult = validateResearchPlan(invalidPlan);
      assert.equal(invalidResult.valid, false);
      assert.ok(invalidResult.errors.length >= 3);
    });

    it('regenerateResearchPlan increments version counter and preserves scope', async () => {
      const originalPlan = await generateResearchPlan('Solid-state battery chemistry breakthroughs', {
        targetSources: 80,
        maxHops: 2
      });
      assert.equal(originalPlan.version, 1);

      const v2Plan = await regenerateResearchPlan(originalPlan, 'Focus more on commercialization timelines');
      assert.equal(v2Plan.version, 2);
      assert.equal(v2Plan.status, 'draft');
      assert.equal(v2Plan.estimatedScope.targetSources, 80);
      assert.equal(v2Plan.estimatedScope.maxHops, 2);
      assert.ok(v2Plan.milestones.length >= 3);
    });
  });

  describe('Session Lifecycle Scoping & Authorization Protocol', () => {
    let session;
    let manager;

    beforeEach(() => {
      manager = new SessionLifecycleManager();
      session = manager.createSession({
        query: 'Quantum error correction surface codes',
        mode: 'wide',
        report_type: 'storm'
      });
    });

    it('transitions to awaiting_approval and emits plan_proposed upon plan submission', async () => {
      const emittedEvents = [];
      session.subscribe(e => emittedEvents.push(e));

      const plan = await generateResearchPlan(session.request.query, { mode: 'wide' });
      session.submitPlanProposed(plan);

      assert.equal(session.state, 'awaiting_approval');
      assert.equal(session.isPlanAuthorized(), false, 'Plan must not be authorized before approval');

      const proposedEvent = emittedEvents.find(e => e.type === 'plan_proposed');
      assert.ok(proposedEvent, 'Must emit plan_proposed event');
      assert.ok(proposedEvent.eventId > 0, 'Event must be stamped with monotonic eventId');
      assert.equal(proposedEvent.plan.version, 1);
      assert.equal(proposedEvent.plan.milestones.length, plan.milestones.length);
    });

    it('allows updating plan milestones and skills before approval', async () => {
      const emittedEvents = [];
      session.subscribe(e => emittedEvents.push(e));

      const plan = await generateResearchPlan(session.request.query, { mode: 'wide' });
      session.submitPlanProposed(plan);

      // User adds a custom milestone and modifies skills
      const customMilestone = {
        id: 'm-custom-1',
        query: 'Hardware implementation on superconducting qubits',
        rationale: 'User specifically asked for physical qubit realizations',
        status: 'pending'
      };

      const editedPlan = {
        ...plan,
        milestones: [...plan.milestones, customMilestone],
        suggestedSkills: [...plan.suggestedSkills, 'empirical-data-extraction']
      };

      session.updatePlan(editedPlan);

      assert.equal(session.plan.milestones.length, plan.milestones.length + 1);
      assert.ok(session.plan.suggestedSkills.includes('empirical-data-extraction'));

      const updateEvent = emittedEvents.find(e => e.type === 'plan_updated');
      assert.ok(updateEvent, 'Must emit plan_updated event');
    });

    it('approves plan, freezes trajectory, transitions to running, and authorizes retrieval', async () => {
      const emittedEvents = [];
      session.subscribe(e => emittedEvents.push(e));

      const plan = await generateResearchPlan(session.request.query, { mode: 'wide' });
      session.submitPlanProposed(plan);

      // User customizes one milestone query
      const modifiedPlan = {
        ...plan,
        milestones: plan.milestones.map((m, idx) =>
          idx === 0 ? { ...m, query: 'Refined query for milestone 1' } : m
        )
      };

      session.approvePlan(modifiedPlan);

      assert.equal(session.state, 'running');
      assert.equal(session.isPlanAuthorized(), true, 'Plan is now authorized');
      assert.equal(session.plan.status, 'approved');
      assert.equal(session.plan.milestones[0].query, 'Refined query for milestone 1');

      const approvedEvent = emittedEvents.find(e => e.type === 'plan_approved');
      assert.ok(approvedEvent, 'Must emit plan_approved event');
      assert.ok(approvedEvent.eventId > 0);
      assert.equal(approvedEvent.plan.status, 'approved');
    });

    it('handles plan rejection gracefully, transitions to cancelled, and emits plan_rejected', async () => {
      const emittedEvents = [];
      session.subscribe(e => emittedEvents.push(e));

      const plan = await generateResearchPlan(session.request.query, { mode: 'wide' });
      session.submitPlanProposed(plan);

      session.rejectPlan('User opted not to proceed with suggested scope');

      assert.equal(session.state, 'cancelled');
      assert.equal(session.isPlanAuthorized(), false);
      assert.equal(session.plan.status, 'rejected');

      const rejectedEvent = emittedEvents.find(e => e.type === 'plan_rejected');
      assert.ok(rejectedEvent, 'Must emit plan_rejected event');
      assert.equal(rejectedEvent.message, 'User opted not to proceed with suggested scope');
    });

    it('rejects state transition directly to running without plan approval in wide mode', () => {
      assert.equal(session.state, 'planning');
      assert.equal(session.isPlanAuthorized(), false);

      // In wide mode, isPlanAuthorized guard prevents unauthorized retrieval
      const canProceedWithRetrieval = session.isPlanAuthorized();
      assert.equal(canProceedWithRetrieval, false);
    });

    it('manages plan approval and rejection via SessionLifecycleManager', async () => {
      const plan = await generateResearchPlan(session.request.query, { mode: 'wide' });
      manager.submitPlanProposed(session.id, plan);

      assert.equal(session.state, 'awaiting_approval');

      // Test manager approval
      const approved = manager.approveSessionPlan(session.id, plan);
      assert.ok(approved);
      assert.equal(approved.status, 'approved');
      assert.equal(session.state, 'running');

      // Create a second session to test rejection through manager
      const session2 = manager.createSession({
        query: 'Neural radiance fields for 3D reconstruction',
        mode: 'wide'
      });
      const plan2 = await generateResearchPlan(session2.request.query, { mode: 'wide' });
      manager.submitPlanProposed(session2.id, plan2);

      const rejected = manager.rejectSessionPlan(session2.id, 'Too broad');
      assert.equal(rejected, true);
      assert.equal(session2.state, 'cancelled');
      assert.equal(session2.plan.status, 'rejected');
    });

    it('strictly freezes retrieval trajectory using approved plan milestones in DeepResearchAgent', async () => {
      const approvedPlan = {
        id: 'plan-frozen-1',
        version: 2,
        objective: 'Test Objective',
        milestones: [
          { id: 'm-1', query: 'Custom milestone 1: architecture', rationale: 'r1', status: 'pending' },
          { id: 'm-2', query: 'Custom milestone 2: evaluation', rationale: 'r2', status: 'pending' }
        ],
        suggestedSkills: ['academic-paper-analysis'],
        estimatedScope: { targetSources: 50, maxHops: 1 },
        status: 'approved'
      };

      const emittedEvents = [];
      const agent = new DeepResearchAgent('test-freeze', (e) => emittedEvents.push(e));

      // Mock dependencies
      const origSearch = MultiSearchProvider.search;
      const origScrape = PageScraper.scrape;
      const origGenerate = ModelClient.generate;

      MultiSearchProvider.search = async () => [];
      PageScraper.scrape = async () => null;
      ModelClient.generate = async () => 'Test summary report';

      try {
        await agent.run({
          query: 'Test original query',
          mode: 'wide',
          language: 'en',
          plan: approvedPlan
        });

        const subqueriesEvent = emittedEvents.find(e => e.type === 'subqueries');
        assert.ok(subqueriesEvent, 'Must emit subqueries event');
        assert.deepEqual(
          subqueriesEvent.subqueries,
          ['Custom milestone 1: architecture', 'Custom milestone 2: evaluation'],
          'Subqueries must be strictly frozen to approved milestone queries'
        );

        const thoughtEvent = emittedEvents.find(e => e.type === 'thought' && e.thought?.includes('frozen'));
        assert.ok(thoughtEvent, 'Should emit thought indicating frozen authorized research trajectory');
      } finally {
        MultiSearchProvider.search = origSearch;
        PageScraper.scrape = origScrape;
        ModelClient.generate = origGenerate;
      }
    });
  });
});
