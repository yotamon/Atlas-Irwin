import "server-only";

import { unstable_cache } from "next/cache";
import { parseSiteConfig, parseSiteViewModel } from "@/lib/sites/domain";
import { asSitesClient } from "@/lib/sites/db";
import { createCatalogClient } from "@/lib/supabase/service";
import type { ArtistSite, ArtistSiteVersion } from "@/types/ensemblis-sites";

export type PublishedSiteRuntime = {
  site: ArtistSite;
  version: ArtistSiteVersion;
  config: ReturnType<typeof parseSiteConfig>;
  viewModel: ReturnType<typeof parseSiteViewModel>;
};

async function loadPublishedSiteById(siteId: string): Promise<PublishedSiteRuntime | null> {
  const db = asSitesClient(createCatalogClient());
  const { data: site, error: siteError } = await db
    .from("artist_sites")
    .select("*")
    .eq("id", siteId)
    .eq("state", "published")
    .maybeSingle();

  if (siteError) throw new Error(siteError.message);
  if (!site?.published_version_id) return null;

  const { data: version, error: versionError } = await db
    .from("artist_site_versions")
    .select("*")
    .eq("id", site.published_version_id)
    .eq("site_id", site.id)
    .eq("status", "published")
    .maybeSingle();

  if (versionError) throw new Error(versionError.message);
  if (!version) return null;

  return {
    site,
    version,
    config: parseSiteConfig(version.config),
    viewModel: parseSiteViewModel(version.content_snapshot),
  };
}

async function loadPublishedSiteBySlugUncached(slug: string) {
  const db = asSitesClient(createCatalogClient());
  const { data, error } = await db
    .from("artist_sites")
    .select("id")
    .eq("slug", slug)
    .eq("state", "published")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? loadPublishedSiteById(data.id) : null;
}

async function loadPublishedSiteByHostnameUncached(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  const db = asSitesClient(createCatalogClient());
  const { data: domain, error } = await db
    .from("artist_site_domains")
    .select("site_id")
    .eq("hostname", normalized)
    .eq("verification_status", "verified")
    .eq("ssl_status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return domain ? loadPublishedSiteById(domain.site_id) : null;
}

export const loadPublishedSiteBySlug = unstable_cache(
  loadPublishedSiteBySlugUncached,
  ["ensemblis-site-by-slug"],
  { revalidate: 60, tags: ["ensemblis-sites"] },
);

export const loadPublishedSiteByHostname = unstable_cache(
  loadPublishedSiteByHostnameUncached,
  ["ensemblis-site-by-hostname"],
  { revalidate: 60, tags: ["ensemblis-sites"] },
);
