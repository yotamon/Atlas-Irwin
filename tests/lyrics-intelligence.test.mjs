import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function source(path) {
  return readFile(path, "utf8");
}

async function loadLyricsDomain() {
  const domain = await source("lib/lyrics-intelligence/domain.ts");
  const compiled = ts.transpileModule(domain, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(compiled, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const REALISTIC_SUNO_LYRICS = String.raw`[Intro]
My love
My love
My love

[Verse]
Saw you 'cross the room
You see me lookin' too
I'm like
"Oh my God
He's so damn fine"
Wonderin' if you think the same
Then I see you walk my way
Ooh
You're mine

[Chorus]
He said
"Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor
I'll see you at the dancefloor
Meet me at the dancefloor
I'll see you at the dancefloor
I'll see you at the dancefloor"
Mm-mm
My love

[Verse 2]
Oh
I can't get enough of it
The way that you move your hips
Dancin' all up on me
Boy
You got me fallin'
Oh
And now you look into my eyes
And I don't wanna say goodbye
You know I don't wanna leave
Baby
Keep on callin' me

[Chorus]
He said
"Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor
I'll see you at the dancefloor
Meet me at the dancefloor
I'll see you at the dancefloor
I'll see you at the dancefloor"

[Outro]
He said
"Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor"
Mm
He said
"Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor
Meet me at the dancefloor"
Mm-mm
My love`;

test("realistic Suno-style lyrics parse into stable sections without losing exact lines", async () => {
  const { parseLyrics, excerptExists } = await loadLyricsDomain();
  const sections = parseLyrics(REALISTIC_SUNO_LYRICS);

  assert.deepEqual(
    sections.map((section) => [section.section_key, section.section_type, section.label]),
    [
      ["intro_1", "intro", "Intro"],
      ["verse_1", "verse", "Verse"],
      ["chorus_1", "chorus", "Chorus"],
      ["verse_2", "verse", "Verse 2"],
      ["chorus_2", "chorus", "Chorus"],
      ["outro_1", "outro", "Outro"],
    ],
  );
  assert.equal(sections.length, 6);
  assert.equal(sections[0].lines.length, 3);
  assert.equal(sections[0].lines.every((line) => line.text === "My love"), true);
  assert.equal(sections[1].lines.some((line) => line.text === '"Oh my God'), true);
  assert.equal(sections[1].lines.some((line) => line.text === 'He\'s so damn fine"'), true);
  assert.equal(sections[3].lines.some((line) => line.text === "Oh"), true);
  assert.equal(sections[3].lines.some((line) => line.text === "Boy"), true);
  assert.equal(sections[5].lines.at(-1)?.text, "My love");

  assert.equal(excerptExists("Meet me at the dancefloor", REALISTIC_SUNO_LYRICS), true);
  assert.equal(excerptExists("I'll see you at the dancefloor", REALISTIC_SUNO_LYRICS), true);
  assert.equal(excerptExists("Saw you 'cross the room", REALISTIC_SUNO_LYRICS), true);
  assert.equal(excerptExists("Meet me under neon lights", REALISTIC_SUNO_LYRICS), false);
});

test("canonical lyrics are versioned human truth with immutable revision history and least privilege", async () => {
  const migration = await source("supabase/migrations/20260901130402_lyrics_intelligence.sql");
  const hardening = await source("supabase/migrations/20260901130501_lyrics_intelligence_hardening.sql");
  const privileges = await source("supabase/migrations/20260901130823_lyrics_intelligence_privilege_hardening.sql");

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
  assert.ok(privileges.includes("revoke all privileges on table"));
  assert.ok(privileges.includes("from anon, authenticated"));
  assert.ok(privileges.includes("public.track_lyrics_revisions"));
  assert.ok(privileges.includes("grant select on table"));
  assert.ok(privileges.includes("grant select, update on table public.track_lyric_sections to authenticated"));
  assert.ok(privileges.includes("grant select, insert, update on table public.track_lyrics_analysis to authenticated"));
  assert.ok(privileges.includes("grant select, insert, delete on table public.track_lyric_moments to authenticated"));
});

test("Lyrics Intelligence foreign keys remain indexed", async () => {
  const indexes = await source("supabase/migrations/20260901130933_lyrics_intelligence_fk_indexes.sql");
  for (const index of [
    "track_lyrics_revisions_owner_idx",
    "track_lyric_sections_owner_idx",
    "track_lyric_lines_lyrics_idx",
    "track_lyric_lines_owner_idx",
    "track_lyrics_analysis_owner_idx",
    "track_lyric_moments_lyrics_idx",
    "track_lyric_moments_owner_idx",
  ]) assert.ok(indexes.includes(index), `missing Lyrics Intelligence FK index ${index}`);
});

test("master replacement preserves words and semantics while invalidating only derived lyric timing", async () => {
  const migration = await source("supabase/migrations/20260901130402_lyrics_intelligence.sql");
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

test("Lyric timing is chronological, stale-safe, line-addressable, and fused with vocal evidence", async () => {
  const analyzer = await source("lib/lyrics-intelligence/analyze.ts");
  const timing = await source("lib/lyrics-intelligence/timing.ts");

  assert.ok(analyzer.includes("alignSectionsToMusic"));
  assert.ok(analyzer.includes("aggregateVocalActivity"));
  assert.ok(analyzer.includes("alignLyricSectionsMonotonically"));
  assert.ok(analyzer.includes("interpolateLyricLineTimings"));
  assert.ok(analyzer.includes('timing_source: "alignment"'));
  assert.ok(analyzer.includes("start_ms: null"));
  assert.ok(analyzer.includes("Lyrics timing invariant violated"));
  assert.ok(timing.includes("Globally aligns lyric sections to music sections while preserving chronology"));
  assert.ok(timing.includes("Unresolved is intentionally preferable"));
});

test("Lyric Moments fuse exact excerpt timing with Track Intelligence hook strength", async () => {
  const analyzer = await source("lib/lyrics-intelligence/analyze.ts");

  assert.ok(analyzer.includes("music_section_id"));
  assert.ok(analyzer.includes("overlapCandidate"));
  assert.ok(analyzer.includes("excerptLineWindow"));
  assert.ok(analyzer.includes("aiScore * 0.65 + musicScore * 0.35"));
  assert.ok(analyzer.includes("music_hook_candidate_id"));
  assert.ok(analyzer.includes("music_analysis_version"));
  assert.ok(analyzer.includes("source_audio_url"));
  assert.ok(analyzer.includes('timing_method: lineWindow ? "section_weighted_line_alignment"'));
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

test("unified Track Creative Intelligence graph fuses and diversifies master, lyric, stem and scene evidence", async () => {
  const graph = await source("lib/music-intelligence/creative-graph.ts");
  const loader = await source("lib/music-intelligence/creative-graph-loader.ts");

  assert.ok(graph.includes("TrackCreativeIntelligenceGraph"));
  assert.ok(graph.includes("seedsFromMaster"));
  assert.ok(graph.includes("seedsFromLyrics"));
  assert.ok(graph.includes("seedsFromScenes"));
  assert.ok(graph.includes("activeStemRoles"));
  assert.ok(graph.includes("multimodalBonus"));
  assert.ok(graph.includes("Diversity is a first-class requirement"));
  assert.ok(graph.includes("kindCount >= 3"));
  assert.ok(graph.includes("lyricSectionTimingCoverage"));
  assert.ok(graph.includes("stemTimelineConfidence"));
  assert.ok(graph.includes("provenance"));
  assert.ok(loader.includes("loadTrackCreativeIntelligenceGraph"));
  assert.ok(loader.includes("track_music_intelligence"));
  assert.ok(loader.includes("track_stems"));
  assert.ok(loader.includes("audio_scenes"));
});

test("Marketing, stems, lyrics and master audio share one creative context instead of parallel feature silos", async () => {
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
  assert.ok(marketingAi.includes("trackCreativeIntelligence"));
  assert.ok(marketingAi.includes("marketing-v4-creative-graph"));
  assert.ok(marketingAi.includes("shared cross-modal timeline"));
  assert.ok(marketingAi.includes("Quote only excerpts explicitly supplied with mayQuote=true"));
});

test("Video Director consumes the unified creative graph with Lyrics, Track, and Stem Intelligence", async () => {
  const context = await source("lib/video-director/context.ts");
  const directorTypes = await source("lib/video-director/creative-director.ts");
  const director = await source("lib/video-director/openai-director.ts");

  assert.ok(context.includes("loadTrackLyricsContext"));
  assert.ok(context.includes("loadTrackCreativeIntelligenceGraph"));
  assert.ok(context.includes("creative_intelligence: conciseCreativeGraphContext(graph)"));
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
