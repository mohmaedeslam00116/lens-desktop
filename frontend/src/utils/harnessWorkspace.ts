import type { ResearchGraphNode, ResearchPlan, SourceItem } from '../types';
import type { AgentFeedState } from './liveFeed';

export type HarnessArtifactTab = 'plan' | 'evidence' | 'report' | 'graph';

export interface HarnessArtifactInput {
  plan?: ResearchPlan | null;
  sources: SourceItem[];
  report: string;
  graphNodes: ResearchGraphNode[];
}

export interface HarnessSessionInput {
  loading: boolean;
  status: string;
  error: string;
}

export interface HarnessSessionCard {
  detail: string;
  status: AgentFeedState['status'];
}

/** Returns only inspector sections that have real renderer data. */
export function availableHarnessArtifacts({
  plan,
  sources,
  report,
  graphNodes,
}: HarnessArtifactInput): HarnessArtifactTab[] {
  return [
    ...(plan ? ['plan' as const] : []),
    ...(sources.length > 0 ? ['evidence' as const] : []),
    ...(report.trim() ? ['report' as const] : []),
    ...(graphNodes.length > 0 ? ['graph' as const] : []),
  ];
}

export function defaultHarnessArtifact(input: HarnessArtifactInput): HarnessArtifactTab | null {
  return availableHarnessArtifacts(input)[0] ?? null;
}

/** Maps already-visible transport/session information into one honest parent card. */
export function deriveHarnessSessionCard({ loading, status, error }: HarnessSessionInput): HarnessSessionCard | null {
  if (!loading && !status && !error) return null;

  const isRetrying = /reconnect|إعادة الاتصال/i.test(status);
  return {
    detail: error || status,
    status: error ? 'failed' : isRetrying ? 'retrying' : loading ? 'running' : 'waiting',
  };
}
