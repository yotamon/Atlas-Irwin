import type { Json } from "@/types/database";

export type MasterReadinessStatus = "pending" | "ready" | "review" | "fix_required" | "unavailable";
export type MasterabilityDiagnosis =
  | "ready_as_is"
  | "streaming_safety_only"
  | "masterable"
  | "mix_review_recommended"
  | "source_repair_required"
  | "pending"
  | "unavailable";
export type MasterDistributionGate = "pass" | "review" | "block" | "waiting" | "unverified";
export type MasterActionKind =
  | "keep"
  | "listen"
  | "mastering_fix"
  | "replace_source"
  | "repair_source"
  | "retry_analysis"
  | "continue_without_verification";

export type MasterFindingCategory = "technical" | "streaming" | "render_stability" | "tempo" | "creative";

export type MasterFinding = {
  code: string;
  severity: "critical" | "review" | "info";
  category: MasterFindingCategory;
  title: string;
  detail: string;
  startMs: number | null;
  endMs: number | null;
  actionKind: MasterActionKind;
  masteringCanHelp: boolean;
};

export type MasterReadiness = {
  status: MasterReadinessStatus;
  headline: string;
  summary: string;
  technicalReady: boolean | null;
  distributionGate: MasterDistributionGate;
  primaryAction: MasterActionKind | null;
  masterability: MasterabilityDiagnosis;
  masterabilityReason: string;
  findings: MasterFinding[];
  reviewCount: number;
  blockerCount: number;
  inspectorVersion: string | null;
  sourceFingerprint: string | null;
  sourceMatchesCurrent: boolean | null;
};

