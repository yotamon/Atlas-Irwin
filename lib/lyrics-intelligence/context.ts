import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asLyricsAnalysis } from "./domain";
import type {
  LyricsDatabase,
  TrackLyricMoment,
  TrackLyricSection,
  TrackLyrics,
  TrackLyricsAnalysis,
} from "@/types/lyrics-database";

export type CreativeLyricMoment = {
  id: string;
  title: string;
  excerpt: string;
  interpretation: string;
  sectionKey: string | null;
  startMs: number | null;
  endMs: number | null;
  score: number;
  purposeTags: string[];
  visualDirections: string[];
  mayQuote: boolean;
};

export type TrackLyricsContext = {
  available: boolean;
  instrumental: boolean;
  verified: boolean;
  version: number | null;
  analyzedVersion: number | null;
  analysisCurrent: boolean;
  language: string | null;
  allowAiContext: boolean;
  allowMediaQuotes: boolean;
  summary: string;
  coreMeaning: string;
  themes: string[];
  emotionalArc: Array<{ stage: string; description: string }>;
  imagery: string[];
  motifs: string[];
  perspective: string;
  chorusMeaning: string;
  hooks: Array<{ text: string; reason: string; score: number; mayQuote: boolean }>;
  sections: Array<{
    key: string;
    type: string;
    label: string;
    isPrimaryHook: boolean;
    startMs: number | null;
    endMs: number | null;
    musicSectionId: string | null;
    mayQuote: boolean;
  }>;
  moments: CreativeLyricMoment[];
};

export const EMPTY_LYRICS_CONTEXT: TrackLyricsContext = {
  available: false,
  instrumental: false,
  verified: false,
  version: null,
  analyzedVersion: null,
  analysisCurrent: false,
  language: null,
  allowAiContext: false,
  allowMediaQuotes: false,
  summary: "",
  coreMeaning: "",
  themes: [],
  emotionalArc: [],
  imagery: [],
  motifs: [],
  perspective: "",
  chorusMeaning: "",
  hooks: [],
  sections: [],
  moments: [],
};

function momentContext(moment: TrackLyricMoment, allowMediaQuotes: boolean, section?: TrackLyricSection): CreativeLyricMoment {
  return {
    id: moment.id,
    title: moment.title,
    excerpt: moment.excerpt,
    interpretation: moment.interpretation,
    sectionKey: moment.section_key,
    startMs: moment.start_ms,
    endMs: moment.end_ms,
    score: moment.score,
    purposeTags: moment.purpose_tags,
    visualDirections: moment.visual_directions,
    mayQuote: allowMediaQuotes && moment.allow_media && (section?.allow_media ?? true),
  };
}

