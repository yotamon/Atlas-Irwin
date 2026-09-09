import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Studio workspace routes stay thin and delegate cross-domain reads", async () => {
  const [releasePage, videoPage, releaseLoader, videoLoader] = await Promise.all([
    read("app/studio/(protected)/releases/[id]/page.tsx"),
    read("app/studio/(protected)/video/[id]/page.tsx"),
    read("lib/studio/release-workspace.ts"),
    read("lib/video-director/workspace.ts"),
  ]);

  assert.match(releasePage, /loadReleaseWorkspaceSnapshot/);
  assert.match(videoPage, /loadVideoWorkspaceSnapshot/);
  assert.doesNotMatch(releasePage, /\.from\(/);
  assert.doesNotMatch(videoPage, /\.from\(/);
  assert.match(releaseLoader, /providerScheduleError/);
  assert.match(videoLoader, /productionProfilePreviews/);
});

test("Video Editor actions share one authorization session and keep mutation policy outside Next actions", async () => {
  const [actions, timing, quality, session, policy] = await Promise.all([
    read("app/studio/video-editor-actions.ts"),
    read("app/studio/video-editor-timing-actions.ts"),
    read("app/studio/video-editor-quality-actions.ts"),
    read("lib/video-director/editor-session.ts"),
    read("lib/video-director/editor-policy.ts"),
  ]);

  assert.match(actions, /loadVideoEditorSession/);
  assert.match(timing, /loadVideoEditorSession/);
  assert.match(quality, /loadVideoEditorSession/);
  assert.doesNotMatch(timing, /requireStudioAdmin|resolveActiveArtistContext|createServiceClient/);
  assert.doesNotMatch(quality, /requireStudioAdmin|resolveActiveArtistContext|createServiceClient/);
  assert.match(session, /requireStudioAdmin/);
  assert.match(session, /resolveActiveArtistContext/);
  assert.match(policy, /buildVideoShotEditorMutation/);
  assert.match(policy, /buildTrimShotStartMutation/);
  assert.match(policy, /buildHumanQualityApprovalMutation/);
});

test("architecture map points future changes at canonical deep modules", async () => {
  const [context, index] = await Promise.all([
    read("CONTEXT.md"),
    read("docs/adr/README.md"),
  ]);
  assert.match(context, /lib\/studio\/release-workspace\.ts/);
  assert.match(context, /lib\/video-director\/workspace\.ts/);
  assert.match(context, /lib\/video-director\/editor-session\.ts/);
  assert.match(context, /contracts\/media-worker\.v1\.json/);
  assert.match(index, /001-workspace-read-models/);
  assert.match(index, /002-video-editor-command-boundary/);
  assert.match(index, /003-media-worker-contract-v1/);
});
