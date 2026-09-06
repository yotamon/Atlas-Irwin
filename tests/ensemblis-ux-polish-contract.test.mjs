import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("legacy polish is migration input while the Design System is the only runtime entrypoint", async () => {
  const layout = await source("app/studio/layout.tsx");
  const index = await source("app/studio/design-system/index.css");
  const compiler = await source("scripts/build-studio-css.mjs");
  const polishFiles = ["ux-polish.css", "music-polish.css", "release-polish.css", "create-polish.css", "growth-polish.css", "audience-polish.css", "library-polish.css", "inbox-polish.css", "shared-interactions.css", "loading-polish.css", "object-workspace-polish.css", "production-polish.css", "responsive-polish.css"];
  assert.ok(layout.includes('import "./design-system/index.css"'));
  assert.ok(index.includes('layer(ensemblis-compat)'));
  for (const file of polishFiles) {
    assert.equal(layout.includes(`import "./${file}"`), false, `${file} must not load directly at runtime`);
    assert.ok(compiler.includes(`app/studio/${file}`), `${file} must remain a declared migration input until its layout rules are retired`);
    await access(new URL(`../app/studio/${file}`, import.meta.url));
  }
});

test("global command search is keyboard accessible, artist aware and object aware", async () => {
  const palette = await source("components/studio/command-palette.tsx");
  const context = await source("components/studio/context-bar.tsx");
  const search = await source("app/api/studio/search/route.ts");
  for (const snippet of [
    "event.metaKey || event.ctrlKey",
    'event.key.toLowerCase() === "k"',
    'event.key === "ArrowDown"',
    'event.key === "ArrowUp"',
    'event.key === "Home"',
    'event.key === "End"',
    'role="dialog"',
    'aria-modal="true"',
    'aria-controls="ensemblis-command-results"',
    "searchingObjects",
    "AbortController",
    "ensemblisArtistHref",
    "New release",
    "Generate music",
    "Artist results",
  ]) assert.ok(palette.includes(snippet), `command palette is missing ${snippet}`);
  assert.ok(context.includes("<CommandPalette artistId={artistId}"));
  assert.ok(search.includes("resolveArtistContext"));
  assert.ok(search.includes('.eq("artist_id", artist.artistId)'));
  for (const sourceName of ['from("release_read_model")', 'from("track_vault")', 'from("campaigns")', 'from("content_items")']) assert.ok(search.includes(sourceName));
});

test("compact Studio navigation keeps accessible names and coarse-pointer targets", async () => {
  const navigation = await source("components/studio/sidebar-navigation.tsx");
  const sidebar = await source("components/studio/sidebar.tsx");
  const responsive = await source("app/studio/responsive-polish.css");
  assert.ok(navigation.includes("aria-label={label}"));
  assert.ok(navigation.includes("title={label}"));
  assert.ok(sidebar.includes('aria-label="Open Needs You"'));
  assert.ok(sidebar.includes('aria-label="Sign out"'));
  assert.equal(sidebar.includes('aria-label="Add unreleased tracks"'), false, "Music owns Add music; the persistent shortcut is reserved for human decisions");
  assert.ok(responsive.includes("@media (pointer: coarse)"));
  assert.ok(responsive.includes("min-height: 2.75rem"));
  assert.ok(responsive.includes(".studio-root .studio-nav-text"));
});

test("protected Studio routes have product-specific transition feedback", async () => {
  const loading = await source("app/studio/(protected)/loading.tsx");
  const css = await source("app/studio/loading-polish.css");
  assert.ok(loading.includes('aria-label="Loading workspace"'));
  assert.ok(loading.includes('aria-live="polite"'));
  assert.ok(css.includes("prefers-reduced-motion"));
});

test("Music defaults to source material and makes Add music primary", async () => {
  const page = await source("app/studio/(protected)/music/page.tsx");
  const overview = await source("components/studio/music-workspace-overview.tsx");
  assert.ok(page.includes('if (view === "add")'));
  assert.ok(page.includes('if (view === "generate")'));
  assert.ok(page.includes(">Add music</Link>"));
  assert.ok(page.includes("The song comes before the marketing workflow"));
  assert.ok(page.includes("<MusicWorkspaceOverview"));
  assert.ok(page.includes('from("track_vault")'));
  assert.ok(page.includes('.eq("artist_id", artist.artistId)'));
  assert.ok(overview.includes("Track understanding"));
  assert.ok(overview.includes("/studio/music/${trackId}"));
  assert.ok(overview.includes("Add music"));
  assert.ok(overview.includes("Create with AI"));
});

test("track objects have one readable workspace for source, intelligence, stems and lyrics", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");
  const header = await source("components/studio/object-header.tsx");
  assert.ok(track.includes("Track understanding"));
  assert.ok(track.includes("Stem Intelligence"));
  assert.ok(track.includes("Lyrics Intelligence"));
  assert.ok(track.includes("TrackIntelligenceInspector"));
  assert.ok(track.includes("StemIntelligencePanel"));
  assert.ok(track.includes("LyricsIntelligencePanel"));
  assert.ok(track.includes("<ObjectHeader"));
  assert.ok(header.includes("ObjectHeader"));
});