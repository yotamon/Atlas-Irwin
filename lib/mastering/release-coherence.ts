import type { Json } from "@/types/database";

export type ReleaseMasteringTrackInput = {
  id: string;
  title: string;
  musicMap: Json | unknown;
};

export type ReleaseMasteringRelationship = {
  fromTrackId: string;
  toTrackId: string;
  loudnessDeltaLu: number | null;
  plrDeltaLu: number | null;
  truePeakDeltaDb: number | null;
  spectralDistance: number | null;
};

export type ReleaseMasteringFinding = {
  code: "loudness_outlier" | "dynamics_outlier" | "tonal_outlier" | "stereo_outlier";
  trackId: string;
  title: string;
  severity: "review";
  summary: string;
};

export type ReleaseMasteringCoherence = {
  schema: "ensemblis.release_mastering_coherence.v1";
  status: "insufficient_evidence" | "coherent" | "review";
  analyzedTrackCount: number;
  totalTrackCount: number;
  findings: ReleaseMasteringFinding[];
  relationships: ReleaseMasteringRelationship[];
  releaseMedian: {
    integratedLufs: number | null;
    plrLu: number | null;
    stereoCorrelation: number | null;
  };
  summary: string;
  policy: {
    normalizeEveryTrackToSameLufs: false;
    preservesIntentionalContrast: true;
    automaticCrossTrackProcessing: false;
  };
};

type TrackEvidence = {
  id: string;
  title: string;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  plrLu: number | null;
  stereoCorrelation: number | null;
  envelope: Record<string, number>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericRecord(value: unknown) {
  const source = record(value);
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(source)) {
    const value = finite(raw);
    if (value !== null) result[key] = value;
  }
  return result;
}