export async function loadTrackLyricsContext(
  db: SupabaseClient<LyricsDatabase>,
  trackId: string,
  ownerId: string,
): Promise<TrackLyricsContext> {
  const { data: lyrics, error } = await db.from("track_lyrics")
    .select("*")
    .eq("track_id", trackId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lyrics) return EMPTY_LYRICS_CONTEXT;

  const document = lyrics as TrackLyrics;
  if (document.status === "instrumental") {
    return {
      ...EMPTY_LYRICS_CONTEXT,
      available: true,
      instrumental: true,
      verified: true,
      version: document.version,
      language: document.language,
      allowAiContext: false,
      allowMediaQuotes: false,
    };
  }

  const [sectionResult, analysisResult, momentResult] = await Promise.all([
    db.from("track_lyric_sections")
      .select("*")
      .eq("lyrics_id", document.id)
      .eq("lyrics_version", document.version)
      .order("display_order"),
    db.from("track_lyrics_analysis")
      .select("*")
      .eq("lyrics_id", document.id)
      .eq("lyrics_version", document.version)
      .maybeSingle(),
    db.from("track_lyric_moments")
      .select("*")
      .eq("lyrics_id", document.id)
      .eq("lyrics_version", document.version)
      .order("score", { ascending: false })
      .limit(8),
  ]);
  const firstError = sectionResult.error || analysisResult.error || momentResult.error;
  if (firstError) throw new Error(firstError.message);

  const sections = (sectionResult.data ?? []) as TrackLyricSection[];
  const analysisRow = analysisResult.data as TrackLyricsAnalysis | null;
  const analysis = asLyricsAnalysis(analysisRow?.analysis);
  const sectionByKey = new Map(sections.map((section) => [section.section_key, section]));
  const mayUseSemantics = document.allow_ai_context && Boolean(analysis);
  const mayQuote = document.allow_media_quotes;

  return {
    available: true,
    instrumental: false,
    verified: document.status === "verified",
    version: document.version,
    analyzedVersion: analysisRow?.lyrics_version ?? null,
    analysisCurrent: Boolean(analysisRow && analysisRow.lyrics_version === document.version),
    language: document.language || analysis?.language || null,
    allowAiContext: document.allow_ai_context,
    allowMediaQuotes: document.allow_media_quotes,
    summary: mayUseSemantics ? analysis?.summary ?? "" : "",
    coreMeaning: mayUseSemantics ? analysis?.core_meaning ?? "" : "",
    themes: mayUseSemantics ? analysis?.themes ?? [] : [],
    emotionalArc: mayUseSemantics ? analysis?.emotional_arc ?? [] : [],
    imagery: mayUseSemantics ? analysis?.imagery ?? [] : [],
    motifs: mayUseSemantics ? analysis?.motifs ?? [] : [],
    perspective: mayUseSemantics ? analysis?.perspective ?? "" : "",
    chorusMeaning: mayUseSemantics ? analysis?.chorus_meaning ?? "" : "",
    hooks: mayUseSemantics
      ? (analysis?.hook_phrases ?? []).slice(0, 6).map((hook) => ({ ...hook, mayQuote }))
      : [],
    sections: sections.map((section) => ({
      key: section.section_key,
      type: section.section_type,
      label: section.label,
      isPrimaryHook: section.is_primary_hook,
      startMs: section.start_ms,
      endMs: section.end_ms,
      musicSectionId: section.music_section_id,
      mayQuote: mayQuote && section.allow_media,
    })),
    moments: mayUseSemantics
      ? ((momentResult.data ?? []) as TrackLyricMoment[]).map((moment) => momentContext(moment, mayQuote, moment.section_key ? sectionByKey.get(moment.section_key) : undefined))
      : [],
  };
}

export function conciseLyricsPromptContext(context: TrackLyricsContext) {
  if (!context.available) return { status: "missing" };
  if (context.instrumental) return { status: "instrumental" };
  return {
    status: context.verified ? "verified" : "draft",
    version: context.version,
    language: context.language,
    summary: context.summary,
    coreMeaning: context.coreMeaning,
    themes: context.themes.slice(0, 8),
    emotionalArc: context.emotionalArc.slice(0, 6),
    imagery: context.imagery.slice(0, 8),
    motifs: context.motifs.slice(0, 6),
    perspective: context.perspective,
    chorusMeaning: context.chorusMeaning,
    hooks: context.hooks.slice(0, 5).map((hook) => ({
      text: hook.mayQuote ? hook.text : undefined,
      reason: hook.reason,
      score: hook.score,
      mayQuote: hook.mayQuote,
    })),
    sections: context.sections.slice(0, 16),
    moments: context.moments.slice(0, 6).map((moment) => ({
      title: moment.title,
      excerpt: moment.mayQuote ? moment.excerpt : undefined,
      interpretation: moment.interpretation,
      startMs: moment.startMs,
      endMs: moment.endMs,
      score: moment.score,
      purposeTags: moment.purposeTags,
      visualDirections: moment.visualDirections,
      mayQuote: moment.mayQuote,
    })),
    usageRule: context.allowMediaQuotes
      ? "Lyrics may be quoted only from the supplied approved excerpts. Never invent or paraphrase text as if it were a lyric."
      : "Use lyrics only as semantic context. Do not display, quote or reconstruct lyric text in public creative.",
  };
}