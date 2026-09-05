import { CREATE_OUTCOMES, type CreateOutcome, type CreateOutcomeId } from "@/lib/studio/create-outcomes";
import type { Moment } from "@/types/moments-database";

export const CREATIVE_DIRECTION_MAX_RESULTS = 3;

type CreativeDirectionCandidate = {
  moment: Moment;
  outcome: CreateOutcome;
  score: number;
};

export type CreativeDirection = CreativeDirectionCandidate & {
  id: string;
  rank: number;
  rationale: string;
};

function clamp01(value: number | null | undefined) {
  return Math.max(0, Math.min(1, value ?? 0));
}

function momentText(moment: Moment) {
  return `${moment.label} ${moment.moment_type} ${(moment.purpose_tags ?? []).join(" ")}`.toLowerCase();
}

function containsAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function outcomeScore(moment: Moment, outcomeId: CreateOutcomeId) {
  const confidence = clamp01(moment.confidence);
  const hook = clamp01(moment.hook_score);
  const energy = clamp01(moment.energy_score);
  const emotion = clamp01(moment.emotional_score);
  const vocal = clamp01(moment.vocal_score);
  const uniqueness = clamp01(moment.uniqueness_score);
  const text = momentText(moment);

  if (outcomeId === "reach") {
    const semantic = containsAny(text, ["hook", "drop", "chorus", "climax", "payoff", "impact"]) ? 0.16 : 0;
    return clamp01(confidence * 0.18 + hook * 0.32 + energy * 0.24 + uniqueness * 0.10 + semantic);
  }

  if (outcomeId === "streams") {
    const semantic = containsAny(text, ["chorus", "payoff", "identity", "emotional", "vocal"]) ? 0.16 : 0;
    return clamp01(confidence * 0.20 + hook * 0.24 + emotion * 0.20 + vocal * 0.12 + uniqueness * 0.08 + semantic);
  }

  if (outcomeId === "lyric") {
    const source = moment.source_mode === "lyrics" || moment.source_mode === "fused" ? 0.18 : 0;
    const semantic = containsAny(text, ["lyric", "vocal", "verse", "line", "words"]) ? 0.10 : 0;
    return clamp01(confidence * 0.20 + vocal * 0.28 + emotion * 0.16 + hook * 0.08 + source + semantic);
  }

  const source = moment.source_mode === "stems" || moment.source_mode === "fused" ? 0.12 : 0;
  const semantic = containsAny(text, ["groove", "instrument", "visual", "loop", "texture", "movement"]) ? 0.14 : 0;
  return clamp01(confidence * 0.16 + uniqueness * 0.28 + energy * 0.18 + hook * 0.12 + source + semantic);
}

function directionRationale(moment: Moment, outcome: CreateOutcome) {
  const hook = clamp01(moment.hook_score);
  const energy = clamp01(moment.energy_score);
  const emotion = clamp01(moment.emotional_score);
  const vocal = clamp01(moment.vocal_score);
  const uniqueness = clamp01(moment.uniqueness_score);

  if (outcome.id === "reach") {
    if (hook >= 0.75 && energy >= 0.65) return "Immediate hook and energy make this the strongest discovery-first treatment.";
    return "This Moment is ranked for fast recognition and a clear first impression.";
  }
  if (outcome.id === "streams") {
    if (hook >= 0.7 && emotion >= 0.6) return "A memorable payoff with emotional weight makes this a strong bridge from social attention to the full track.";
    return "This treatment keeps the song itself central and is ranked to turn interest into listening intent.";
  }
  if (outcome.id === "lyric") {
    if (vocal >= 0.7 || moment.source_mode === "lyrics") return "The vocal and lyric evidence is strong enough to let the words lead the creative.";
    return "This Moment carries enough vocal meaning to support a lyric-led treatment without inventing text.";
  }
  if (uniqueness >= 0.7 || moment.source_mode === "stems") return "Distinctive musical texture makes this a strong source for a repeatable visual identity.";
  return "This Moment is ranked for a recognizable visual loop that can carry across the release campaign.";
}

export function recommendCreativeDirections({
  moments,
  activeReleaseId = null,
  maxResults = CREATIVE_DIRECTION_MAX_RESULTS,
}: {
  moments: Moment[];
  activeReleaseId?: string | null;
  maxResults?: number;
}): CreativeDirection[] {
  const limit = Math.max(1, Math.min(CREATIVE_DIRECTION_MAX_RESULTS, maxResults));
  const activeReleaseMoments = activeReleaseId ? moments.filter((moment) => moment.release_id === activeReleaseId) : [];
  const sourceMoments = activeReleaseMoments.length ? activeReleaseMoments : moments;
  const candidates: CreativeDirectionCandidate[] = sourceMoments.flatMap((moment) =>
    CREATE_OUTCOMES.map((outcome) => ({
      moment,
      outcome,
      score: outcomeScore(moment, outcome.id),
    })),
  ).sort((left, right) =>
    right.score - left.score
    || (right.moment.confidence ?? 0) - (left.moment.confidence ?? 0)
    || left.moment.start_ms - right.moment.start_ms
    || left.moment.id.localeCompare(right.moment.id),
  );

  const selected: CreativeDirectionCandidate[] = [];
  const usedOutcomes = new Set<CreateOutcomeId>();
  const usedMoments = new Set<string>();
  const canKeepMomentsUnique = new Set(sourceMoments.map((moment) => moment.id)).size >= limit;

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (usedOutcomes.has(candidate.outcome.id)) continue;
    if (canKeepMomentsUnique && usedMoments.has(candidate.moment.id)) continue;
    selected.push(candidate);
    usedOutcomes.add(candidate.outcome.id);
    usedMoments.add(candidate.moment.id);
  }

  if (selected.length < limit) {
    for (const candidate of candidates) {
      if (selected.length >= limit) break;
      if (usedOutcomes.has(candidate.outcome.id)) continue;
      selected.push(candidate);
      usedOutcomes.add(candidate.outcome.id);
      usedMoments.add(candidate.moment.id);
    }
  }

  return selected.map((candidate, index) => ({
    ...candidate,
    id: `${candidate.moment.id}:${candidate.outcome.id}`,
    rank: index + 1,
    rationale: directionRationale(candidate.moment, candidate.outcome),
  }));
}
