import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalPolicy,
  canAutoFixHealthIssue,
  deriveContentStatus,
} from "../features/studio-v2/policy.mjs";

test("content status is derived from evidence instead of manual moves", () => {
  assert.equal(deriveContentStatus({}), "Draft");
  assert.equal(deriveContentStatus({ hook: "A hook" }), "In Production");
  assert.equal(deriveContentStatus({ assetUrl: "https://asset", caption: "Ready" }), "Ready");
  assert.equal(deriveContentStatus({ assetUrl: "https://asset", scheduledAt: "2026-09-01T18:00:00Z" }), "Scheduled");
  assert.equal(deriveContentStatus({ publishedAt: "2026-09-01T18:00:00Z" }), "Published");
});

test("risk policy only interrupts the artist for cost, external effects, or destructive changes", () => {
  assert.equal(approvalPolicy({ reversible: true }), "automatic");
  assert.equal(approvalPolicy({ paid: true }), "approval");
  assert.equal(approvalPolicy({ external: true }), "approval");
  assert.equal(approvalPolicy({ destructive: true }), "confirmation");
});

test("health auto-fixes require an unambiguous candidate", () => {
  assert.equal(canAutoFixHealthIssue("homepage_default_from_single_track", { singleCandidate: true }), true);
  assert.equal(canAutoFixHealthIssue("homepage_default_from_single_track", { singleCandidate: false }), false);
  assert.equal(canAutoFixHealthIssue("spotify_exact_isrc", { uniqueExactMatch: true }), true);
  assert.equal(canAutoFixHealthIssue("spotify_exact_isrc", { uniqueExactMatch: false }), false);
});
