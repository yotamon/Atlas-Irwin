import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("public catalog resolves artist scope only from public catalog data", async () => {
  const text = await source("lib/public-catalog.ts");

  assert.doesNotMatch(
    text,
    /\.from\("artists"\)/,
    "The low-privilege public catalog must never query the private artists table directly",
  );
  assert.match(text, /\.from\("releases"\)/);
  assert.match(text, /\.select\("artist_id"\)/);
  assert.match(text, /PUBLIC_CATALOG_ARTIST_ID/);
  assert.match(text, /NO_PUBLIC_ARTIST/);
  assert.match(
    text,
    /if \(resolvedArtistId === NO_PUBLIC_ARTIST\) \{\s*return emptyCatalogBundle\(\);/,
    "An artist-scoped schema with no public artist must fail closed instead of falling back to owner-wide reads",
  );
});
