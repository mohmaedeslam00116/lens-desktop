export function resolveReportTelemetry(activeReport, fallbackTelemetry = null, fallbackExpansionHistory = []) {
  if (activeReport) {
    const wideTelemetry = activeReport.wideTelemetry || null;
    const wideExpansionHistory = activeReport.wideExpansionHistory
      || (activeReport.wideTelemetry?.expansion ? [activeReport.wideTelemetry] : []);
    return {
      wideTelemetry,
      wideExpansionHistory
    };
  }
  return {
    wideTelemetry: fallbackTelemetry || null,
    wideExpansionHistory: fallbackExpansionHistory || []
  };
}
