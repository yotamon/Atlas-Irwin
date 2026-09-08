import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Video Director source scope admits track, release-only, or artist-global media without sibling-track leakage", async () => {
  const scope = await source("lib/video-director/media-scope.ts");
  const actions = await source("app/studio/video-editor-actions.ts");
  const page = await source("app/studio/(protected)/video/[id]/page.tsx");

  assert.match(scope, /track_id\.eq\.\$\{trackId\}/);
  assert.match(scope, /and\(release_id\.eq\.\$\{releaseId\},track_id\.is\.null\)/);
  assert.match(scope, /and\(release_id\.is\.null,track_id\.is\.null\)/);
  assert.doesNotMatch(scope, /release_id\.eq\.\$\{releaseId\},track_id\.eq\.\$\{trackId\}/);

  assert.match(actions, /\.eq\("artist_id", input\.artistId\)/);
  assert.match(actions, /projectMediaLinkScopeFilter\(input\.releaseId, input\.trackId\)/);
  assert.match(actions, /projectMediaLinkScopeFilter\(context\.project\.release_id, context\.project\.track_id\)/);
  assert.match(page, /\.eq\("owner_id", user\.id\)\.eq\("artist_id", artist\.artistId\)/);
  assert.match(page, /projectMediaLinkScopeFilter\(project\.release_id, project\.track_id\)/);
});
