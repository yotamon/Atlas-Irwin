import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import type { LyricsDatabase, TrackLyricLine, TrackLyricSection } from "@/types/lyrics-database";
import type { StemDatabase } from "@/types/stem-database";
import { runAIJSONTask } from "@/lib/ai/control-plane";
import { parseMusicMap, type MusicMap, type MusicMapSection } from "@/lib/video-director/creative-director";
import { parseStructuredLyrics } from "./parser";

function textHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function sectionTypeMatch(sectionType: string, musicType: string) {
  const lyric = sectionType.toLowerCase();
  const music = musicType.toLowerCase();
  if (lyric === music) return 1;
  if ((lyric === "chorus" || lyric === "hook") && ["chorus", "hook", "refrain", "drop"].includes(music)) return 0.86;
  if (lyric === "verse" && ["verse", "section", "a", "b"].includes(music)) return 0.62;
  if (lyric === "pre_chorus" && ["pre_chorus", "build", "bridge", "transition"].includes(music)) return 0.72;
  if (lyric === "bridge" && ["bridge", "breakdown", "transition"].includes(music)) return 0.7;
  if (lyric === "intro" && music === "intro") return 0.9;
  if (lyric === "outro" && music === "outro") return 0.9;
  return 0.2;
}

function vocalActivityBySection(
  map: MusicMap,
  vocalAnalyses: Json[],
) {
  const evidence = new Map<string, number>();
  for (const section of map.sections) evidence.set(section.id, 0.5);
  for (const analysis of vocalAnalyses) {
    if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) continue;
    const record = analysis as Record<string, unknown>;
    const regions = Array.isArray(record.regions) ? record.regions : [];
    for (const region of regions) {
      if (!region || typeof region !== "object" || Array.isArray(region)) continue;
      const typed = region as Record<string, unknown>;
      const start = Number(typed.start_ms);
      const end = Number(typed.end_ms);
      const activity = Number(typed.activity ?? typed.energy ?? typed.rms ?? 0.5);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      for (const section of map.sections) {
        const overlap = Math.max(0, Math.min(end, section.end_ms) - Math.max(start, section.start_ms));
        if (!overlap) continue;
        const ratio = overlap / Math.max(1, section.end_ms - section.start_ms);
        const current = evidence.get(section.id) ?? 0.5;
        evidence.set(section.id, clamp01(current * (1 - ratio) + clamp01(activity) * ratio));
      }
    }
  }
  return evidence;
}

type AlignmentDecision = {
  lyricSectionId: string;
  musicSection: MusicMapSection | null;
  score: number;
};

function alignLyricSectionsMonotonically(
  lyricSections: TrackLyricSection[],
  musicSections: MusicMapSection[],
  vocalActivity: Map<string, number>,
): AlignmentDecision[] {
  if (!lyricSections.length || !musicSections.length) return lyricSections.map((section) => ({ lyricSectionId: section.id, musicSection: null, score: 0 }));
  const n = lyricSections.length;
  const m = musicSections.length;
  const NEG = -1e9;
  const dp = Array.from({ length: n }, () => Array(m).fill(NEG));
  const prev = Array.from({ length: n }, () => Array(m).fill(-1));

  const compatibility = (i: number, j: number) => {
    const lyric = lyricSections[i];
    const music = musicSections[j];
    const type = sectionTypeMatch(lyric.section_type, music.type);
    const lyricPosition = n === 1 ? 0.5 : i / Math.max(1, n - 1);
    const musicPosition = m === 1 ? 0.5 : j / Math.max(1, m - 1);
    const position = 1 - Math.min(1, Math.abs(lyricPosition - musicPosition));
    const vocal = vocalActivity.get(music.id) ?? 0.5;
    const hookBonus = lyric.is_primary_hook && ["chorus", "hook", "refrain", "drop"].includes(music.type.toLowerCase()) ? 0.18 : 0;
    return type * 0.46 + position * 0.26 + vocal * 0.18 + clamp01(music.energy) * 0.1 + hookBonus;
  };

  for (let j = 0; j < m; j++) dp[0][j] = compatibility(0, j);
  for (let i = 1; i < n; i++) {
    for (let j = i; j < m; j++) {
      let best = NEG;
      let bestPrev = -1;
      for (let k = i - 1; k < j; k++) {
        const candidate = dp[i - 1][k];
        if (candidate > best) {
          best = candidate;
          bestPrev = k;
        }
      }
      if (best > NEG / 2) {
        dp[i][j] = best + compatibility(i, j);
        prev[i][j] = bestPrev;
      }
    }
  }

  let j = 0;
  let best = NEG;
  for (let candidate = n - 1; candidate < m; candidate++) {
    if (dp[n - 1][candidate] > best) {
      best = dp[n - 1][candidate];
      j = candidate;
    }
  }
  const assigned = Array(n).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    assigned[i] = j;
    j = prev[i][j];
  }
  return lyricSections.map((section, index) => ({
    lyricSectionId: section.id,
    musicSection: assigned[index] >= 0 ? musicSections[assigned[index]] : null,
    score: assigned[index] >= 0 ? compatibility(index, assigned[index]) : 0,
  }));
}

