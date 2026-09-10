import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Sites snapshot builder drops blank and non-http public links", async () => {
  const snapshot = await source("lib/sites/snapshot.ts");
  for (const snippet of [
    "function publicHttpUrl",
    "const href = publicHttpUrl(external.external_url)",
    "if (!href) continue",
    "soundcloudUrl: publicHttpUrl(track.soundcloud_url)",
    "spotifyUrl: publicHttpUrl(track.spotify_url)",
    "const href = publicHttpUrl(candidate)",
    "artworkUrl: publicAsset(release.artwork_url)",
    "imageUrl: publicHttpUrl(latestRelease?.artworkUrl || artist.avatar_url)",
  ]) {
    assert.ok(snapshot.includes(snippet), `snapshot builder must retain URL safety: ${snippet}`);
  }
  assert.ok(snapshot.includes('url.protocol === "http:" || url.protocol === "https:"'));
  assert.equal(snapshot.includes("href: external.external_url"), false);
});

test("Sites database sanitizer repairs only mutable snapshots and sanitizes cloned versions", async () => {
  const migration = await source("supabase/migrations/20260904180000_ensemblis_sites_snapshot_url_safety.sql");
  for (const snippet of [
    "private.sanitize_artist_site_snapshot",
    "where status = 'draft'",
    "private.sanitize_artist_site_snapshot(source_row.content_snapshot)",
    "create or replace function public.create_artist_site_draft",
    "create or replace function public.rollback_artist_site",
    "candidate ~* '^https?://[^[:space:]]+$'",
  ]) {
    assert.ok(migration.includes(snippet), `snapshot URL migration must retain: ${snippet}`);
  }
  assert.equal(
    /update public\.artist_site_versions[\s\S]*where status in \('published','superseded'\)/i.test(migration),
    false,
    "URL safety migration must never mutate immutable published snapshots in place",
  );
});
