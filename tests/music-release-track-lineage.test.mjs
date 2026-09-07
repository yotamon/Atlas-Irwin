import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("multi-track releases preserve exact track identity from catalog click through master analysis", async () => {
  const [migration, types, trackPage, uploader, safeActions] = await Promise.all([
    source("supabase/migrations/20260907144500_track_vault_track_lineage.sql"),
    source("types/growth-database.ts"),
    source("app/studio/(protected)/music/[id]/page.tsx"),
    source("components/studio/media-uploader.tsx"),
    source("app/studio/growth-media-actions-safe.ts"),
  ]);

  assert.match(migration, /linked_track_id uuid references public\.tracks\(id\)/);
  assert.match(migration, /track_vault_artist_track_uidx/);
  assert.match(types, /linked_track_id: string \| null/);

  assert.match(trackPage, /\.eq\("linked_track_id", aliasTrack\.id\)/);
  assert.match(trackPage, /<CatalogTrackWorkspace track=\{aliasTrack\}/);
  assert.doesNotMatch(trackPage, /eq\("linked_release_id", aliasTrackResult\.data\.release_id\)/);

  assert.match(uploader, /trackId\?: string/);
  assert.match(uploader, /masterForm\.set\("track_id", trackId\)/);
  assert.match(uploader, /attachCatalogTrackMasterFromMedia\(masterForm\)/);
  assert.match(safeActions, /\.eq\("linked_track_id", trackId\)/);
  assert.match(safeActions, /linked_track_id: track\.id/);
});

test("Music owns release collections and release overview surfaces tracks before workflow detail", async () => {
  const [product, musicPage, releasesPage, releaseWorkspace, tracklist] = await Promise.all([
    source("lib/ensemblis-product.ts"),
    source("app/studio/(protected)/music/page.tsx"),
    source("app/studio/(protected)/releases/page.tsx"),
    source("components/studio/release-workspace-v2.tsx"),
    source("components/studio/release-tracklist.tsx"),
  ]);

  assert.match(product, /prefix: "\/studio\/releases", area: "Music", parentHref: "\/studio\/music"/);
  assert.doesNotMatch(product, /href: "\/studio\/releases", label: "Releases", icon: "releases"/);
  assert.match(musicPage, /<MusicLibraryNav artistId=\{artist\.artistId\} active="tracks"/);
  assert.match(releasesPage, /<MusicLibraryNav artistId=\{artist\.artistId\} active="releases"/);

  const tracklistPosition = releaseWorkspace.indexOf("<ReleaseTracklist");
  const missionPosition = releaseWorkspace.indexOf('className="release-mission-hero"');
  assert.ok(tracklistPosition >= 0 && missionPosition > tracklistPosition, "release tracks must appear before mission/workflow detail");
  assert.match(releaseWorkspace, /if \(stage === "music"\) return "overview"/);
  assert.doesNotMatch(releaseWorkspace, /label: "Music", href: href\(`\/studio\/releases\/\$\{release\.id\}\?stage=music`\)/);
  assert.match(tracklist, /Every song has its own master and Music Intelligence/);
  assert.match(tracklist, /trackId=\{track\.id\}/);
});
