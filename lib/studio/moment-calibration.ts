import type { Moment, MomentCalibrationEvent } from "@/types/moments-database";

export const MOMENT_CALIBRATION_MAX_ABS_DELTA = 0.2;

function sameNullable<T>(left: T | null, right: T | null) {
  return left === right;
}

export function calibrationMatchesMoment(event: MomentCalibrationEvent, moment: Moment) {
  return event.moment_id === moment.id
    && event.moment_source_fingerprint === moment.source_fingerprint
    && sameNullable(event.moment_track_analysis_version, moment.track_analysis_version)
    && sameNullable(event.moment_track_analysis_audio_sha256, moment.track_analysis_audio_sha256)
    && event.source_start_ms === moment.source_start_ms
    && event.source_end_ms === moment.source_end_ms;
}

function compareNewest(left: MomentCalibrationEvent, right: MomentCalibrationEvent) {
  const timeDelta = Date.parse(right.created_at) - Date.parse(left.created_at);
  return timeDelta || right.id.localeCompare(left.id);
}

export function latestExactMomentCalibration(
  moment: Moment,
  events: MomentCalibrationEvent[],
) {
  return events
    .filter((event) => calibrationMatchesMoment(event, moment))
    .sort(compareNewest)[0] ?? null;
}

export function latestExactCalibrationByMoment(
  moments: Moment[],
  events: MomentCalibrationEvent[],
) {
  const momentMap = new Map(moments.map((moment) => [moment.id, moment]));
  const grouped = new Map<string, MomentCalibrationEvent[]>();
  for (const event of events) {
    const moment = momentMap.get(event.moment_id);
    if (!moment || !calibrationMatchesMoment(event, moment)) continue;
    const existing = grouped.get(event.moment_id) ?? [];
    existing.push(event);
    grouped.set(event.moment_id, existing);
  }
  return new Map(
    [...grouped.entries()].map(([momentId, rows]) => [momentId, rows.sort(compareNewest)[0]]),
  );
}

function directJudgmentDelta(event: MomentCalibrationEvent | null) {
  if (!event) return 0;
  switch (event.judgment) {
    case "best": return 0.18;
    case "useful": return 0.08;
    case "poor": return -0.18;
    default: return 0;
  }
}

export function momentCalibrationDelta(
  moment: Moment,
  events: MomentCalibrationEvent[],
  allMoments: Moment[],
) {
  const latest = latestExactCalibrationByMoment(allMoments, events);
  const direct = latest.get(moment.id) ?? null;
  let delta = directJudgmentDelta(direct);
  if (direct?.preferred_moment_id) delta -= 0.06;

  const incomingPreference = [...latest.values()].some((event) => (
    event.moment_id !== moment.id
    && event.preferred_moment_id === moment.id
    && event.preferred_moment_source_fingerprint === moment.source_fingerprint
  ));
  if (incomingPreference) delta += 0.14;

  return Math.max(
    -MOMENT_CALIBRATION_MAX_ABS_DELTA,
    Math.min(MOMENT_CALIBRATION_MAX_ABS_DELTA, delta),
  );
}

export function applyMomentCalibrationScore(
  baseScore: number,
  moment: Moment,
  events: MomentCalibrationEvent[],
  allMoments: Moment[],
) {
  return Math.max(0, Math.min(1, baseScore + momentCalibrationDelta(moment, events, allMoments)));
}

export function momentCalibrationLabel(event: MomentCalibrationEvent | null) {
  if (!event) return null;
  switch (event.judgment) {
    case "best": return "Artist favorite";
    case "useful": return "Artist preferred";
    case "poor": return "Artist avoided";
    default: return "Artist adjusted";
  }
}