type CurrentMaster = {
  audioUrl?: string | null;
  mediaAssetId?: string | null;
  analysisActive?: boolean;
  analysisFailed?: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceIdentity(map: Record<string, unknown>) {
  const source = record(map.source_audio);
  return {
    mediaAssetId: text(source.media_asset_id),
    audioUrl: text(source.url),
    audioSha256: text(source.audio_sha256),
  };
}

export function musicMapMatchesCurrentMaster(musicMap: Json | unknown, current: CurrentMaster): boolean | null {
  const map = record(musicMap);
  if (!Object.keys(map).length) return null;
  const source = sourceIdentity(map);
  if (current.mediaAssetId && source.mediaAssetId) return current.mediaAssetId === source.mediaAssetId;
  if (current.audioUrl && source.audioUrl) return current.audioUrl === source.audioUrl;
  return null;
}

function actionForCode(code: string, category: string, severity: string): Pick<MasterFinding, "actionKind" | "masteringCanHelp" | "category" | "title"> {
  if (["decode_failed", "empty_audio", "digital_clipping"].includes(code)) {
    return {
      actionKind: code === "digital_clipping" ? "repair_source" : "replace_source",
      masteringCanHelp: false,
      category: "technical",
      title: code === "digital_clipping" ? "Source clipping needs repair" : "Replace the source audio",
    };
  }
  if (["true_peak_hot", "spotify_loud_master_headroom", "codec_headroom"].includes(code)) {
    return {
      actionKind: "mastering_fix",
      masteringCanHelp: true,
      category: "streaming",
      title: "Streaming headroom can be improved safely",
    };
  }
  if (["phase_risk", "localized_mono_loss"].includes(code)) {
    return {
      actionKind: "repair_source",
      masteringCanHelp: false,
      category: "technical",
      title: "Check mono translation in the source",
    };
  }
  if (code === "wide_low_end") {
    return {
      actionKind: "listen",
      masteringCanHelp: false,
      category: "creative",
      title: "Listen to the low-end width",
    };
  }
  if (["tempo_drift", "tempo_unstable", "beat_grid_unstable"].includes(code)) {
    return {
      actionKind: "repair_source",
      masteringCanHelp: false,
      category: "tempo",
      title: "Check the timing in the source render",
    };
  }
  if (code.startsWith("temporal_")) {
    return {
      actionKind: "listen",
      masteringCanHelp: false,
      category: "render_stability",
      title: "Listen to this render-stability change",
    };
  }
  if (category === "platform_risk") {
    return {
      actionKind: "listen",
      masteringCanHelp: false,
      category: "streaming",
      title: "Review streaming translation",
    };
  }
  if (severity === "critical") {
    return {
      actionKind: "repair_source",
      masteringCanHelp: false,
      category: "technical",
      title: "Fix this source issue before release",
    };
  }
  return {
    actionKind: "listen",
    masteringCanHelp: false,
    category: category === "technical_defect" ? "technical" : "creative",
    title: "Listen before approving",
  };
}

function normalizeFinding(value: unknown): MasterFinding | null {
  const issue = record(value);
  const code = text(issue.code);
  if (!code) return null;
  const rawSeverity = text(issue.severity);
  const severity: MasterFinding["severity"] =
    rawSeverity === "critical" ? "critical" : rawSeverity === "review" ? "review" : "info";
  const rawCategory = text(issue.category) ?? "";
  const policy = actionForCode(code, rawCategory, severity);
  return {
    code,
    severity,
    category: policy.category,
    title: policy.title,
    detail: text(issue.message) ?? "Review this part of the master.",
    startMs: number(issue.start_ms),
    endMs: number(issue.end_ms),
    actionKind: policy.actionKind,
    masteringCanHelp: policy.masteringCanHelp,
  };
}

function temporalFindings(inspector: Record<string, unknown>) {
  const temporal = record(inspector.temporal_stability);
  return list(temporal.findings)
    .map((finding) => {
      const raw = record(finding);
      return normalizeFinding({
        ...raw,
        code: text(raw.code)?.startsWith("temporal_") ? raw.code : `temporal_${text(raw.code) ?? "change"}`,
        severity: raw.severity ?? "review",
        category: "render_stability",
        message: raw.message ?? raw.detail ?? "The sound changes unusually here without a nearby musical section change.",
      });
    })
    .filter((finding): finding is MasterFinding => Boolean(finding));
}

function choosePrimaryAction(findings: MasterFinding[], status: MasterReadinessStatus): MasterActionKind | null {
  if (status === "ready") return "keep";
  if (status === "pending") return null;
  if (status === "unavailable") return "retry_analysis";
  const blockers = findings.filter((finding) => finding.severity === "critical");
  const pool = blockers.length ? blockers : findings.filter((finding) => finding.severity === "review");
  if (pool.some((finding) => finding.actionKind === "replace_source")) return "replace_source";
  if (pool.some((finding) => finding.actionKind === "repair_source")) return "repair_source";
  if (pool.some((finding) => finding.masteringCanHelp)) return "mastering_fix";
  if (pool.length) return "listen";
  return status === "review" ? "listen" : "keep";
}

function diagnoseMasterability(
  status: MasterReadinessStatus,
  findings: MasterFinding[],
  technicalReady: boolean | null,
): { masterability: MasterabilityDiagnosis; masterabilityReason: string } {
  if (status === "pending") {
    return {
      masterability: "pending",
      masterabilityReason: "Fresh waveform evidence is still being measured.",
    };
  }
  if (status === "unavailable") {
    return {
      masterability: "unavailable",
      masterabilityReason: "The current waveform does not yet have trustworthy mastering evidence.",
    };
  }

  const audible = findings.filter((finding) => finding.severity !== "info");
  const critical = audible.filter((finding) => finding.severity === "critical");
  if (
    status === "fix_required"
    || critical.length
    || audible.some((finding) => ["replace_source", "repair_source"].includes(finding.actionKind))
  ) {
    return {
      masterability: "source_repair_required",
      masterabilityReason: "A source-level defect must be resolved before creative mastering can be evaluated safely.",
    };
  }

  const review = audible.filter((finding) => finding.severity === "review");
  const streamingCodes = new Set(["true_peak_hot", "spotify_loud_master_headroom", "codec_headroom"]);
  if (
    review.length > 0
    && review.every((finding) => streamingCodes.has(finding.code) && finding.masteringCanHelp)
  ) {
    return {
      masterability: "streaming_safety_only",
      masterabilityReason: "The source is technically usable; only transparent peak/codec headroom correction is indicated.",
    };
  }

  const upstreamReview = review.some((finding) => (
    !finding.masteringCanHelp
    && (
      finding.category === "tempo"
      || finding.category === "render_stability"
      || finding.category === "technical"
      || finding.category === "creative"
    )
  ));
  if (upstreamReview) {
    return {
      masterability: "mix_review_recommended",
      masterabilityReason: "The source is distributable, but at least one finding is better judged in the mix/source than hidden by mastering.",
    };
  }

  if (status === "ready") {
    return {
      masterability: "ready_as_is",
      masterabilityReason: "No corrective mastering is indicated. Creative mastering remains optional.",
    };
  }

  if (technicalReady !== false) {
    return {
      masterability: "masterable",
      masterabilityReason: "The stereo source is technically healthy enough for bounded creative mastering and listening comparison.",
    };
  }

  return {
    masterability: "unavailable",
    masterabilityReason: "Masterability cannot be established from the current evidence.",
  };
}


function copyFor(status: MasterReadinessStatus, findings: MasterFinding[]) {
  const audible = findings.filter((finding) => finding.severity !== "info").length;
  if (status === "ready") return {
    headline: "Ready to release",
    summary: "No technical release blockers were found. Keep the current master unless you want a creative change.",
  };
  if (status === "review") return {
    headline: audible === 1 ? "Ready, but listen to 1 thing" : `Ready, but listen to ${audible} things`,
    summary: "The master can be distributed. These findings are worth checking by ear before you approve it.",
  };
  if (status === "fix_required") return {
    headline: "Fix this before release",
    summary: "Ensemblis found a technical source problem that should be corrected before distribution.",
  };
  if (status === "pending") return {
    headline: "Checking this master",
    summary: "Ensemblis is verifying the current waveform before it makes a release recommendation.",
  };
  return {
    headline: "Master verification unavailable",
    summary: "Ensemblis cannot confirm release readiness for the current waveform yet.",
  };
}

export function deriveMasterReadiness(
  musicMapValue: Json | unknown,
  current: CurrentMaster = {},
): MasterReadiness {
  const map = record(musicMapValue);
  const inspector = record(map.mastering_inspector);
  const source = sourceIdentity(map);
  const sourceMatchesCurrent = musicMapMatchesCurrentMaster(musicMapValue, current);

  if (current.analysisActive) {
    const copy = copyFor("pending", []);
    return {
      status: "pending",
      ...copy,
      technicalReady: null,
      distributionGate: "waiting",
      primaryAction: null,
      ...diagnoseMasterability("pending", [], null),
      findings: [],
      reviewCount: 0,
      blockerCount: 0,
      inspectorVersion: text(inspector.schema),
      sourceFingerprint: source.audioSha256,
      sourceMatchesCurrent,
    };
  }

  if (sourceMatchesCurrent === false) {
    return {
      status: "unavailable",
      headline: "Checking the new master",
      summary: "The available mastering evidence belongs to a previous waveform. Fresh verification is required.",
      technicalReady: null,
      distributionGate: "unverified",
      primaryAction: "retry_analysis",
      ...diagnoseMasterability("unavailable", [], null),
      findings: [],
      reviewCount: 0,
      blockerCount: 0,
      inspectorVersion: text(inspector.schema),
      sourceFingerprint: source.audioSha256,
      sourceMatchesCurrent,
    };
  }

  if (!Object.keys(inspector).length) {
    const copy = copyFor("unavailable", []);
    return {
      status: "unavailable",
      ...copy,
      technicalReady: null,
      distributionGate: "unverified",
      primaryAction: "retry_analysis",
      ...diagnoseMasterability("unavailable", [], null),
      findings: [],
      reviewCount: 0,
      blockerCount: 0,
      inspectorVersion: null,
      sourceFingerprint: source.audioSha256,
      sourceMatchesCurrent,
    };
  }

  const findings = [
    ...list(inspector.issues).map(normalizeFinding).filter((finding): finding is MasterFinding => Boolean(finding)),
    ...temporalFindings(inspector),
  ];
  const blockerCount = findings.filter((finding) => finding.severity === "critical").length;
  const reviewCount = findings.filter((finding) => finding.severity === "review").length;
  const rawStatus = text(inspector.status);
  const status: MasterReadinessStatus =
    rawStatus === "fix_before_release" || blockerCount > 0
      ? "fix_required"
      : rawStatus === "ready_review_suggested" || reviewCount > 0
        ? "review"
        : rawStatus === "ready"
          ? "ready"
          : current.analysisFailed
            ? "unavailable"
            : "unavailable";
  const copy = copyFor(status, findings);
  const technicalReady = typeof inspector.technical_ready === "boolean" ? inspector.technical_ready : null;
  return {
    status,
    ...copy,
    technicalReady,
    distributionGate: status === "fix_required" ? "block" : status === "review" ? "review" : status === "ready" ? "pass" : "unverified",
    primaryAction: choosePrimaryAction(findings, status),
    ...diagnoseMasterability(status, findings, technicalReady),
    findings,
    reviewCount,
    blockerCount,
    inspectorVersion: text(inspector.schema),
    sourceFingerprint: source.audioSha256,
    sourceMatchesCurrent,
  };
}

