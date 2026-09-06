import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoots = ["app", "components", "lib"];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const forbiddenRuntimeTokens = [
  "resolveLegacyCanvasVideoUrl",
  "isPreEnsemblisSchemaError",
  "buildAtlasMusicPrompt",
  "ATLAS_VIBES",
  "AtlasMusicInput",
  "asArtistScopedMusicClient",
  "artist-scoped-music-database",
  "creative-graph-v2",
  "atlas-generator",
  "catalog/legacy-media",
  "public/releases",
  "@/types/database-core",
];

const removedCompatibilityFiles = [
  "lib/catalog/legacy-media.ts",
  "lib/music/atlas-generator.ts",
  "lib/releases.ts",
  "scripts/import-legacy-releases.mjs",
  "scripts/import-public-releases.mjs",
  "scripts/migrate-media-to-public.mjs",
  "scripts/seed-studio.mjs",
  "types/artist-scoped-music-database.ts",
  "lib/music-intelligence/creative-graph-v2.ts",
];

async function collectSourceFiles(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(relativePath));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }

  return files;
}

test("removed compatibility files stay removed", async () => {
  for (const relativePath of removedCompatibilityFiles) {
    await assert.rejects(
      access(path.join(root, relativePath), constants.F_OK),
      { code: "ENOENT" },
      `${relativePath} must not return as a compatibility surface`,
    );
  }
});

test("runtime source does not depend on deleted legacy contracts", async () => {
  const files = (
    await Promise.all(runtimeRoots.map((runtimeRoot) => collectSourceFiles(runtimeRoot)))
  ).flat();

  const violations = [];
  for (const relativePath of files) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    for (const token of forbiddenRuntimeTokens) {
      if (source.includes(token)) {
        violations.push(`${relativePath}: ${token}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Runtime compatibility debt detected:\n${violations.join("\n")}`,
  );
});

test("canonical music schema drops denormalized release and track columns", async () => {
  const migration = await readFile(
    path.join(root, "supabase/migrations/20260906193000_normalize_release_track_storage.sql"),
    "utf8",
  );

  for (const column of [
    "artist",
    "artwork_url",
    "cover_asset",
    "cover_alt",
    "canvas_video_url",
    "public_release_path",
    "spotify_url",
    "apple_music_url",
    "soundcloud_url",
    "youtube_url",
    "bandcamp_url",
    "smart_link_url",
    "audio_url",
  ]) {
    assert.match(
      migration,
      new RegExp(`drop column if exists ${column}`),
      `${column} must be removed by the canonical cleanup migration`,
    );
  }
});
