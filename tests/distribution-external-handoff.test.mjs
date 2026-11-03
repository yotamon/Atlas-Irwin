import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function builder() {
  const code = await source("lib/distribution/handoff.ts");
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const runtimeModule = { exports: {} };
  new Function("module", "exports", compiled)(runtimeModule, runtimeModule.exports);
  return runtimeModule.exports.buildDistributionHandoff;
}

function fixture() {
  const release = {
    id: "release-1", title: "Night In Chrome", artist: "Example Artist",
    release_type: "Single", release_date: "2027-01-15",
    genre: "Electronic", subgenre: "Nu Disco", label: "Self-released",
    upc: null, artwork_url: "https://cdn.example.org/artwork.png", cover_asset: null,
  };
  const tracks = [
    { id: "one", title: "Night In Chrome", version: "Remastered x2", duration: 210, audio_url: "https://cdn.example.org/approved-master.wav", track_number: 1 },
    { id: "two", title: "Bonus", version: null, duration: null, audio_url: null, track_number: 2 },
  ];
  return {
    release,
    tracks,
    releaseMetadata: {
      upc_source: "provider", metadata_language_code: "en",
      catalog_number: null, original_release_date: null, preorder_date: null,
      product_copyright_line: "© Example Artist", recording_copyright_line: "℗ Example Artist",
    },
    trackMetadata: [{ track_id: "one", isrc: null, explicit: false, track_origin: "original", metadata_language_code: "en", audio_language_code: "en" }],
    writers: [
      { track_id: "one", legal_name: "Example Writer", role: "composer_lyricist", share: 100, publishing_type: "copyright_control", publisher_name: null },
      { track_id: "other-artist-track", legal_name: "Someone Else", role: "composer", share: 100, publishing_type: "copyright_control", publisher_name: null },
    ],
    contributors: [{ track_id: "one", name: "Example Producer", role: "Producer" }],
    rights: { masterRightsConfirmed: true, aiDeclarationConfirmed: false },
    aiProvenance: { composition: { involvement: "assisted" } },
    masterGates: { one: "pass", two: null },
    decisions: [{ key: "rights.declarations", title: "Confirm rights", detail: "Artist confirmation required" }],
    exportedAt: "2026-11-03T12:00:00.000Z",
  };
}

test("external distributor handoff never claims submission, approval or legal ownership", async () => {
  const build = await builder();
  const handoff = build(fixture());
  assert.equal(handoff.submissionStatus, "NOT_SUBMITTED");
  assert.equal(handoff.approvalStatus, "ARTIST_REVIEW_REQUIRED");
  assert.match(handoff.warning, /not proof of ownership/);
  assert.equal(handoff.artistDeclaredRights.aiDeclarationConfirmed, false);
  assert.deepEqual(handoff.unresolvedDecisions.map((item) => item.key), ["rights.declarations"]);
  assert.equal(handoff.release.releaseDate, "2027-01-15");
  assert.equal(handoff.release.upc, null);
});

test("handoff exports only canonical track credits and exact master verification state", async () => {
  const build = await builder();
  const handoff = build(fixture());
  assert.equal(handoff.tracks[0].title, "Night In Chrome");
  assert.equal(handoff.tracks[0].version, "Remastered x2");
  assert.equal(handoff.tracks[0].masterVerification, "pass");
  assert.equal(handoff.tracks[1].masterVerification, "unverified");
  assert.equal(handoff.tracks[1].masterAttached, false);
  assert.equal(handoff.tracks[0].writers.length, 1);
  assert.equal(handoff.tracks[0].writers[0].legalName, "Example Writer");
  assert.equal(handoff.tracks[1].writers.length, 0);
  assert.equal(JSON.stringify(handoff).includes("approved-master.wav"), false, "Never leak raw master URLs into a portable export");
});

test("download route enforces release and artist scoping with private no-store response", async () => {
  const route = await source("app/api/studio/releases/[id]/distribution-handoff/route.ts");
  const ui = await source("app/studio/(protected)/releases/[id]/distribution/release-distribution-artist-view.tsx");
  for (const condition of [
    "requireStudioAdmin",
    "resolveArtistContext",
    'eq("owner_id", user.id)',
    'eq("artist_id", artist.artistId)',
    'eq("release_id", id)',
    "loadMasterReadinessByTrack",
    "deriveDistributionArtistState",
    "buildDistributionHandoff",
    'Cache-Control": "private, no-store, max-age=0',
    "attachment; filename=",
    "nosniff",
  ]) assert.ok(route.includes(condition), `Missing safe handoff contract: ${condition}`);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.rpc\(|submitRelease\(|fetch\(.*provider/i);
  assert.match(ui, /Export distributor handoff/);
  assert.match(ui, /never uploads audio, declares rights, approves distribution or records a submission/);
});
