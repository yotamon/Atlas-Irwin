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

type PublishedSiteRuntimeCore = Omit<PublishedSiteRuntime, "primaryHostname">;

async function loadPublishedSiteCoreByIdUncached(
  siteId: string,
): Promise<PublishedSiteRuntimeCore | null> {
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

async function loadPrimaryHostnameUncached(siteId: string): Promise<string | null> {
  const db = asSitesClient(createCatalogClient());
  const { data, error } = await db
    .from("artist_site_domains")
    .select("hostname")
    .eq("site_id", siteId)
    .eq("is_primary", true)
    .eq("verification_status", "verified")
    .eq("ssl_status", "active")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.hostname ?? null;
}

async function attachCurrentPrimaryHostname(
  runtime: PublishedSiteRuntimeCore | null,
): Promise<PublishedSiteRuntime | null> {
  if (!runtime) return null;
  return {
    ...runtime,
    primaryHostname: await loadPrimaryHostnameUncached(runtime.site.id),
  };
}

function loadPublishedSiteCoreById(siteId: string) {
  return unstable_cache(
    () => loadPublishedSiteCoreByIdUncached(siteId),
    ["ensemblis-site-id", siteId],
    { revalidate: 60, tags: [`site:${siteId}`] },
  )();
}

export async function loadPublishedSiteById(siteId: string) {
  const runtime = await loadPublishedSiteCoreById(siteId);
  return attachCurrentPrimaryHostname(runtime);
}

export async function loadPublishedSiteBySlug(slug: string) {
  const runtime = await unstable_cache(
    async () => {
      const db = asSitesClient(createCatalogClient());
      const { data, error } = await db
        .from("artist_sites")
        .select("id")
        .eq("slug", slug)
        .eq("state", "published")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? loadPublishedSiteCoreByIdUncached(data.id) : null;
    },
    ["ensemblis-site-slug", slug],
    { revalidate: 60, tags: [`site-slug:${slug}`] },
  )();

  return attachCurrentPrimaryHostname(runtime);
}

export async function loadPublishedSiteByHostname(hostname: string) {
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
