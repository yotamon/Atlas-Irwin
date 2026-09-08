import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Director Pro is a music-aware editor instead of a settings stack", async () => {
  const workspace = await source("components/studio/video-director/project-workspace.tsx");
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");
  const css = await source("app/studio/design-system/video-editor.css");

  assert.match(workspace, /VideoDirectorProEditor/);
  assert.match(workspace, /Advanced production controls/);
  for (const surface of ["story", "media", "cast", "lyrics", "music"]) {
    assert.match(editor, new RegExp(`\\"${surface}\\"`));
  }
  assert.match(editor, /video-editor-timeline-content/);
  assert.match(editor, /smartSnapTime/);
  assert.match(editor, /updateVideoShotTiming/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /video-editor-workbench/);
  assert.match(css, /video-editor-playhead/);
  assert.match(css, /focus-visible/);
});

test("video editor consumes canonical lyrics and stem intelligence", async () => {
  const page = await source("app/studio/(protected)/video/[id]/page.tsx");
  assert.match(page, /track_lyric_lines/);
  assert.match(page, /track_stems/);
  assert.match(page, /audio_scenes/);
  assert.match(page, /lyricCues/);
  assert.match(page, /audioScenes/);
});

test("performance shots route through audio-reference-capable continuity models", async () => {
  const actions = await source("app/studio/video-editor-actions.ts");
  const router = await source("lib/video-director/model-router.ts");
  const provider = await source("lib/video-providers/higgsfield/client.ts");

  assert.match(actions, /performance_shot/);
  assert.match(actions, /requires_audio_reference/);
  assert.match(actions, /audio_references/);
  assert.match(actions, /generation_priority: parsed\.shotType === "performance" \? "consistency"/);
  assert.match(router, /profile\.performance_shot === true/);
  assert.match(router, /supportsAudioReferences/);
  assert.match(provider, /audio_reference/);
  assert.match(provider, /input\.audio_references/);
});

test("character identity is artist-scoped, reusable and cannot leak across artists", async () => {
  const migration = await source("supabase/migrations/20260908190000_video_director_pro_editor.sql");
  const actions = await source("app/studio/video-editor-actions.ts");
  const page = await source("app/studio/(protected)/video/[id]/page.tsx");

  assert.match(migration, /create table public\.music_video_characters/);
  assert.match(migration, /artist_id uuid not null references public\.artists/);
  assert.match(migration, /project_id uuid references public\.music_video_projects\(id\) on delete set null/);
  assert.match(migration, /Video character artist must match origin project artist/);
  assert.match(migration, /Video shot character must belong to the same artist as the project/);
  assert.match(actions, /artistCharacters/);
  assert.match(actions, /baseReferences/);
  assert.match(page, /music_video_characters.*artist_id/s);
});

test("editor keeps spend safety and exposes professional handoff instead of bypassing production", async () => {
  const workspace = await source("components/studio/video-director/project-workspace.tsx");
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");
  const exports = await source("lib/video-director/editor.ts");

  assert.match(workspace, /GenerationPanel/);
  assert.match(workspace, /ShotReviewPanel/);
  assert.match(workspace, /DeliveryPanel/);
  assert.match(editor, /hard_budget_credits/);
  assert.match(editor, /buildCmx3600Edl/);
  assert.match(editor, /buildFcpxml/);
  assert.match(exports, /TITLE:/);
  assert.match(exports, /<fcpxml version="1\.11">/);
});
