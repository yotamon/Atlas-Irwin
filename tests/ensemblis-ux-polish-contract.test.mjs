import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("UX polish styles load after the Ensemblis compatibility layers", async () => {
  const layout = await source("app/studio/layout.tsx");
  const shell = layout.indexOf('import "./ensemblis-shell.css"');
  const polishFiles = [
    "ux-polish.css", "music-polish.css", "release-polish.css", "create-polish.css",
    "growth-polish.css", "audience-polish.css", "library-polish.css", "inbox-polish.css",
    "shared-interactions.css", "loading-polish.css", "object-workspace-polish.css",
  ];
  assert.ok(shell >= 0);
  for (const file of polishFiles) {
    const index = layout.indexOf(`import "./${file}"`);
    assert.ok(index > shell, `${file} must load after the Ensemblis compatibility shell`);
    await access(new URL(`../app/studio/${file}`, import.meta.url));
  }
});

test("global command search is functional, keyboard accessible and artist aware", async () => {
  const palette = await source("components/studio/command-palette.tsx");
  const context = await source("components/studio/context-bar.tsx");
  for (const snippet of ["event.metaKey || event.ctrlKey", 'event.key.toLowerCase() === "k"', 'role="dialog"', 'aria-modal="true"', "ensemblisArtistHref", "New release", "Generate music", "Distribution"]) assert.ok(palette.includes(snippet), `command palette is missing ${snippet}`);
  assert.ok(context.includes("<CommandPalette artistId={artistId}"));
});

test("protected Studio routes have product-specific transition feedback", async () => {
  const loading = await source("app/studio/(protected)/loading.tsx");
  const css = await source("app/studio/loading-polish.css");
  assert.ok(loading.includes('aria-label="Loading workspace"'));
  assert.ok(loading.includes('aria-live="polite"'));
  assert.ok(css.includes("prefers-reduced-motion"));
});

test("Music defaults to source material and moves generation behind an explicit view", async () => {
  const page = await source("app/studio/(protected)/music/page.tsx");
  const overview = await source("components/studio/music-workspace-overview.tsx");
  assert.ok(page.includes('if (view === "generate")'));
  assert.ok(page.includes("<MusicWorkspaceOverview"));
  assert.ok(page.includes('from("track_vault")'));
  assert.ok(page.includes('.eq("artist_id", artist.artistId)'));
  assert.ok(overview.includes("Next track decision"));
  assert.ok(overview.includes("/studio/music/${trackId}"));
  assert.ok(overview.includes("Manage Portfolio"));
});

test("track objects have one readable workspace for source, intelligence, stems and lyrics", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");
  const header = await source("components/studio/object-header.tsx");
  for (const snippet of ["<ObjectHeader", 'from("track_vault")', '.eq("artist_id", artist.artistId)', "<MusicIntelligencePreview", "<StemIntelligencePanel", "<LyricsIntelligencePanel", "Detailed track signals"]) assert.ok(track.includes(snippet), `track workspace is missing ${snippet}`);
  assert.ok(header.includes("ensemblis-object-header"));
  assert.ok(header.includes("ensemblis-object-tabs"));
});

test("release workspace uses the shared object grammar and no Atlas product copy", async () => {
  const release = await source("components/studio/release-workspace-v2.tsx");
  assert.ok(release.includes("<ObjectHeader"));
  assert.ok(release.includes("Workflow readiness"));
  assert.ok(release.includes("Advanced view"));
  for (const stage of ["Select", "Prepare", "Build hype", "Release", "Sustain", "Rediscover", "Produce", "Distribute", "Learn"]) assert.ok(release.includes(stage), `release lifecycle lost ${stage}`);
  assert.equal(/\bAtlas\b/.test(release), false, "Atlas product language leaked into the Ensemblis release workspace");
});

test("core workspaces follow the outcome-first UX information architecture", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  const grow = await source("app/studio/(protected)/growth/page.tsx");
  const audience = await source("app/studio/(protected)/audience/page.tsx");
  const library = await source("app/studio/(protected)/library/page.tsx");
  for (const outcome of ["Create a track", "Start a release", "Make content", "Direct a video"]) assert.ok(create.includes(outcome));
  for (const view of ["overview", "opportunities", "performance", "portfolio"]) assert.ok(grow.includes(view));
  assert.ok(audience.includes("Needs judgment"));
  assert.ok(audience.includes("nothing is sent without your decision"));
  assert.ok(library.includes("reusable"));
  assert.ok(library.includes("Recent visual memory"));
});

test("Needs you previews external effects before approval and protects unknown automation", async () => {
  const inbox = await source("app/studio/(protected)/inbox/page.tsx");
  assert.ok(inbox.includes("publicationContentIds"));
  assert.ok(inbox.includes('select("id,title,caption,asset_url,format,platform,release_id")'));
  assert.ok(inbox.includes("What will happen"));
  assert.ok(inbox.includes("Paid generation never enters a batch approval"));
  assert.ok(inbox.includes("SAFE_INTERNAL_AUTOMATION"));
  assert.ok(inbox.includes("protectedAutomation"));
});

test("lyrics intelligence is Ensemblis-branded on the reusable product surface", async () => {
  const lyrics = await source("components/studio/lyrics-intelligence-panel.tsx");
  assert.equal(/\bAtlas\b/.test(lyrics), false);
  assert.ok(lyrics.includes("Ensemblis will structure them"));
  assert.ok(lyrics.includes("Ensemblis keeps revision history"));
});
