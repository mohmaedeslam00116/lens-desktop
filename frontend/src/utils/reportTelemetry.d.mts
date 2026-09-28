import type { ReportData, WideResearchTelemetry } from '../types';

export interface ResolvedReportTelemetry {
  wideTelemetry: WideResearchTelemetry | null;
  wideExpansionHistory: WideResearchTelemetry[];
}

/**
 * Prefers the selected report's own wide-research telemetry and only falls back
 * to live session telemetry while no report is selected. Expansion history
 * degrades to the single expansion carried by the report's telemetry.
 */
export declare function resolveReportTelemetry(
  activeReport?: ReportData | null,
  fallbackTelemetry?: WideResearchTelemetry | null,
  fallbackExpansionHistory?: WideResearchTelemetry[]
): ResolvedReportTelemetry;