function aggregateVocalEvidence(vocalRows: Array<{ analysis: Json }>) {
  return {
    analyses: vocalRows.map((row) => row.analysis),
    sectionActivity: new Map<string, number>(),
  };
}

type AlignedLine = {
  lineId: string;
  startMs: number;
  endMs: number;
  confidence: number;
};

async function alignLyricsToMusic({
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
  const map = parseMusicMap(musicIntelligence?.analysis ?? {});
  if (!map) return { sections, map: null, analysisVersion: null, sourceAudioUrl: null, alignedLines: [] as AlignedLine[], lineAlignmentMethod: "none" as const };

  const vocalEvidence = aggregateVocalEvidence((vocalsResult.data ?? []) as Array<{ analysis: Json }>);
  vocalEvidence.sectionActivity = vocalActivityBySection(map, vocalEvidence.analyses);
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
          timing_source: "music_intelligence",
          timing_confidence: clamp01((decision?.score ?? 0) * 0.82 + (match.confidence ?? 0.6) * 0.18),
          updated_at: new Date().toISOString(),
        }
      : {
          start_ms: null,
          end_ms: null,
          timing_source: "unresolved",
          timing_confidence: null,
          updated_at: new Date().toISOString(),
        };
    const { error } = await db.from("track_lyric_sections").update(updatePayload).eq("id", section.id).eq("owner_id", ownerId);
    if (error) throw new Error(error.message);
  }

  const { data: updatedSections, error: updatedError } = await db.from("track_lyric_sections")
    .select("*")
    .eq("track_id", trackId)
    .eq("owner_id", ownerId)
    .order("display_order");
  if (updatedError) throw new Error(updatedError.message);
  const alignedSections = (updatedSections ?? []) as TrackLyricSection[];

  const alignedLines: AlignedLine[] = [];
  for (const section of alignedSections) {
    if (section.start_ms === null || section.end_ms === null || section.end_ms <= section.start_ms) continue;
    const { data: sectionLines, error: linesError } = await db.from("track_lyric_lines")
      .select("*")
      .eq("section_id", section.id)
      .eq("owner_id", ownerId)
      .order("display_order");
    if (linesError) throw new Error(linesError.message);
    const lines = (sectionLines ?? []) as TrackLyricLine[];
    if (!lines.length) continue;
    const automaticLines = lines.filter((line) => line.timing_source !== "manual");
    if (!automaticLines.length) continue;
    const totalChars = automaticLines.reduce((sum, line) => sum + Math.max(1, normalizeSpace(line.text).length), 0);
    let cursor = section.start_ms;
    for (let index = 0; index < automaticLines.length; index++) {
      const line = automaticLines[index];
      const isLast = index === automaticLines.length - 1;
      const duration = isLast
        ? section.end_ms - cursor
        : Math.max(180, Math.round((section.end_ms - section.start_ms) * (Math.max(1, normalizeSpace(line.text).length) / totalChars)));
      const end = isLast ? section.end_ms : Math.min(section.end_ms, cursor + duration);
      const confidence = clamp01((section.timing_confidence ?? 0.55) * 0.86);
      const { error: lineError } = await db.from("track_lyric_lines").update({
        start_ms: cursor,
        end_ms: end,
        timing_source: "section_interpolation",
        timing_confidence: confidence,
        updated_at: new Date().toISOString(),
      }).eq("id", line.id).eq("owner_id", ownerId);
      if (lineError) throw new Error(lineError.message);
      alignedLines.push({ lineId: line.id, startMs: cursor, endMs: end, confidence });
      cursor = end;
    }
  }

  return {
    sections: alignedSections,
    map,
    analysisVersion: musicIntelligence?.analysis_version ?? null,
    sourceAudioUrl: musicIntelligence?.source_audio_url ?? null,
    alignedLines,
    lineAlignmentMethod: "section_interpolation" as const,
  };
}

