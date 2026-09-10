import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runAtlasAiTask } from "@/lib/ai/control-plane";
import { strictQualityResult } from "@/lib/ai/quality";
import { parseMusicMap, type MusicHookCandidate } from "@/lib/video-director/creative-director";
import {
  alignLyricLinesToVocalActivity,
  alignLyricSectionsMonotonically,
  normalizeExcerpt,
  type VocalActivitySlice,
  type VocalSectionActivity,
} from "./timing";
import {
  LYRICS_ANALYSIS_SCHEMA,
  LYRICS_PROMPT_VERSION,
  excerptExists,
} from "./domain";
import type { Json } from "@/types/database";
import type {
  LyricsAnalysisPayload,
  LyricsDatabase,
  TrackLyricSection,
  TrackLyrics,
} from "@/types/lyrics-database";
import type { StemDatabase } from "@/types/stem-database";

const ANALYSIS_INSTRUCTIONS = `You are Atlas Irwin Lyrics Intelligence, a precise music editorial analyst.
Analyze only the official lyrics and the supplied section blocks. Treat the lyrics as immutable source text.

Goals:
- explain the song's core meaning, narrative and emotional movement without generic filler;
- identify recurring imagery, motifs, perspective and the meaning of the chorus/refrain;
- identify short memorable hook phrases that are genuinely useful for creative work;
- annotate every supplied section_key with its best structural type;
- propose a small set of high-value Lyric Moments for social/video/editorial use.

Hard rules:
1. Never rewrite, improve, complete or invent lyrics.
2. Every hook_phrases[].text and every moments[].excerpt MUST be an exact excerpt that appears in the official lyrics.
3. Every moments[].section_key and section_annotations[].section_key MUST be one of the supplied keys.
4. Return exactly one section annotation for every supplied section key, in the same order.
5. Treat interpretation as interpretation, not as artist-confirmed biography or intent.
6. Avoid AI-cliche visual language. Visual opportunities should be specific to this song's actual imagery or emotional mechanics.
7. Prefer a few strong moments over filler. Scores must reflect genuine usefulness.
8. The output is internal creative intelligence. Do not add prose outside the schema.`;

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function overlapCandidate(section: TrackLyricSection, candidates: MusicHookCandidate[]) {
  if (section.start_ms === null || section.end_ms === null) return null;
  return candidates
    .filter((candidate) => candidate.end_ms > section.start_ms! && candidate.start_ms < section.end_ms!)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

type VocalEvidence = {
  sectionActivity: Map<string, VocalSectionActivity>;
  activityCurve: VocalActivitySlice[];
};

function aggregateVocalEvidence(stems: Array<{ analysis: Json }>): VocalEvidence {
  const sectionTotals = new Map<string, { activeRatio: number; energy: number; rhythmicActivity: number; count: number }>();
  const curveTotals = new Map<string, { startMs: number; endMs: number; activeRatio: number; energy: number; rhythmicActivity: number; count: number }>();
  for (const stem of stems) {
    const analysis = record(stem.analysis);
    const rows = Array.isArray(analysis.section_activity) ? analysis.section_activity : [];
    for (const raw of rows) {
      const row = record(raw);
      const id = typeof row.section_id === "string" ? row.section_id : "";
      if (!id) continue;
      const current = sectionTotals.get(id) ?? { activeRatio: 0, energy: 0, rhythmicActivity: 0, count: 0 };
      current.activeRatio += clamp(numeric(row.active_ratio));
      current.energy += clamp(numeric(row.energy));
      current.rhythmicActivity += clamp(numeric(row.rhythmic_activity));
      current.count += 1;
      sectionTotals.set(id, current);
    }

    const curve = Array.isArray(analysis.activity_curve) ? analysis.activity_curve : [];
    for (const raw of curve) {
      const row = record(raw);
      const startMs = Math.max(0, Math.round(numeric(row.start_ms, -1)));
      const endMs = Math.max(startMs + 1, Math.round(numeric(row.end_ms, -1)));
      if (startMs < 0 || endMs <= startMs) continue;
      const key = `${startMs}:${endMs}`;
      const current = curveTotals.get(key) ?? { startMs, endMs, activeRatio: 0, energy: 0, rhythmicActivity: 0, count: 0 };
      current.activeRatio += clamp(numeric(row.active_ratio));
      current.energy += clamp(numeric(row.energy));
      current.rhythmicActivity += clamp(numeric(row.rhythmic_activity));
      current.count += 1;
      curveTotals.set(key, current);
    }
  }

  const sectionActivity = new Map<string, VocalSectionActivity>();
  for (const [id, value] of sectionTotals) {
    const divisor = Math.max(1, value.count);
    sectionActivity.set(id, {
      activeRatio: clamp(value.activeRatio / divisor),
      energy: clamp(value.energy / divisor),
      rhythmicActivity: clamp(value.rhythmicActivity / divisor),
    });
  }
  const activityCurve = [...curveTotals.values()]
    .map((value) => {
      const divisor = Math.max(1, value.count);
      return {
        startMs: value.startMs,
        endMs: value.endMs,
        activeRatio: clamp(value.activeRatio / divisor),
        energy: clamp(value.energy / divisor),
        rhythmicActivity: clamp(value.rhythmicActivity / divisor),
      } satisfies VocalActivitySlice;
    })
    .sort((a, b) => a.startMs - b.startMs);
  return { sectionActivity, activityCurve };
}

type AlignedLine = {
  id: string;
  sectionId: string;
  sectionKey: string;
  displayOrder: number;
  text: string;
  startMs: number;
  endMs: number;
};

function excerptLineWindow(sectionKey: string, excerpt: string, lines: AlignedLine[]) {
  const target = normalizeExcerpt(excerpt);
  const sectionLines = lines
    .filter((line) => line.sectionKey === sectionKey)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  if (!target || !sectionLines.length) return null;

  for (let start = 0; start < sectionLines.length; start += 1) {
    let combined = "";
    for (let end = start; end < sectionLines.length; end += 1) {
      combined = `${combined} ${normalizeExcerpt(sectionLines[end].text)}`.trim();
      if (combined === target || combined.includes(target) || target.includes(combined)) {
        return { startMs: sectionLines[start].startMs, endMs: sectionLines[end].endMs };
      }
      if (combined.length > target.length * 2.4 + 24) break;
    }
  }
  return null;
}

async function alignSectionsToMusic({
  db,
  trackId,
  ownerId,
  sections,
}: {
  db: SupabaseClient<LyricsDatabase>;
  trackId: string;
  ownerId: string;
  sections: TrackLyricSection[];
}) {
  const musicDb = db as unknown as SupabaseClient<StemDatabase>;
  const [musicResult, vocalsResult] = await Promise.all([
    musicDb.from("track_music_intelligence")
      .select("analysis_version,source_audio_url,analysis")
      .eq("track_id", trackId)
      .eq("owner_id", ownerId)
      .maybeSingle(),
    musicDb.from("track_stems")
      .select("analysis")
      .eq("track_id", trackId)
      .eq("owner_id", ownerId)
      .eq("category", "vocals")
      .eq("status", "ready"),
  ]);
  if (musicResult.error) throw new Error(musicResult.error.message);
  if (vocalsResult.error) throw new Error(vocalsResult.error.message);
  const musicIntelligence = musicResult.data;
  const map = parseMusicMap(musicIntelligence?.analysis);
  if (!map) return { sections, map: null, analysisVersion: null, sourceAudioUrl: null, alignedLines: [] as AlignedLine[], lineAlignmentMethod: "none" as const };

  const vocalEvidence = aggregateVocalEvidence((vocalsResult.data ?? []) as Array<{ analysis: Json }>);
  const automaticSections = sections.filter((section) => section.timing_source !== "manual");
  const decisions = alignLyricSectionsMonotonically(automaticSections, map.sections, vocalEvidence.sectionActivity);
  const decisionBySection = new Map(decisions.map((decision) => [decision.lyricSectionId, decision]));

  for (const section of automaticSections) {
    const decision = decisionBySection.get(section.id);
    const match = decision?.musicSection ?? null;
    const updatePayload = match
      ? {
          start_ms: match.start_ms,
          end_ms: match.end_ms,
          timing_source: "music_intelligence" as const,
          music_section_id: match.id,
        }
      : {
          start_ms: null,
          end_ms: null,
          timing_source: null,
          music_section_id: null,
        };
    const { error: updateError } = await db.from("track_lyric_sections")
      .update(updatePayload)
      .eq("id", section.id)
      .eq("owner_id", ownerId);
    if (updateError) throw new Error(updateError.message);
    section.start_ms = match?.start_ms ?? null;
    section.end_ms = match?.end_ms ?? null;
    section.timing_source = match ? "music_intelligence" : null;
    section.music_section_id = match?.id ?? null;
  }

  const { data: rawLines, error: linesError } = await db.from("track_lyric_lines")
    .select("id,section_id,display_order,text,start_ms,end_ms,timing_source")
    .eq("owner_id", ownerId)
    .in("section_id", sections.map((section) => section.id));
  if (linesError) throw new Error(linesError.message);
  const alignedLines: AlignedLine[] = [];

  for (const section of sections) {
    const sectionLines = (rawLines ?? []).filter((line) => line.section_id === section.id);
    if (section.timing_source === "manual") {
      for (const line of sectionLines) {
        if (line.start_ms !== null && line.end_ms !== null) {
          alignedLines.push({
            id: line.id,
            sectionId: section.id,
            sectionKey: section.section_key,
            displayOrder: line.display_order,
            text: line.text,
            startMs: line.start_ms,
            endMs: line.end_ms,
          });
        }
      }
      continue;
    }
    if (section.start_ms === null || section.end_ms === null) {
      const ids = sectionLines.filter((line) => line.timing_source !== "manual").map((line) => line.id);
      if (ids.length) {
        const cleared = await db.from("track_lyric_lines")
          .update({ start_ms: null, end_ms: null, timing_source: null })
          .in("id", ids)
          .eq("owner_id", ownerId);
        if (cleared.error) throw new Error(cleared.error.message);
      }
      continue;
    }

    const derived = alignLyricLinesToVocalActivity(
      section.start_ms,
      section.end_ms,
      sectionLines.map((line) => ({ id: line.id, display_order: line.display_order, text: line.text })),
      vocalEvidence.activityCurve,
    );
    for (const timing of derived) {
      const source = sectionLines.find((line) => line.id === timing.id);
      if (!source || source.timing_source === "manual") continue;
      const updated = await db.from("track_lyric_lines")
        .update({ start_ms: timing.startMs, end_ms: timing.endMs, timing_source: "alignment" })
        .eq("id", timing.id)
        .eq("owner_id", ownerId);
      if (updated.error) throw new Error(updated.error.message);
      alignedLines.push({
        id: source.id,
        sectionId: section.id,
        sectionKey: section.section_key,
        displayOrder: source.display_order,
        text: source.text,
        startMs: timing.startMs,
        endMs: timing.endMs,
      });
    }
  }

  // Defensive invariant: derived lyric section timing must always be monotonic.
  const timed = sections
    .filter((section) => section.start_ms !== null && section.end_ms !== null)
    .sort((a, b) => a.display_order - b.display_order);
  for (let index = 1; index < timed.length; index += 1) {
    if (timed[index].start_ms! < timed[index - 1].start_ms!) {
      throw new Error(`Lyrics timing invariant violated between ${timed[index - 1].section_key} and ${timed[index].section_key}.`);
    }
  }

  return {
    sections,
    map,
    analysisVersion: musicIntelligence?.analysis_version ?? null,
    sourceAudioUrl: musicIntelligence?.source_audio_url ?? null,
    alignedLines,
    lineAlignmentMethod: vocalEvidence.activityCurve.length ? "vocal_activity" as const : "text_weighted" as const,
    sectionAlignmentScores: new Map(decisions.map((decision) => [decision.lyricSectionId, decision.score])),
  };
}

export async function analyzeTrackLyrics({
  db,
  ownerId,
  trackId,
  releaseId,
  cacheMode = "use",
}: {
  db: SupabaseClient<LyricsDatabase>;
  ownerId: string;
  trackId: string;
  releaseId: string;
  cacheMode?: "use" | "refresh" | "off";
}) {
  const { data: lyrics, error: lyricsError } = await db.from("track_lyrics")
    .select("*")
    .eq("track_id", trackId)
    .eq("owner_id", ownerId)
    .single();
  if (lyricsError || !lyrics) throw new Error(lyricsError?.message || "Official lyrics not found.");
  const document = lyrics as TrackLyrics;
  if (document.status === "instrumental") throw new Error("Instrumental tracks do not need Lyrics Intelligence analysis.");
  if (!document.allow_ai_context) throw new Error("Enable 'Use lyrics for creative intelligence' before analyzing Lyrics Intelligence.");

  const { data: sections, error: sectionsError } = await db.from("track_lyric_sections")
    .select("*")
    .eq("lyrics_id", document.id)
    .eq("lyrics_version", document.version)
    .eq("owner_id", ownerId)
    .order("display_order");
  if (sectionsError) throw new Error(sectionsError.message);
  const currentSections = (sections ?? []) as TrackLyricSection[];
  if (!currentSections.length) throw new Error("Lyrics structure is missing. Save the official lyrics again before analyzing.");
  const validKeys = new Set(currentSections.map((section) => section.section_key));

  const inputContext = {
    releaseId,
    trackId,
    lyricsId: document.id,
    lyricsVersion: document.version,
    declaredLanguage: document.language,
    officialLyrics: document.canonical_text,
    sections: currentSections.map((section) => ({
      section_key: section.section_key,
      current_type: section.section_type,
      current_label: section.label,
      text: section.text,
    })),
  };

  const result = await runAtlasAiTask<LyricsAnalysisPayload>({
    ownerId,
    task: "music.lyrics_analysis",
    purpose: "lyrics_intelligence",
    releaseId,
    promptVersion: LYRICS_PROMPT_VERSION,
    schema: LYRICS_ANALYSIS_SCHEMA,
    instructions: ANALYSIS_INSTRUCTIONS,
    input: JSON.stringify(inputContext),
    inputContext: { releaseId, trackId, lyricsId: document.id, lyricsVersion: document.version },
    cacheMode,
    qualityGate: (value) => {
      const annotationKeys = value.section_annotations.map((annotation) => annotation.section_key);
      const exactAnnotations = annotationKeys.length === currentSections.length
        && annotationKeys.every((key, index) => key === currentSections[index]?.section_key);
      const exactHooks = value.hook_phrases.every((hook) => excerptExists(hook.text, document.canonical_text));
      const exactMoments = value.moments.every((moment) => validKeys.has(moment.section_key) && excerptExists(moment.excerpt, document.canonical_text));
      return strictQualityResult([
        { passed: value.summary.trim().length >= 40, failure: "Lyrics summary is too thin." },
        { passed: value.core_meaning.trim().length >= 30, failure: "Core meaning is too thin." },
        { passed: exactAnnotations, failure: "Lyrics section annotations do not map exactly to the supplied structure." },
        { passed: exactHooks, failure: "A proposed lyric hook is not an exact excerpt from the official lyrics." },
        { passed: exactMoments, failure: "A proposed Lyric Moment is not grounded in an exact official lyric excerpt and section." },
      ]);
    },
    metadata: { lyricsVersion: document.version },
  });

  const analysis = result.value;
  const annotationByKey = new Map(analysis.section_annotations.map((annotation) => [annotation.section_key, annotation]));
  for (const section of currentSections) {
    const annotation = annotationByKey.get(section.section_key);
    if (!annotation) continue;
    const { error } = await db.from("track_lyric_sections")
      .update({
        section_type: annotation.section_type,
        label: annotation.label,
        confidence: clamp(annotation.confidence),
        is_primary_hook: annotation.is_primary_hook,
        structure_source: "ai",
      })
      .eq("id", section.id)
      .eq("owner_id", ownerId);
    if (error) throw new Error(error.message);
    section.section_type = annotation.section_type;
    section.label = annotation.label;
    section.confidence = clamp(annotation.confidence);
    section.is_primary_hook = annotation.is_primary_hook;
    section.structure_source = "ai";
  }

  const alignment = await alignSectionsToMusic({ db, trackId, ownerId, sections: currentSections });
  const sectionByKey = new Map(alignment.sections.map((section) => [section.section_key, section]));
  const candidates = alignment.map?.hook_candidates ?? [];

  const { error: analysisError } = await db.from("track_lyrics_analysis").upsert({
    lyrics_id: document.id,
    owner_id: ownerId,
    lyrics_version: document.version,
    prompt_version: LYRICS_PROMPT_VERSION,
    model: result.model,
    provider: result.provider,
    request_id: result.requestId,
    generation_run_id: result.runId,
    analysis: analysis as unknown as Json,
  }, { onConflict: "lyrics_id,lyrics_version" });
  if (analysisError) throw new Error(analysisError.message);

  const { error: deleteError } = await db.from("track_lyric_moments")
    .delete()
    .eq("lyrics_id", document.id)
    .eq("lyrics_version", document.version)
    .eq("owner_id", ownerId);
  if (deleteError) throw new Error(deleteError.message);

  const moments = analysis.moments
    .filter((moment) => validKeys.has(moment.section_key) && excerptExists(moment.excerpt, document.canonical_text))
    .slice(0, 10)
    .map((moment) => {
      const section = sectionByKey.get(moment.section_key);
      const musicalHook = section ? overlapCandidate(section, candidates) : null;
      const lineWindow = excerptLineWindow(moment.section_key, moment.excerpt, alignment.alignedLines);
      const aiScore = clamp(moment.score);
      const musicScore = musicalHook ? clamp(musicalHook.score) : null;
      const score = musicScore === null ? aiScore : clamp(aiScore * 0.65 + musicScore * 0.35);
      const startMs = lineWindow?.startMs ?? musicalHook?.start_ms ?? section?.start_ms ?? null;
      const endMs = lineWindow?.endMs ?? musicalHook?.end_ms ?? section?.end_ms ?? null;
      const timingSource = lineWindow
        ? "alignment" as const
        : startMs !== null && endMs !== null
          ? "music_intelligence" as const
          : null;
      return {
        lyrics_id: document.id,
        owner_id: ownerId,
        track_id: trackId,
        lyrics_version: document.version,
        section_key: moment.section_key,
        title: moment.title,
        excerpt: moment.excerpt,
        interpretation: moment.interpretation,
        purpose_tags: moment.purpose_tags,
        visual_directions: moment.visual_directions,
        score,
        allow_media: document.allow_media_quotes && (section?.allow_media ?? true),
        start_ms: startMs,
        end_ms: endMs,
        timing_source: timingSource,
        source_audio_url: startMs !== null ? alignment.sourceAudioUrl : null,
        music_analysis_version: startMs !== null ? alignment.analysisVersion : null,
        metadata: {
          ai_score: aiScore,
          music_hook_score: musicScore,
          music_hook_candidate_id: musicalHook?.id ?? null,
          music_section_id: section?.music_section_id ?? null,
          timing_method: lineWindow ? `${alignment.lineAlignmentMethod}_line_alignment` : "music_section_or_hook",
          section_alignment_score: section ? alignment.sectionAlignmentScores?.get(section.id) ?? null : null,
        } as Json,
      };
    });
  if (moments.length) {
    const { error } = await db.from("track_lyric_moments").insert(moments);
    if (error) throw new Error(error.message);
  }

  return {
    analysis,
    moments: moments.length,
    alignedSections: alignment.sections.filter((section) => section.timing_source === "music_intelligence").length,
    alignedLines: alignment.alignedLines.length,
    lineAlignmentMethod: alignment.lineAlignmentMethod,
    model: result.model,
    runId: result.runId,
    cacheHit: result.cacheHit,
  };
}
