import "server-only";

import { asSitesClient } from "@/lib/sites/db";
import { normalizeSiteHostname } from "@/lib/sites/domain-provider";
import { createCatalogClient } from "@/lib/supabase/service";

export type ResolvedSiteHost = {
  hostname: string;
  siteId: string;
  artistId: string;
  siteSlug: string;
  isPrimary: boolean;
};

export interface SiteHostResolver {
  resolve(hostname: string): Promise<ResolvedSiteHost | null>;
}

export class DatabaseSiteHostResolver implements SiteHostResolver {
  async resolve(input: string): Promise<ResolvedSiteHost | null> {
    const hostname = normalizeSiteHostname(input);
    const db = asSitesClient(createCatalogClient());
    const { data: domain, error: domainError } = await db
      .from("artist_site_domains")
      .select("site_id,is_primary")
      .eq("hostname", hostname)
      .eq("verification_status", "verified")
      .eq("ssl_status", "active")
      .maybeSingle();

    if (domainError) throw new Error(domainError.message);
    if (!domain) return null;

    const { data: site, error: siteError } = await db
      .from("artist_sites")
      .select("id,artist_id,slug,state,published_version_id")
      .eq("id", domain.site_id)
      .eq("state", "published")
      .maybeSingle();

    if (siteError) throw new Error(siteError.message);
    if (!site?.published_version_id) return null;

    return {
      hostname,
      siteId: site.id,
      artistId: site.artist_id,
      siteSlug: site.slug,
      isPrimary: domain.is_primary,
    };
  }
}
