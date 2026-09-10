import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Video Director source scope admits track, release-only, or artist-global media without sibling-track leakage", async () => {
  const [scope, session, workspace, page] = await Promise.all([
    source("lib/video-director/media-scope.ts"),
    source("lib/video-director/editor-session.ts"),
    source("lib/video-director/workspace.ts"),
    source("app/studio/(protected)/video/[id]/page.tsx"),
  ]);

  assert.match(scope, /track_id\.eq\.\$\{trackId\}/);
  assert.match(scope, /and\(release_id\.eq\.\$\{releaseId\},track_id\.is\.null\)/);
  assert.match(scope, /and\(release_id\.is\.null,track_id\.is\.null\)/);
  assert.doesNotMatch(scope, /release_id\.eq\.\$\{releaseId\},track_id\.eq\.\$\{trackId\}/);

  assert.match(session, /\.eq\("artist_id", artist\.artistId\)/);
  assert.match(session, /projectMediaLinkScopeFilter\(context\.project\.release_id, context\.project\.track_id\)/);
  assert.match(workspace, /\.eq\("owner_id", input\.ownerId\)\.eq\("artist_id", input\.artistId\)/);
  assert.match(workspace, /projectMediaLinkScopeFilter\(project\.release_id, project\.track_id\)/);
  assert.match(workspace, /link\.track_id === project\.track_id/);
  assert.match(workspace, /link\.track_id === null && link\.release_id === project\.release_id/);
  assert.match(workspace, /projectRoles\.has\("master_audio"\)/);
  assert.match(workspace, /projectRoles\.has\("cover"\)/);

  assert.match(page, /loadVideoWorkspaceSnapshot/);
  assert.doesNotMatch(page, /\.from\(/);
  assert.doesNotMatch(page, /projectMediaLinkScopeFilter/);
});
