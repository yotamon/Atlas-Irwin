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
  assert.ok(index.includes('layer(ensemblis-workflows)'));
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
  for (const sourceName of ['from("releases")', 'from("track_vault")', 'from("campaigns")', 'from("content_items")']) assert.ok(search.includes(sourceName));
});

test("compact Studio navigation keeps accessible names and coarse-pointer targets", async () => {
  const navigation = await source("components/studio/sidebar-navigation.tsx");
  const sidebar = await source("components/studio/sidebar.tsx");
  const context = await source("components/studio/context-bar.tsx");
  const responsive = await source("app/studio/responsive-polish.css");
  assert.ok(navigation.includes('<span className="studio-nav-text">{label}</span>'));
  assert.ok(navigation.includes('aria-current={active ? "page" : undefined}'));
  assert.equal(navigation.includes("title={label}"), false, "native title tooltips must not be required for navigation labels");
  assert.ok(context.includes('href={ensemblisArtistHref("/studio/needs-you", artistId)}'));
  assert.ok(context.includes("Needs You"), "Needs You must have a visible accessible label in the global context bar");
  assert.ok(sidebar.includes('aria-label="Sign out"'));
  assert.equal(sidebar.includes('aria-label="Add unreleased tracks"'), false, "Music owns Add music; persistent navigation must not duplicate intake shortcuts");
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
  assert.ok(overview.includes("Catalog tracks"));
  assert.ok(overview.includes("Every released or release-bound song"));
  assert.ok(overview.includes("Unreleased focus"));
  assert.ok(overview.includes("/studio/music/${trackId}"));
  assert.ok(overview.includes("Add music"));
  assert.ok(overview.includes("Create with AI"));
});

test("track objects have one readable workspace for source, intelligence, stems and lyrics", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");
  const header = await source("components/studio/object-header.tsx");
  for (const snippet of ["<ObjectHeader", 'from("track_vault")', '.eq("artist_id", artist.artistId)', "<MusicIntelligencePreview", "<StemIntelligencePanel", "<LyricsIntelligencePanel", "Technical details"]) assert.ok(track.includes(snippet), `track workspace is missing ${snippet}`);
  assert.equal(track.includes("Portfolio score"), false, "track workspace must not present Growth scoring as music understanding");
  assert.ok(header.includes("ensemblis-object-header"));
  assert.ok(header.includes("ensemblis-object-tabs"));
});

test("Track Intelligence exposes a real native waveform plus semantic musical timeline data", async () => {
  const preview = await source("components/studio/music-intelligence-preview.tsx");
  const css = await source("components/studio/music-intelligence-preview.module.css");
  for (const snippet of [
    "sampleWaveform",
    "new AudioContext()",
    'role="slider"',
    "onPointerDown",
    'event.key === "ArrowLeft"',
    'event.key === "ArrowRight"',
    "waveformPeaks",
    "map.energy_curve",
    "map.edit_points",
    "sectionOverlay",
    "hookOverlay",
    "playhead",
  ]) assert.ok(preview.includes(snippet), `Track Intelligence preview is missing ${snippet}`);
  assert.ok(css.includes(".waveformBars"));
  assert.ok(css.includes(".waveformPlayed"));
  assert.equal(preview.includes("wavesurfer.js"), false, "native waveform should not require a package dependency");
});

test("Media Library uses signed resumable TUS above 6 MB without expanding storage policy", async () => {
  const uploader = await source("components/studio/media-uploader.tsx");
  const resumable = await source("lib/supabase/resumable-upload.ts");
  const catalog = await source("app/studio/catalog-actions-internal.ts");
  const interactions = await source("app/studio/shared-interactions.css");
  const packageJson = JSON.parse(await source("package.json"));

  assert.ok(uploader.includes("RESUMABLE_THRESHOLD = 6 * 1024 * 1024"));
  assert.ok(uploader.includes("PUBLIC_LIMIT = 100 * 1024 * 1024"));
  assert.ok(uploader.includes("uploadResumableMedia"));
  assert.ok(uploader.includes("upload-progress"));
  assert.ok(uploader.includes("Retry to resume from the last confirmed chunk"));
  assert.ok(uploader.includes("ResumableUploadAuthorizationError"));
  assert.equal(uploader.includes("auth.getSession"), false, "signed resumable upload must not depend on browser session retrieval");

  for (const snippet of [
    "TUS_CHUNK_SIZE = 6 * 1024 * 1024",
    '"Tus-Resumable"',
    '"x-signature"',
    '"Upload-Length"',
    '"Upload-Metadata"',
    '"Upload-Offset"',
    'method: "HEAD"',
    'method: "PATCH"',
    "sessionStorage",
    "RETRY_DELAYS",
    "const chunkOffset: number = offset",
    "patchChunk(uploadUrl, target, chunk, chunkOffset)",
    "serverOffset !== chunkOffset",
  ]) assert.ok(resumable.includes(snippet), `resumable transport is missing ${snippet}`);

  assert.ok(catalog.includes("createSignedUploadUrl(storagePath)"));
  assert.ok(catalog.includes("max(104857600)"));
  assert.ok(interactions.includes(".upload-progress"));
  assert.equal(Boolean(packageJson.dependencies?.["tus-js-client"]), false);
  assert.equal(Boolean(packageJson.dependencies?.["wavesurfer.js"]), false);
});

