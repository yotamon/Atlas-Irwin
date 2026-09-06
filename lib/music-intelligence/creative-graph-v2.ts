import type { TrackLyricsContext } from "@/lib/lyrics-intelligence/context";
import {
  buildTrackCreativeIntelligenceGraph as buildV1,
  conciseCreativeGraphContext as conciseV1,
  type TrackCreativeIntelligenceGraph,
} from "@/lib/music-intelligence/creative-graph";
import type { MusicHookCandidate, MusicMap } from "@/lib/video-director/creative-director";
import type { AudioScene, TrackStem } from "@/types/stem-database";

export type { TrackCreativeIntelligenceGraph } from "@/lib/music-intelligence/creative-graph";

type SemanticDescriptor = {
  text?: string;
  similarity?: number;
};

type V4MusicHookCandidate = MusicHookCandidate & {
  musical_completeness?: number;
  boundary_confidence?: number;
  unit_kind?: string;
  semantic_descriptors?: SemanticDescriptor[];
  semantic_embedding_ref?: {
    provider?: string;
    model?: string;
    revision?: string;
    window_id?: string;
  };
  metrics: MusicHookCandidate["metrics"] & {
    musical_completeness?: number;
    boundary_confidence?: number;
  };
};

function numeric(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function overlapRatio(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
) {
  const overlap = Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
  return overlap / Math.max(1, Math.min(a.endMs - a.startMs, b.endMs - b.startMs));
}

function asV4Hook(hook: MusicHookCandidate): V4MusicHookCandidate {
  return hook as V4MusicHookCandidate;
}

function completeMomentScore(hook: MusicHookCandidate) {
  const extended = asV4Hook(hook);
  return numeric(
    extended.musical_completeness,
    numeric(extended.metrics?.musical_completeness, 0),
  );
}

function boundaryConfidence(hook: MusicHookCandidate) {
  const extended = asV4Hook(hook);
  return numeric(
    extended.boundary_confidence,
    numeric(extended.metrics?.boundary_confidence, 0),
  );
}

function semanticRationale(hook: MusicHookCandidate) {
  const descriptors = asV4Hook(hook).semantic_descriptors;
  if (!Array.isArray(descriptors)) return [];
  return descriptors
    .filter((descriptor) => typeof descriptor?.text === "string" && descriptor.text.trim().length > 0)
    .slice(0, 2)
    .map((descriptor) => {
      const score = typeof descriptor.similarity === "number" && Number.isFinite(descriptor.similarity)
        ? ` (${descriptor.similarity.toFixed(2)} similarity)`
        : "";
      return `Cross-modal audio evidence: ${descriptor.text!.trim()}${score}.`;
    });
}

/**
 * V2 keeps the existing multimodal graph but makes the canonical V4 Musical Moment
 * the timing anchor. Lyrics, stems, Audio Scenes and optional semantic audio evidence
 * can strengthen a highlight; they must not average a clean phrase boundary back into
 * an arbitrary timestamp or replace deterministic MIR as the timing source of truth.
 */
export function buildTrackCreativeIntelligenceGraph(input: {
  musicMap: MusicMap | null;
  lyrics: TrackLyricsContext;
  scenes: AudioScene[];
  stems: TrackStem[];
}): TrackCreativeIntelligenceGraph | null {
  const graph = buildV1(input);
  if (!graph || !input.musicMap) return graph;

  const completeMoments = (input.musicMap.hook_candidates ?? [])
    .filter((hook) => completeMomentScore(hook) >= 0.72)
    .sort((a, b) => b.score - a.score);

  graph.highlights = graph.highlights.map((highlight) => {
    const anchor = completeMoments
      .filter((hook) => overlapRatio(
        { startMs: highlight.startMs, endMs: highlight.endMs },
        { startMs: hook.start_ms, endMs: hook.end_ms },
      ) >= 0.42)
      .sort((a, b) => {
        const aScore = completeMomentScore(a) * 0.55 + boundaryConfidence(a) * 0.25 + a.score * 0.2;
        const bScore = completeMomentScore(b) * 0.55 + boundaryConfidence(b) * 0.25 + b.score * 0.2;
        return bScore - aScore;
      })[0];
    if (!anchor) return highlight;

    const reasons = Array.isArray(anchor.reasons) ? anchor.reasons.slice(0, 2) : [];
    const semanticReasons = semanticRationale(anchor);
    return {
      ...highlight,
      startMs: anchor.start_ms,
      endMs: anchor.end_ms,
      hookIds: [...new Set([anchor.id, ...highlight.hookIds])],
      rationale: [...new Set([
        ...reasons,
        ...semanticReasons,
        "Timing anchored to a complete Track Intelligence V4 musical phrase.",
        ...highlight.rationale,
      ])].slice(0, 5),
    };
  });

  return graph;
}

export function conciseCreativeGraphContext(graph: TrackCreativeIntelligenceGraph | null) {
  return conciseV1(graph);
}