function median(values: Array<number | null>) {
  const clean = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function spectralDistance(left: Record<string, number>, right: Record<string, number>) {
  const shared = Object.keys(left).filter((key) => key in right);
  if (shared.length < 3) return null;
  const meanAbs = shared.reduce((sum, key) => sum + Math.abs(left[key] - right[key]), 0) / shared.length;
  return meanAbs / 6;
}

function evidence(input: ReleaseMasteringTrackInput): TrackEvidence | null {
  const map = record(input.musicMap);
  const inspector = record(map.mastering_inspector);
  if (!Object.keys(inspector).length) return null;
  const loudness = record(inspector.loudness);
  const dynamics = record(inspector.dynamics);
  const stereo = record(inspector.stereo);
  const signature = record(inspector.reference_signature);
  const fine = numericRecord(signature.perceptual_envelope_db);
  const broad = numericRecord(signature.band_relative_db);
  return {
    id: input.id,
    title: input.title,
    integratedLufs: finite(loudness.integrated_lufs),
    truePeakDbtp: finite(loudness.true_peak_dbtp),
    plrLu: finite(dynamics.peak_to_loudness_ratio_lu),
    stereoCorrelation: finite(stereo.correlation),
    envelope: Object.keys(fine).length ? fine : broad,
  };
}

function round(value: number | null, digits = 2) {
  return value === null ? null : Number(value.toFixed(digits));
}

export function deriveReleaseMasteringCoherence(
  tracks: ReleaseMasteringTrackInput[],
): ReleaseMasteringCoherence {
  const analyzed = tracks.map(evidence).filter((item): item is TrackEvidence => Boolean(item));
  const base: ReleaseMasteringCoherence = {
    schema: "ensemblis.release_mastering_coherence.v1",
    status: "insufficient_evidence",
    analyzedTrackCount: analyzed.length,
    totalTrackCount: tracks.length,
    findings: [],
    relationships: [],
    releaseMedian: {
      integratedLufs: round(median(analyzed.map((item) => item.integratedLufs))),
      plrLu: round(median(analyzed.map((item) => item.plrLu))),
      stereoCorrelation: round(median(analyzed.map((item) => item.stereoCorrelation)), 3),
    },
    summary: "Release coherence needs at least two analyzed canonical masters.",
    policy: {
      normalizeEveryTrackToSameLufs: false,
      preservesIntentionalContrast: true,
      automaticCrossTrackProcessing: false,
    },
  };
  if (analyzed.length < 2) return base;

  const relationships: ReleaseMasteringRelationship[] = [];
  for (let index = 1; index < analyzed.length; index += 1) {
    const previous = analyzed[index - 1];
    const current = analyzed[index];
    relationships.push({
      fromTrackId: previous.id,
      toTrackId: current.id,
      loudnessDeltaLu: previous.integratedLufs !== null && current.integratedLufs !== null
        ? round(current.integratedLufs - previous.integratedLufs)
        : null,
      plrDeltaLu: previous.plrLu !== null && current.plrLu !== null
        ? round(current.plrLu - previous.plrLu)
        : null,
      truePeakDeltaDb: previous.truePeakDbtp !== null && current.truePeakDbtp !== null
        ? round(current.truePeakDbtp - previous.truePeakDbtp)
        : null,
      spectralDistance: round(spectralDistance(previous.envelope, current.envelope), 3),
    });
  }

  const findings: ReleaseMasteringFinding[] = [];
  const medianLufs = median(analyzed.map((item) => item.integratedLufs));
  const medianPlr = median(analyzed.map((item) => item.plrLu));
  const medianStereo = median(analyzed.map((item) => item.stereoCorrelation));
  const referenceEnvelope: Record<string, number> = {};
  const envelopeKeys = [...new Set(analyzed.flatMap((item) => Object.keys(item.envelope)))];
  for (const key of envelopeKeys) {
    const value = median(analyzed.map((item) => item.envelope[key] ?? null));
    if (value !== null) referenceEnvelope[key] = value;
  }

  for (const item of analyzed) {
    if (medianLufs !== null && item.integratedLufs !== null && Math.abs(item.integratedLufs - medianLufs) >= 3.0) {
      findings.push({
        code: "loudness_outlier",
        trackId: item.id,
        title: item.title,
        severity: "review",
        summary: `${item.title} is ${Math.abs(item.integratedLufs - medianLufs).toFixed(1)} LU away from the release median. Audition the sequence before deciding whether this contrast is intentional.`,
      });
    }
    if (medianPlr !== null && item.plrLu !== null && Math.abs(item.plrLu - medianPlr) >= 3.5) {
      findings.push({
        code: "dynamics_outlier",
        trackId: item.id,
        title: item.title,
        severity: "review",
        summary: `${item.title} has materially different peak-to-loudness behavior from the release median. Preserve it when the contrast is musically intentional.`,
      });
    }
    const tonalDistance = spectralDistance(item.envelope, referenceEnvelope);
    if (tonalDistance !== null && tonalDistance >= 0.48) {
      findings.push({
        code: "tonal_outlier",
        trackId: item.id,
        title: item.title,
        severity: "review",
        summary: `${item.title} has a notably different tonal envelope from the rest of the release. Listen across the track transition rather than forcing a common EQ curve.`,
      });
    }
    if (
      medianStereo !== null
      && item.stereoCorrelation !== null
      && Math.abs(item.stereoCorrelation - medianStereo) >= 0.35
    ) {
      findings.push({
        code: "stereo_outlier",
        trackId: item.id,
        title: item.title,
        severity: "review",
        summary: `${item.title} has a notably different stereo character. Check the sequence in stereo and mono before changing it.`,
      });
    }
  }

  return {
    ...base,
    status: findings.length ? "review" : "coherent",
    findings,
    relationships,
    summary: findings.length
      ? `${findings.length} release-level contrast${findings.length === 1 ? "" : "s"} are worth auditioning in sequence. They are review cues, not instructions to make every track match.`
      : "The analyzed masters form a technically coherent sequence while preserving their measured track-to-track differences.",
  };
}
