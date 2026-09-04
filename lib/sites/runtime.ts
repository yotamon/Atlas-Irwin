import "server-only";

import { unstable_cache } from "next/cache";
import { parseSiteConfig, parseSiteViewModel } from "@/lib/sites/domain";
import { asSitesClient } from "@/lib/sites/db";
import { createCatalogClient } from "@/lib/supabase/service";
import type { ArtistSite, ArtistSiteVersion } from "@/types/ensemblis-sites";

export type PublishedSiteRuntime = {
  site: ArtistSite;
  version: ArtistSiteVersion;
  primaryHostname: string | null;
  config: ReturnType<typeof parseSiteConfig>;
  viewModel: ReturnType<typeof parseSiteViewModel>;
};

async function loadPublishedSiteByIdUncached(siteId: string): Promise<PublishedSiteRuntime | null> {
  const db = asSitesClient(createCatalogClient());
  const { data: site, error: siteError } = await db
    .from("artist_sites")
    .select("*")
    .eq("id", siteId)
    .eq("state", "published")
    .maybeSingle();

  if (siteError) throw new Error(siteError.message);
  if (!site?.published_version_id) return null;

  const [versionResult, domainResult] = await Promise.all([
    db
      .from("artist_site_versions")
      .select("*")
      .eq("id", site.published_version_id)
      .eq("site_id", site.id)
      .eq("status", "published")
      .maybeSingle(),
    db
      .from("artist_site_domains")
      .select("hostname")
      .eq("site_id", site.id)
      .eq("is_primary", true)
      .eq("verification_status", "verified")
      .eq("ssl_status", "active")
      .maybeSingle(),
  ]);

  if (versionResult.error) throw new Error(versionResult.error.message);
  if (domainResult.error) throw new Error(domainResult.error.message);
  if (!versionResult.data) return null;

  return {
    site,
    version: versionResult.data,
    primaryHostname: domainResult.data?.hostname ?? null,
    config: parseSiteConfig(versionResult.data.config),
    viewModel: parseSiteViewModel(versionResult.data.content_snapshot),
  };
}

export function loadPublishedSiteById(siteId: string) {
  return unstable_cache(
    () => loadPublishedSiteByIdUncached(siteId),
    ["ensemblis-site-id", siteId],
    { revalidate: 60, tags: [`site:${siteId}`] },
  )();
}

export function loadPublishedSiteBySlug(slug: string) {
  return unstable_cache(
    async () => {
      const db = asSitesClient(createCatalogClient());
      const { data, error } = await db
        .from("artist_sites")
        .select("id")
        .eq("slug", slug)
        .eq("state", "published")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? loadPublishedSiteByIdUncached(data.id) : null;
    },
    ["ensemblis-site-slug", slug],
    { revalidate: 60, tags: [`site-slug:${slug}`] },
  )();
}

export function loadPublishedSiteByHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  return unstable_cache(
    async () => {
      const db = asSitesClient(createCatalogClient());
      const { data: domain, error } = await db
        .from("artist_site_domains")
        .select("site_id")
        .eq("hostname", normalized)
        .eq("verification_status", "verified")
        .eq("ssl_status", "active")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return domain ? loadPublishedSiteByIdUncached(domain.site_id) : null;
    },
    ["ensemblis-site-host", normalized],
    { revalidate: 60, tags: [`site-host:${normalized}`] },
  )();
}
