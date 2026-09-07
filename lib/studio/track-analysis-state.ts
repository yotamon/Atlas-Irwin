const ACTIVE_ANALYSIS_STATUSES = new Set(["pending", "queued", "dispatched", "running"]);
const COMPLETE_ANALYSIS_STATUSES = new Set(["completed", "ready", "analyzed"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

export function hasMusicIntelligenceMap(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

export function isTrackAnalysisActive(status: string) {
  return ACTIVE_ANALYSIS_STATUSES.has(status);
}

export function trackAnalysisFailureCopy(message: string) {
  if (/quota|billing|payment|free quota|hobby/i.test(message)) {
    return "The free Vercel Sandbox quota is unavailable right now. Your master and existing intelligence are safe, and Ensemblis will not use a paid fallback. Retry after the free quota resets.";
  }
  if (/already processing|worker is busy/i.test(message)) {
    return "The free Media Worker is already processing another job. Your master and existing intelligence are safe. Retry after the current analysis finishes.";
  }
  return "The full analysis did not finish. Your master is safe, and any verified intelligence already produced remains available. Retry only the intelligence pass below.";
}

export function describeTrackAnalysis(analysisValue: unknown, musicMapValue: unknown) {
  const analysis = record(analysisValue);
  const status = typeof analysis.status === "string" ? analysis.status : "not_analyzed";
  const message = typeof analysis.message === "string" ? analysis.message : "";
  const attempt = positiveInteger(analysis.attempt);
  const hasMusicMap = hasMusicIntelligenceMap(musicMapValue);
  const isActive = isTrackAnalysisActive(status);
  const isComplete = COMPLETE_ANALYSIS_STATUSES.has(status);
  const needsRecovery = status === "failed" || status === "unavailable";
  const isPartial = hasMusicMap && needsRecovery;
  const isRefreshing = hasMusicMap && isActive;

  let label = "Master attached";
  if (isRefreshing) label = "Refreshing intelligence";
  else if (isPartial) label = "Partial intelligence";
  else if (hasMusicMap && isComplete) label = "Intelligence ready";
  else if (hasMusicMap) label = "Intelligence available";
  else if (status === "pending" || status === "queued") label = "Analysis queued";
  else if (status === "dispatched" || status === "running") label = "Analyzing";
  else if (status === "failed") label = "Needs attention";
  else if (status === "unavailable") label = "Worker unavailable";

  let actionLabel = "Run full analysis";
  if (needsRecovery) actionLabel = "Retry full analysis";
  else if (hasMusicMap) actionLabel = "Refresh full analysis";

  return {
    status,
    message,
    attempt,
    hasMusicMap,
    isActive,
    isComplete,
    needsRecovery,
    isPartial,
    isRefreshing,
    label,
    actionLabel,
    failureCopy: needsRecovery ? trackAnalysisFailureCopy(message) : "",
  };
}
