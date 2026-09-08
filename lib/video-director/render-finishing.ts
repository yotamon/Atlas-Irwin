import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import type { LyricsDatabase } from "@/types/lyrics-database";
import type { StemDatabase, StemCategory } from "@/types/stem-database";
import type { ExtendedMusicVideoProject, ExtendedMusicVideoShot, VideoDatabase } from "@/types/video-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clamp01(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

type StemCurvePoint = {
  startMs: number;
  endMs: number;
  energy: number;
  activeRatio: number;
  rhythmicActivity: number;
};

type RenderStem = { id: string; category: StemCategory; curve: StemCurvePoint[] };
type RenderLyricCue = { id: string; text: string; startMs: number; endMs: number };

export type VideoRenderFinishingContext = {
  stems: RenderStem[];
  lyricCues: RenderLyricCue[];
};

function stemCurve(analysis: Json): StemCurvePoint[] {
  const raw = record(analysis).activity_curve;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = record(item);
    const startMs = typeof row.start_ms === "number" ? Math.max(0, Math.round(row.start_ms)) : null;
    const endMs = typeof row.end_ms === "number" ? Math.max(0, Math.round(row.end_ms)) : null;
    if (startMs === null || endMs === null || endMs <= startMs) return [];
    return [{
      startMs,
      endMs,
      energy: clamp01(row.energy),
      activeRatio: clamp01(row.active_ratio),
      rhythmicActivity: clamp01(row.rhythmic_activity),
    }];
  });
}

export async function loadVideoRenderFinishingContext(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  artistId: string;
  project: ExtendedMusicVideoProject;
}): Promise<VideoRenderFinishingContext> {
  const stemsDb = input.db as unknown as SupabaseClient<StemDatabase>;
  const lyricsDb = input.db as unknown as SupabaseClient<LyricsDatabase>;
  const [stemsResult, lyricsResult] = await Promise.all([
    stemsDb.from("track_stems").select("id,category,status,analysis")
      .eq("owner_id", input.ownerId).eq("artist_id", input.artistId).eq("track_id", input.project.track_id).eq("status", "ready"),
    lyricsDb.from("track_lyrics").select("id,version,status")
      .eq("owner_id", input.ownerId).eq("artist_id", input.artistId).eq("track_id", input.project.track_id).maybeSingle(),
  ]);
  if (stemsResult.error) throw new Error(stemsResult.error.message);
  if (lyricsResult.error) throw new Error(lyricsResult.error.message);

  const lyricLines = lyricsResult.data && lyricsResult.data.status !== "instrumental"
    ? await lyricsDb.from("track_lyric_lines").select("id,text,start_ms,end_ms,allow_media")
      .eq("owner_id", input.ownerId).eq("artist_id", input.artistId)
      .eq("lyrics_id", lyricsResult.data.id).eq("lyrics_version", lyricsResult.data.version)
      .eq("allow_media", true).order("display_order")
    : { data: [], error: null };
  if (lyricLines.error) throw new Error(lyricLines.error.message);

  return {
    stems: (stemsResult.data ?? []).map((stem) => ({ id: stem.id, category: stem.category, curve: stemCurve(stem.analysis) })),
    lyricCues: (lyricLines.data ?? []).flatMap((line) =>
      line.start_ms !== null && line.end_ms !== null && line.end_ms > line.start_ms
        ? [{ id: line.id, text: line.text, startMs: line.start_ms, endMs: line.end_ms }]
        : [],
    ),
  };
}

export type RenderReactiveEvent = {
  start_ms: number;
  end_ms: number;
  intensity: number;
  source: string;
};

function weightForCategory(weights: Record<string, unknown>, category: string) {
  const exact = weights[category];
  if (typeof exact === "number") return clamp01(exact);
  if (category === "keys" || category === "synth" || category === "guitar") return clamp01(weights.energy) * 0.35;
  return 0;
}

function compactEvents(events: RenderReactiveEvent[], maxEvents = 56) {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) => a.start_ms - b.start_ms || b.intensity - a.intensity);
  const buckets = new Map<number, RenderReactiveEvent>();
  for (const event of sorted) {
    const key = Math.floor(event.start_ms / 400);
    const existing = buckets.get(key);
    if (!existing || event.intensity > existing.intensity) buckets.set(key, event);
  }
  const collapsed = [...buckets.values()].sort((a, b) => a.start_ms - b.start_ms);
  if (collapsed.length <= maxEvents) return collapsed;
  const stride = collapsed.length / maxEvents;
  return Array.from({ length: maxEvents }, (_, index) => collapsed[Math.min(collapsed.length - 1, Math.floor(index * stride))]);
}

