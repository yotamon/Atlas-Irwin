import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import { asSitesClient } from "@/lib/sites/db";
import { asSmartLinksClient, createSmartLinksServiceClient } from "@/lib/smart-links/db";
import { createCatalogClient } from "@/lib/supabase/service";

export async function publicationSmartLinkUrl(contentItemId: string, ownerId: string, artistId: string) {
  const smart = createSmartLinksServiceClient();
  const { data: source, error: sourceError } = await smart.from("smart_link_sources")
    .select("smart_link_id,code")
    .eq("content_item_id", contentItemId)
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!source) return null;

  const { data: link, error: linkError } = await smart.from("smart_links")
    .select("id,site_id,slug,is_active")
    .eq("id", source.smart_link_id)
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("is_active", true)
    .maybeSingle();
  if (linkError) throw new Error(linkError.message);
  if (!link) return null;

  const catalog = createCatalogClient();
  const sites = asSitesClient(catalog);
  const [{ data: site, error: siteError }, { data: domain, error: domainError }] = await Promise.all([
    sites.from("artist_sites").select("id,slug,state").eq("id", link.site_id).eq("artist_id", artistId).maybeSingle(),
    sites.from("artist_site_domains").select("hostname,verification_status,ssl_status,is_primary")
      .eq("site_id", link.site_id)
      .eq("is_primary", true)
      .maybeSingle(),
  ]);
  if (siteError) throw new Error(siteError.message);
  if (domainError) throw new Error(domainError.message);
  if (!site || site.state !== "published") return null;

  const base = domain?.verification_status === "verified" && domain.ssl_status === "active"
    ? `https://${domain.hostname}`
    : `${getSiteUrl()}/sites/${site.slug}`;
  const url = new URL(`${base}/release/${link.slug}`);
  url.searchParams.set("src", source.code);
  return url.toString();
}