export async function analyzeLyrics(input: {
  db: SupabaseClient<LyricsDatabase>;
  trackId: string;
  ownerId: string;
  lyricsText: string;
}) {
  const parsed = parseStructuredLyrics(input.lyricsText);
  const sourceHash = textHash(input.lyricsText);
  const { data: lyricDocument, error: documentError } = await input.db.from("track_lyrics")
    .select("*")
    .eq("track_id", input.trackId)
    .eq("owner_id", input.ownerId)
    .maybeSingle();
  if (documentError) throw new Error(documentError.message);
  const version = (lyricDocument?.version ?? 0) + 1;

  const { data: storedLyrics, error: lyricsError } = await input.db.from("track_lyrics").upsert({
    owner_id: input.ownerId,
    track_id: input.trackId,
    raw_text: input.lyricsText,
    normalized_text: parsed.normalizedText,
    source_hash: sourceHash,
    version,
    analysis_status: "analyzing",
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id,track_id" }).select("*").single();
  if (lyricsError || !storedLyrics) throw new Error(lyricsError?.message || "Could not store lyrics.");

  await input.db.from("track_lyric_sections").delete().eq("track_id", input.trackId).eq("owner_id", input.ownerId);
  const sectionRows = parsed.sections.map((section, index) => ({
    owner_id: input.ownerId,
    track_id: input.trackId,
    lyrics_id: storedLyrics.id,
    section_key: section.key,
    section_type: section.type,
    label: section.label,
    display_order: index,
    raw_text: section.lines.map((line) => line.text).join("\n"),
    start_ms: null,
    end_ms: null,
    timing_source: "unresolved",
    timing_confidence: null,
    is_primary_hook: false,
  }));
  const { data: sections, error: sectionError } = await input.db.from("track_lyric_sections").insert(sectionRows).select("*");
  if (sectionError) throw new Error(sectionError.message);

  const insertedSections = (sections ?? []) as TrackLyricSection[];
  const sectionByKey = new Map(insertedSections.map((section) => [section.section_key, section]));
  const lineRows = parsed.sections.flatMap((section) => {
    const storedSection = sectionByKey.get(section.key);
    if (!storedSection) return [];
    return section.lines.map((line, index) => ({
      owner_id: input.ownerId,
      track_id: input.trackId,
      lyrics_id: storedLyrics.id,
      section_id: storedSection.id,
      display_order: index,
      text: line.text,
      normalized_text: normalizeSpace(line.text),
      start_ms: null,
      end_ms: null,
      timing_source: "unresolved",
      timing_confidence: null,
    }));
  });
  if (lineRows.length) {
    const { error: lineError } = await input.db.from("track_lyric_lines").insert(lineRows);
    if (lineError) throw new Error(lineError.message);
  }

  const aligned = await alignLyricsToMusic({
    db: input.db,
    trackId: input.trackId,
    ownerId: input.ownerId,
    sections: insertedSections,
  });

  const aiResult = await runAIJSONTask({
    task: "lyrics_analysis",
    ownerId: input.ownerId,
    artistId: null,
    input: {
      lyrics: parsed.normalizedText,
      sections: aligned.sections.map((section) => ({
        key: section.section_key,
        label: section.label,
        type: section.section_type,
        start_ms: section.start_ms,
        end_ms: section.end_ms,
      })),
    },
    fallback: () => ({
      language: "unknown",
      themes: [],
      emotions: [],
      imagery: [],
      narrative_summary: "",
      hooks: [],
    }),
  });

  const analysis = aiResult.value && typeof aiResult.value === "object" && !Array.isArray(aiResult.value)
    ? aiResult.value as Record<string, Json>
    : {};
  const { error: updateError } = await input.db.from("track_lyrics").update({
    language: typeof analysis.language === "string" ? analysis.language : null,
    themes: Array.isArray(analysis.themes) ? analysis.themes : [],
    emotions: Array.isArray(analysis.emotions) ? analysis.emotions : [],
    imagery: Array.isArray(analysis.imagery) ? analysis.imagery : [],
    narrative_summary: typeof analysis.narrative_summary === "string" ? analysis.narrative_summary : null,
    analysis_status: "ready",
    analysis_version: aiResult.runId,
    updated_at: new Date().toISOString(),
  }).eq("id", storedLyrics.id).eq("owner_id", input.ownerId);
  if (updateError) throw new Error(updateError.message);

  return {
    lyricsId: storedLyrics.id,
    version,
    sourceHash,
    alignment: aligned,
    analysis,
  };
}