export function buildShotReactiveEvents(input: {
  shot: ExtendedMusicVideoShot;
  overlapStartMs: number;
  overlapEndMs: number;
  finishing: VideoRenderFinishingContext;
  energyCurve?: Array<{ ms: number; value: number }>;
}) {
  const weights = record(input.shot.music_reactivity);
  const events: RenderReactiveEvent[] = [];
  for (const stem of input.finishing.stems) {
    const weight = weightForCategory(weights, stem.category);
    if (weight < 0.05) continue;
    for (const point of stem.curve) {
      const start = Math.max(input.overlapStartMs, point.startMs);
      const end = Math.min(input.overlapEndMs, point.endMs);
      if (end <= start) continue;
      const measured = Math.max(point.energy, point.rhythmicActivity * 0.95, point.activeRatio * 0.72);
      const intensity = clamp01(measured * weight);
      if (intensity < 0.16) continue;
      events.push({
        start_ms: Math.max(0, start - input.overlapStartMs),
        end_ms: Math.max(1, end - input.overlapStartMs),
        intensity: Number(intensity.toFixed(4)),
        source: stem.category,
      });
    }
  }

  const energyWeight = clamp01(weights.energy);
  if (energyWeight >= 0.05 && input.energyCurve?.length) {
    for (let index = 0; index < input.energyCurve.length; index += 1) {
      const point = input.energyCurve[index];
      if (point.ms < input.overlapStartMs || point.ms >= input.overlapEndMs) continue;
      const nextMs = input.energyCurve[index + 1]?.ms ?? Math.min(input.overlapEndMs, point.ms + 500);
      const intensity = clamp01(point.value * energyWeight * 0.72);
      if (intensity < 0.2) continue;
      events.push({
        start_ms: Math.max(0, point.ms - input.overlapStartMs),
        end_ms: Math.max(1, Math.min(input.overlapEndMs, nextMs) - input.overlapStartMs),
        intensity: Number(intensity.toFixed(4)),
        source: "energy",
      });
    }
  }
  return compactEvents(events);
}

export type RenderCaptionCue = {
  text: string;
  style: "clean" | "editorial" | "karaoke" | "poster";
  start_ms: number;
  end_ms: number;
};

export function buildShotCaptionCues(input: {
  shot: ExtendedMusicVideoShot;
  overlapStartMs: number;
  overlapEndMs: number;
  finishing: VideoRenderFinishingContext;
}): RenderCaptionCue[] {
  const config = record(input.shot.lyrics_config);
  if (config.enabled !== true) return [];
  const style = ["clean", "editorial", "karaoke", "poster"].includes(String(config.style))
    ? String(config.style) as RenderCaptionCue["style"]
    : "clean";
  const custom = typeof config.text === "string" ? config.text.trim() : "";
  const matching = input.finishing.lyricCues.filter((cue) => cue.endMs > input.overlapStartMs && cue.startMs < input.overlapEndMs);

  if (style === "karaoke" && matching.length) {
    return matching.map((cue) => ({
      text: cue.text,
      style,
      start_ms: Math.max(0, Math.max(cue.startMs, input.overlapStartMs) - input.overlapStartMs),
      end_ms: Math.max(1, Math.min(cue.endMs, input.overlapEndMs) - input.overlapStartMs),
    }));
  }
  if (custom) {
    const exact = matching.find((cue) => cue.text.trim() === custom);
    return [{
      text: custom,
      style,
      start_ms: exact ? Math.max(0, Math.max(exact.startMs, input.overlapStartMs) - input.overlapStartMs) : 0,
      end_ms: exact ? Math.max(1, Math.min(exact.endMs, input.overlapEndMs) - input.overlapStartMs) : input.overlapEndMs - input.overlapStartMs,
    }];
  }
  return matching.map((cue) => ({
    text: cue.text,
    style,
    start_ms: Math.max(0, Math.max(cue.startMs, input.overlapStartMs) - input.overlapStartMs),
    end_ms: Math.max(1, Math.min(cue.endMs, input.overlapEndMs) - input.overlapStartMs),
  }));
}

export function buildShotQcPolicy(input: {
  shot: ExtendedMusicVideoShot;
  captions: RenderCaptionCue[];
  reactiveEvents: RenderReactiveEvent[];
}) {
  const performance = record(input.shot.performance_config);
  const lipSync = input.shot.shot_type === "performance" && performance.lip_sync === true;
  return {
    continuity_review_required: Boolean(input.shot.character_id),
    temporal_artifact_review_required: ["generated", "performance"].includes(input.shot.shot_type),
    lip_sync_review_required: lipSync,
    lip_sync_auto_pass_allowed: false,
    lip_sync_evidence: lipSync ? {
      audio_reference_requested: record(input.shot.capability_profile).requires_audio_reference === true,
      timed_lyric_evidence: input.captions.length > 0,
    } : null,
    deterministic_caption_count: input.captions.length,
    measured_reactive_event_count: input.reactiveEvents.length,
    human_visual_review_required: Boolean(input.shot.character_id) || lipSync,
  };
}