test("release workspace keeps tracks first and release workflow secondary", async () => {
  const release = await source("components/studio/release-workspace-v2.tsx");
  const releasePage = await source("app/studio/(protected)/releases/[id]/page.tsx");
  const mission = await source("lib/studio/release-mission.ts");
  assert.ok(release.includes("<ObjectHeader"));
  assert.ok(release.includes("<ReleaseTracklist"));
  assert.ok(release.includes("deriveReleaseMission"));
  assert.ok(release.includes("Release Mission"));
  assert.ok(release.includes("This release needs one thing before Ensemblis can move it forward"));
  assert.ok(release.indexOf("<ReleaseTracklist") < release.indexOf("release-mission-hero"), "tracks must be visible before workflow detail");
  assert.equal(release.includes("Workflow readiness"), false);
  assert.equal(release.includes("healthScore"), false);
  assert.ok(release.includes("Advanced view"));
  assert.ok(mission.includes('attention: "blocking"'));
  assert.ok(mission.includes('status: "on_track"'));
  for (const stage of ["Overview", "Release work", "Content", "Promotion", "Distribution", "Results"]) assert.ok(release.includes(stage), `release object lost ${stage}`);
  assert.equal(release.includes('{ label: "Music", href:'), false, "release must not hide tracks behind a duplicate Music tab");
  for (const alias of ['stage === "music"', 'stage === "plan"', 'stage === "create"', 'stage === "publish"', 'stage === "learn"']) assert.ok(release.includes(alias), `legacy release alias lost ${alias}`);
  assert.ok(releasePage.includes('stage === "create" ? <MomentReviewPanel'));
  assert.ok(releasePage.includes("<MomentReviewPanel"));
  assert.equal(/\bAtlas\b/.test(release), false, "Atlas product language leaked into the Ensemblis release workspace");
});

test("campaign workspace uses Ensemblis chrome without Atlas-era editorial styling", async () => {
  const css = await source("components/studio/marketing-workspace.module.css");
  assert.ok(css.includes("var(--en-surface)"));
  assert.ok(css.includes("var(--font-body)"));
  assert.ok(css.includes("text-transform: none"));
  assert.ok(css.includes("var(--en-accent-soft)"));
  for (const legacyColor of ["#0c100e", "#d7ccb3", "#ddd2ba", "#d9cfb8", "#d8cdb5"]) assert.equal(css.includes(legacyColor), false, `${legacyColor} leaked into Campaign chrome`);
  assert.equal(css.includes("heroCard::after"), false, "decorative orbit styling should not define Campaign hierarchy");
});

test("Production keeps the selected creative dominant and technical controls secondary", async () => {
  const css = await source("app/studio/production-polish.css");
  assert.ok(css.includes(".v2-production-layout"));
  assert.ok(css.includes(".v2-production-editor"));
  assert.ok(css.includes(".v2-production-list > a.active"));
  assert.ok(css.includes(".studio-advanced-details"));
  assert.ok(css.includes("@media (max-width: 960px)"));
});

test("Create starts from approved Moments but asks for a deliverable instead of an engine", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  const grow = await source("app/studio/(protected)/growth/page.tsx");
  const audience = await source("app/studio/(protected)/audience/page.tsx");
  const library = await source("app/studio/(protected)/library/page.tsx");
  for (const snippet of [
    'from("moments")',
    '.eq("state", "approved")',
    "What do you want to make?",
    "Ensemblis picked",
    "Review source Moments",
    "Other ways to create",
    "Add or create music",
    "Start a release",
    "Continue production",
    "Direct a longer video",
  ]) assert.ok(create.includes(snippet), `deliverable-first Create is missing ${snippet}`);
  for (const view of ["overview", "opportunities", "performance", "portfolio"]) assert.ok(grow.includes(view));
  assert.ok(grow.includes('label: "Audience"'));
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