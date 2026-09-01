import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { runAtlasAiTask } from "@/lib/ai/control-plane";
import { strictQualityResult } from "@/lib/ai/quality";
import { parseMusicMap, type MusicHookCandidate, type MusicMapSection } from "@/lib/video-director/creative-director";
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

function normalizedType(value: string) {
  return value.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z_]/g, "");
}

function sectionMatches(lyricType: string, section: MusicMapSection) {
  const expected = normalizedType(lyricType);
  return normalizedType(section.type) === expected || normalizedType(section.label).includes(expected);
}

function overlapCandidate(section: TrackLyricSection, candidates: MusicHookCandidate[]) {
  if (section.start_ms === null || section.end_ms === null) return null;
  return candidates
    .filter((candidate) => candidate.end_ms > section.start_ms! && candidate.start_ms < section.end_ms!)
    .sort((a, b) => b.score - a.score)[0] ?? null;
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
  const { data: musicIntelligence, error } = await musicDb.from("track_music_intelligence")
    .select("analysis_version,source_audio_url,analysis")
    .eq("track_id", trackId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const map = parseMusicMap(musicIntelligence?.analysis);
  if (!map) return { sections, map: null, analysisVersion: null, sourceAudioUrl: null };

  const available = [...map.sections].sort((a, b) => a.start_ms - b.start_ms);
  const used = new Set<string>();
  for (const section of sections) {
    if (section.timing_source === "manual") continue;
    const match = available.find((candidate) => !used.has(candidate.id) && sectionMatches(section.section_type, candidate));
    if (!match) continue;
    used.add(match.id);
    const { error: updateError } = await db.from("track_lyric_sections")
      .update({
        start_ms: match.start_ms,
        end_ms: match.end_ms,
        timing_source: "music_intelligence",
        music_section_id: match.id,
      })
      .eq("id", section.id)
      .eq("owner_id", ownerId);
    if (updateError) throw new Error(updateError.message);
    section.start_ms = match.start_ms;
    section.end_ms = match.end_ms;
    section.timing_source = "music_intelligence";
    section.music_section_id = match.id;
  }

  return {
    sections,
    map,
    analysisVersion: musicIntelligence?.analysis_version ?? null,
    sourceAudioUrl: musicIntelligence?.source_audio_url ?? null,
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
      const aiScore = clamp(moment.score);
      const musicScore = musicalHook ? clamp(musicalHook.score) : null;
      const score = musicScore === null ? aiScore : clamp(aiScore * 0.65 + musicScore * 0.35);
      const startMs = musicalHook?.start_ms ?? section?.start_ms ?? null;
      const endMs = musicalHook?.end_ms ?? section?.end_ms ?? null;
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
        timing_source: startMs !== null && endMs !== null ? "music_intelligence" as const : null,
        source_audio_url: startMs !== null ? alignment.sourceAudioUrl : null,
        music_analysis_version: startMs !== null ? alignment.analysisVersion : null,
        metadata: {
          ai_score: aiScore,
          music_hook_score: musicScore,
          music_hook_candidate_id: musicalHook?.id ?? null,
          music_section_id: section?.music_section_id ?? null,
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
    model: result.model,
    runId: result.runId,
    cacheHit: result.cacheHit,
  };
}