# 1. Collaborative Research Plan Authorization Gatekeeper before Wide Retrieval

## Context
Wide research investigations scrape and analyze between 50 and 200+ heterogeneous sources across multiple adaptive hops. Unbounded autonomous query decomposition without human review risks query drift, high latency, and wasted compute on unwanted research subtopics.

## Decision
We enforce a mandatory collaborative scoping phase (`Phase 1`) for wide research sessions (`ResearchMode = 'wide'` or `report_type = 'storm'`). In this phase:
1. The engine generates a versioned 4-element `ResearchPlan` (`objective`, `milestones`, `suggestedSkills`, `estimatedScope`) and enters `awaiting_approval`.
2. Retrieval execution is strictly gated behind `session.isPlanAuthorized()`. The server and engine will not start web search or scraping passes until the user authorizes the plan via WebSocket `plan_approved`.
3. Upon approval, the approved milestones freeze the retrieval trajectory: `DeepResearchAgent` executes search directly across the approved milestone queries, preventing independent query drift.
4. Standard mode (`ResearchMode = 'standard'`) remains non-blocking for quick single-turn inquiries.

## Consequences
- Wide research requires explicit user interaction (`[Approve & Start]`) before network retrieval begins.
- Headless or programmatic wide research invocations must send an approval action or provide an already approved plan.
- The retrieval trajectory is deterministically bound to the user-vetted milestones.
