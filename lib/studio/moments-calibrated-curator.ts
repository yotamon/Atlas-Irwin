import {
  MOMENTS_V2_MAX_RESULTS,
  MOMENTS_V2_QUALITY_FLOOR,
  curateReleaseMoments,
  type LyricMomentEvidence,
  type LyricSectionEvidence,
  type MomentCurationResult,
} from "@/lib/studio/moments-curator";
import {
  applyMomentCalibrationScore,
  latestExactMomentCalibration,
} from "@/lib/studio/moment-calibration";
import type { Moment, MomentCalibrationEvent } from "@/types/moments-database";

export function curateCalibratedReleaseMoments({
  moments,
  calibrationEvents = [],
  sections = [],
  lyricMoments = [],
  maxResults = MOMENTS_V2_MAX_RESULTS,
  qualityFloor = MOMENTS_V2_QUALITY_FLOOR,
}: {
  moments: Moment[];
  calibrationEvents?: MomentCalibrationEvent[];
  sections?: LyricSectionEvidence[];
  lyricMoments?: LyricMomentEvidence[];
  maxResults?: number;
  qualityFloor?: number;
}): MomentCurationResult {
  if (!calibrationEvents.length) {
    return curateReleaseMoments({ moments, sections, lyricMoments, maxResults, qualityFloor });
  }

  const activeCount = moments.filter((moment) => moment.state === "proposed" || moment.state === "approved").length;
  const expanded = curateReleaseMoments({
    moments,
    sections,
    lyricMoments,
    maxResults: Math.max(maxResults, activeCount),
    qualityFloor: 0,
  });

  const calibrated = expanded.curated
    .map((moment) => ({
      ...moment,
      curation: {
        ...moment.curation,
        quality_score: applyMomentCalibrationScore(
          moment.curation.quality_score,
          moment,
          calibrationEvents,
          moments,
        ),
      },
    }))
    .filter((moment) => {
      const calibration = latestExactMomentCalibration(moment, calibrationEvents);
      return moment.curation.quality_score >= qualityFloor
        || moment.state === "approved"
        || moment.curation.manual_timing
        || calibration?.judgment === "best"
        || calibration?.judgment === "useful";
    })
    .sort((left, right) => (
      right.curation.quality_score - left.curation.quality_score
      || left.curation.rank - right.curation.rank
      || left.start_ms - right.start_ms
      || left.id.localeCompare(right.id)
    ))
    .slice(0, Math.max(1, maxResults))
    .map((moment, index) => ({
      ...moment,
      curation: { ...moment.curation, rank: index + 1 },
    }));

  return {
    curated: calibrated,
    historical: expanded.historical,
    raw_active_count: expanded.raw_active_count,
    suppressed_count: Math.max(0, expanded.raw_active_count - calibrated.length),
  };
}
