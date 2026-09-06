import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("public catalog requires explicit canonical owner and artist scope", async () => {
  const text = await source("lib/public-catalog.ts");

  assert.doesNotMatch(
    text,
    /\.from\("artists"\)/,
    "The public catalog must not infer scope by querying the private artists table",
  );
  assert.match(text, /PUBLIC_CATALOG_OWNER_ID is required/);
  assert.match(text, /PUBLIC_CATALOG_ARTIST_ID is required/);
  assert.match(text, /\.eq\("artist_id", resolvedArtistId\)/);
  assert.doesNotMatch(text, /NO_PUBLIC_ARTIST/);
  assert.doesNotMatch(text, /isPreEnsemblisSchemaError/);
  assert.doesNotMatch(text, /resolveLegacyCanvasVideoUrl/);
  assert.doesNotMatch(text, /Atlas Irwin/);
  assert.doesNotMatch(text, /atlas-cover\.png/);
});

test("public catalog reads media and external links from canonical normalized tables", async () => {
  const text = await source("lib/public-catalog.ts");

  assert.match(text, /\.from\("media_links"\)/);
  assert.match(text, /\.from\("media_assets"\)/);
  assert.match(text, /\.from\("release_external_links"\)/);
  assert.match(text, /\.from\("track_external_ids"\)/);

  assert.doesNotMatch(text, /release\.artwork_url/);
  assert.doesNotMatch(text, /release\.spotify_url/);
  assert.doesNotMatch(text, /release\.soundcloud_url/);
  assert.doesNotMatch(text, /release\.youtube_url/);
  assert.doesNotMatch(text, /release\.smart_link_url/);
  assert.doesNotMatch(text, /track\.audio_url/);
  assert.doesNotMatch(text, /track\.spotify_url/);
  assert.doesNotMatch(text, /track\.soundcloud_url/);
});
