import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(path, "utf8");
}

test("canonical lyrics are versioned human truth with immutable revision history", async () => {
  const migration = await source("supabase/migrations/20260901160000_lyrics_intelligence.sql");
  const hardening = await source("supabase/migrations/20260901160100_lyrics_intelligence_hardening.sql");

  assert.ok(migration.includes("create table public.track_lyrics"));
  assert.ok(migration.includes("canonical_text text not null"));
  assert.ok(migration.includes("version integer not null default 1"));
  assert.ok(migration.includes("allow_ai_context boolean not null default true"));
  assert.ok(migration.includes("allow_media_quotes boolean not null default true"));
  assert.ok(migration.includes("create table public.track_lyrics_revisions"));
  assert.ok(migration.includes("create or replace function public.save_track_lyrics"));
  assert.ok(migration.includes("v_old.version + 1"));
  assert.ok(hardening.includes("Immutable canonical lyrics revision history"));
  assert.ok(hardening.includes("revoke insert, update, delete on public.track_lyrics_revisions from authenticated"));
});

test("master replacement preserves words and semantics while invalidating only derived lyric timing", async () => {
  const migration = await source("supabase/migrations/20260901160000_lyrics_intelligence.sql");
  const start = migration.indexOf("create or replace function private.invalidate_lyric_timing_on_audio_change");
  const end = migration.indexOf("drop trigger if exists invalidate_lyric_timing_on_audio_change");
  assert.ok(start >= 0 && end > start);
  const invalidation = migration.slice(start, end);

  assert.ok(invalidation.includes("track_lyric_sections"));
  assert.ok(invalidation.includes("track_lyric_lines"));
  assert.ok(invalidation.includes("track_lyric_moments"));
  assert.ok(invalidation.includes("timing_source in ('music_intelligence','alignment')"));
  assert.equal(invalidation.includes("delete from public.track_lyrics"), false);
  assert.equal(invalidation.includes("delete from public.track_lyrics_analysis"), false);
  assert.equal(invalidation.includes("canonical_text"), false);
});

test("Lyrics Intelligence never silently invents public lyric text", async () => {
  const domain = await source("lib/lyrics-intelligence/domain.ts");
  const analyzer = await source("lib/lyrics-intelligence/analyze.ts");
  const context = await source("lib/lyrics-intelligence/context.ts");

  assert.ok(domain.includes("excerptExists"));
  assert.ok(analyzer.includes("MUST be an exact excerpt that appears in the official lyrics"));
  assert.ok(analyzer.includes("excerptExists(hook.text, document.canonical_text)"));
  assert.ok(analyzer.includes("excerptExists(moment.excerpt, document.canonical_text)"));
  assert.ok(context.includes("mayQuote"));
  assert.ok(context.includes("Never invent or paraphrase text as if it were a lyric"));
  assert.ok(context.includes("Do not display, quote or reconstruct lyric text"));
});

test("Lyric Moments fuse semantic usefulness with Track Intelligence timing and hook strength", async () => {
  const analyzer = await source("lib/lyrics-intelligence/analyze.ts");

  assert.ok(analyzer.includes("alignSectionsToMusic"));
  assert.ok(analyzer.includes("music_section_id"));
  assert.ok(analyzer.includes("overlapCandidate"));
  assert.ok(analyzer.includes("aiScore * 0.65 + musicScore * 0.35"));
  assert.ok(analyzer.includes("music_hook_candidate_id"));
  assert.ok(analyzer.includes("music_analysis_version"));
  assert.ok(analyzer.includes("source_audio_url"));
});

test("release UX treats Lyrics Intelligence as part of the same source-material workflow", async () => {
  const masterPanel = await source("components/studio/release-master-audio-panel.tsx");
  const lyricsPanel = await source("components/studio/lyrics-intelligence-panel.tsx");
  const actions = await source("app/studio/lyrics-actions.ts");

  assert.ok(masterPanel.includes("<StemIntelligencePanel"));
  assert.ok(masterPanel.includes("<LyricsIntelligencePanel"));
  assert.ok(lyricsPanel.includes("Save & analyze lyrics"));
  assert.ok(lyricsPanel.includes("Mark as instrumental"));
  assert.ok(lyricsPanel.includes("Use lyrics for creative intelligence"));
  assert.ok(lyricsPanel.includes("Allow exact lyric excerpts in generated media"));
  assert.ok(actions.includes("save_track_lyrics"));
  assert.ok(actions.includes("analyzeTrackLyrics"));
});

test("Marketing, stems, and lyrics share one creative context instead of parallel feature silos", async () => {
  const creative = await source("lib/marketing/creative-context.ts");
  const marketingAi = await source("lib/marketing/ai.ts");

  assert.ok(creative.includes("lyrics: TrackLyricsContext"));
  assert.ok(creative.includes("loadTrackLyricsContext"));
  assert.ok(creative.includes("lyricSceneContext"));
  assert.ok(creative.includes("Lyrics Intelligence and musical intent"));
  assert.ok(creative.includes("LYRICAL / NARRATIVE DIRECTION:"));
  assert.ok(creative.includes("MUSICAL DIRECTION:"));
  assert.ok(marketingAi.includes("enrichMarketingContextWithLyrics"));
  assert.ok(marketingAi.includes("lyricsIntelligence"));
  assert.ok(marketingAi.includes("marketing-v3-lyrics"));
  assert.ok(marketingAi.includes("Quote only excerpts explicitly supplied with mayQuote=true"));
});

test("Video Director consumes Lyrics, Track, and Stem Intelligence together", async () => {
  const context = await source("lib/video-director/context.ts");
  const directorTypes = await source("lib/video-director/creative-director.ts");
  const director = await source("lib/video-director/openai-director.ts");

  assert.ok(context.includes("loadTrackLyricsContext"));
  assert.ok(context.includes("stemAwareMusicMap"));
  assert.ok(directorTypes.includes("lyrics: TrackLyricsContext"));
  assert.ok(director.includes("lyrics_intelligence: conciseLyricsPromptContext(context.lyrics)"));
  assert.ok(director.includes("combine that timing with the music map and stem-aware Audio Scenes"));
  assert.ok(director.includes("mayQuote=true"));
});

test("Lyrics analysis uses the shared Atlas AI Control Plane", async () => {
  const tasks = await source("lib/ai/tasks.ts");
  const analyzer = await source("lib/lyrics-intelligence/analyze.ts");

  assert.ok(tasks.includes('"music.lyrics_analysis"'));
  assert.ok(tasks.includes('label: "Lyrics Intelligence"'));
  assert.ok(analyzer.includes("runAtlasAiTask<LyricsAnalysisPayload>"));
  assert.ok(analyzer.includes('task: "music.lyrics_analysis"'));
  assert.ok(analyzer.includes("LYRICS_PROMPT_VERSION"));
});