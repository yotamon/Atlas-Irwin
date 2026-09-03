import type { Database, Json } from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type LyricsStatus = "draft" | "verified" | "instrumental";
export type LyricSectionType =
  | "intro"
  | "verse"
  | "pre_chorus"
  | "chorus"
  | "post_chorus"
  | "bridge"
  | "refrain"
  | "hook"
  | "outro"
  | "other";
export type LyricStructureSource = "manual" | "parser" | "ai";
export type LyricTimingSource = "manual" | "music_intelligence" | "alignment";

export type TrackLyrics = {
  id: string;
  owner_id: string;
  artist_id: string;
  track_id: string;
  status: LyricsStatus;
  language: string | null;
  canonical_text: string;
  version: number;
  allow_ai_context: boolean;
  allow_media_quotes: boolean;
  created_at: string;
  updated_at: string;
};

export type TrackLyricsRevision = {
  id: string;
  lyrics_id: string;
  owner_id: string;
  artist_id: string;
  version: number;
  status: LyricsStatus;
  language: string | null;
  canonical_text: string;
  created_at: string;
  updated_at: string;
};

export type TrackLyricSection = {
  id: string;
  lyrics_id: string;
  owner_id: string;
  artist_id: string;
  lyrics_version: number;
  section_key: string;
  section_type: LyricSectionType;
  label: string;
  display_order: number;
  text: string;
  structure_source: LyricStructureSource;
  confidence: number | null;
  is_primary_hook: boolean;
  allow_media: boolean;
  start_ms: number | null;
  end_ms: number | null;
  timing_source: LyricTimingSource | null;
  music_section_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackLyricLine = {
  id: string;
  lyrics_id: string;
  section_id: string;
  owner_id: string;
  artist_id: string;
  lyrics_version: number;
  display_order: number;
  text: string;
  allow_media: boolean;
  start_ms: number | null;
  end_ms: number | null;
  timing_source: LyricTimingSource | null;
  created_at: string;
  updated_at: string;
};

export type TrackLyricsAnalysis = {
  id: string;
  lyrics_id: string;
  owner_id: string;
  artist_id: string;
  lyrics_version: number;
  prompt_version: string;
  model: string;
  provider: string;
  request_id: string | null;
  generation_run_id: string | null;
  analysis: Json;
  created_at: string;
  updated_at: string;
};

export type TrackLyricMoment = {
  id: string;
  lyrics_id: string;
  owner_id: string;
  artist_id: string;
  track_id: string;
  lyrics_version: number;
  section_key: string | null;
  title: string;
  excerpt: string;
  interpretation: string;
  purpose_tags: string[];
  visual_directions: string[];
  score: number;
  allow_media: boolean;
  start_ms: number | null;
  end_ms: number | null;
  timing_source: LyricTimingSource | null;
  source_audio_url: string | null;
  music_analysis_version: number | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

type ExistingTables = Database["public"]["Tables"];
type ExistingFunctions = Database["public"]["Functions"];

export type LyricsDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: ExistingTables & {
      track_lyrics: Table<TrackLyrics>;
      track_lyrics_revisions: Table<TrackLyricsRevision>;
      track_lyric_sections: Table<TrackLyricSection>;
      track_lyric_lines: Table<TrackLyricLine>;
      track_lyrics_analysis: Table<TrackLyricsAnalysis>;
      track_lyric_moments: Table<TrackLyricMoment>;
    };
    Functions: ExistingFunctions & {
      save_track_lyrics: {
        Args: {
          p_track_id: string;
          p_canonical_text: string;
          p_language: string | null;
          p_status: LyricsStatus;
          p_allow_ai_context: boolean;
          p_allow_media_quotes: boolean;
          p_sections: Json;
        };
        Returns: string;
      };
    };
  };
};

export type LyricsAnalysisPayload = {
  language: string;
  summary: string;
  core_meaning: string;
  themes: string[];
  emotional_arc: Array<{ stage: string; description: string }>;
  imagery: string[];
  motifs: string[];
  perspective: string;
  chorus_meaning: string;
  hook_phrases: Array<{ text: string; reason: string; score: number }>;
  visual_opportunities: Array<{ idea: string; lyric_reference: string; treatment: string }>;
  content_angles: Array<{ title: string; angle: string; lyric_reference: string }>;
  section_annotations: Array<{
    section_key: string;
    section_type: LyricSectionType;
    label: string;
    confidence: number;
    is_primary_hook: boolean;
  }>;
  moments: Array<{
    title: string;
    excerpt: string;
    section_key: string;
    interpretation: string;
    purpose_tags: string[];
    visual_directions: string[];
    score: number;
  }>;
};
