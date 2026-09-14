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

function followUpInputReason(followUp: Record<string, unknown>) {
  const lyrics = record(followUp.lyrics);
  const stems = record(followUp.stems);
  if (lyrics.reason === "official_lyrics_missing") return "official_lyrics_missing" as const;
  if (lyrics.reason === "ai_context_disabled") return "ai_context_disabled" as const;
  if (stems.reason === "stems_from_previous_master") return "stems_from_previous_master" as const;
  return null;
}

export function describeMusicIngestionProgress({
  hasMaster,
  analysisValue,
  musicMapValue,
  releaseBound,
}: {
  hasMaster: boolean;
  analysisValue: unknown;
  musicMapValue: unknown;
  releaseBound: boolean;
}) {
  const analysis = describeTrackAnalysis(analysisValue, musicMapValue);
  const rawAnalysis = record(analysisValue);
  const followUp = record(rawAnalysis.ingestion_follow_up);
  const followUpStatus = typeof followUp.status === "string" ? followUp.status : "";
  const inputReason = followUpInputReason(followUp);

  if (!hasMaster) {
    return {
      phase: "needs_master" as const,
      label: "Needs master",
      detail: "Attach the mastered source so Ensemblis can start understanding the song.",
      progress: 0,
      needsInput: true,
      inputReason: "master" as const,
    };
  }

  if (analysis.needsRecovery) {
    return {
      phase: "needs_attention" as const,
      label: analysis.label,
      detail: analysis.failureCopy,
      progress: analysis.hasMusicMap ? 70 : 35,
      needsInput: false,
      inputReason: null,
    };
  }

  if (analysis.isActive) {
    return {
      phase: "listening" as const,
      label: analysis.isRefreshing ? "Refreshing intelligence" : "Listening",
      detail: analysis.isRefreshing
        ? "Current verified intelligence stays usable while Ensemblis listens again."
        : "Ensemblis is mapping structure, strongest Moments and mastering signals automatically.",
      progress: analysis.hasMusicMap ? 75 : 45,
      needsInput: false,
      inputReason: null,
    };
  }

  if (!analysis.hasMusicMap) {
    return {
      phase: "preparing" as const,
      label: "Preparing intelligence",
      detail: "The master is attached. Ensemblis will queue Track Intelligence automatically.",
      progress: 25,
      needsInput: false,
      inputReason: null,
    };
  }

  if (!releaseBound) {
    return {
      phase: "ready" as const,
      label: "Understanding ready",
      detail: "Structure and strongest Moments are ready. Release-specific lyrics and stem context can attach later.",
      progress: 100,
      needsInput: false,
      inputReason: null,
    };
  }

  if (followUpStatus === "queued" || followUpStatus === "waiting") {
    return {
      phase: "enriching" as const,
      label: "Finishing context",
      detail: "Track Intelligence is ready. Ensemblis is reconciling lyrics timing and any available stem context in the background.",
      progress: 85,
      needsInput: false,
      inputReason: null,
    };
  }

  if (followUpStatus === "needs_input") {
    const copy = inputReason === "official_lyrics_missing"
      ? "Track Intelligence and audio Moments are ready. Add the official lyrics when you want lyric-aware timing and creative context."
      : inputReason === "ai_context_disabled"
        ? "Track Intelligence is ready. Lyrics stay private from AI until this artist explicitly enables creative lyric context."
        : inputReason === "stems_from_previous_master"
          ? "Track Intelligence is ready. Existing stems belong to a previous master and need to be reattached before stem-aware scenes can refresh."
          : "Core Track Intelligence is ready. One optional artist input can unlock the remaining context.";
    return {
      phase: "needs_input" as const,
      label: "Core intelligence ready",
      detail: copy,
      progress: 90,
      needsInput: true,
      inputReason,
    };
  }

  if (followUpStatus === "needs_attention") {
    return {
      phase: "needs_attention" as const,
      label: "Core intelligence ready · follow-up needs attention",
      detail: typeof followUp.message === "string"
        ? followUp.message
        : "Track Intelligence is safe, but an optional downstream enrichment step did not finish.",
      progress: 85,
      needsInput: false,
      inputReason: null,
    };
  }

  return {
    phase: "ready" as const,
    label: "Intelligence ready",
    detail: "Structure, strongest Moments and every available release-bound intelligence layer are ready to use.",
    progress: 100,
    needsInput: false,
    inputReason: null,
  };
}
