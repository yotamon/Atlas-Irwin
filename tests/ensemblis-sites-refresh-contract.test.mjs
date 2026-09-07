import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("site catalog refresh preserves editorial fields without pinning stale release data", async () => {
  const snapshot = await source("lib/sites/snapshot.ts");

  for (const snippet of [
    "loadPreviousSiteSnapshot",
    "draft_version_id ?? siteResult.data.published_version_id",
    "mergeArtistSiteSnapshotRefresh",
    "bio: prior.artist.bio ?? fresh.artist.bio",
    "socialLinks: prior.socialLinks.length ? prior.socialLinks : fresh.socialLinks",
    "contact: prior.contact.email ? prior.contact : fresh.contact",
    "title: prior.seo.title",
    "description: prior.seo.description",
    "...fresh.seo",
    "return mergeArtistSiteSnapshotRefresh(fresh, previousSnapshot)",
  ]) {
    assert.ok(snapshot.includes(snippet), `site refresh contract missing: ${snippet}`);
  }

  assert.ok(
    snapshot.indexOf("...fresh.seo") < snapshot.indexOf("title: prior.seo.title"),
    "fresh SEO image data should survive while editorial title/description remain stable",
  );
  assert.ok(
    snapshot.indexOf("const fresh: SiteViewModel") < snapshot.indexOf("return mergeArtistSiteSnapshotRefresh"),
    "catalog-derived releases must be rebuilt before editorial fields are restored",
  );
});
