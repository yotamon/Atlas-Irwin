"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { DEFAULT_SITE_CONFIG, normalizeSiteSlug } from "@/lib/sites/domain";
import { asSitesClient } from "@/lib/sites/db";
import { buildArtistSiteSnapshot } from "@/lib/sites/snapshot";
import { getSiteTemplate } from "@/lib/sites/templates/registry";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import type { Json } from "@/types/database";

const uuid = z.string().uuid();

function revalidateSiteSurfaces(slug?: string) {
  updateTag("ensemblis-sites");
  revalidatePath("/studio/sites");
  if (slug) revalidatePath(`/sites/${slug}`);
}

async function requireCurrentSite(siteId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const sites = asSitesClient(supabase);
  const { data: site, error } = await sites
    .from("artist_sites")
    .select("*")
    .eq("id", siteId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!site) throw new Error("Site not found for the active artist.");
  return { supabase, user, artist, sites, site };
}

export async function createArtistSiteAction() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const sites = asSitesClient(supabase);
  const existing = await sites
    .from("artist_sites")
    .select("id,slug")
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    revalidateSiteSurfaces(existing.data.slug);
    return;
  }

  const template = getSiteTemplate("artist-editorial-v1");
  const snapshot = await buildArtistSiteSnapshot(supabase, artist);
  const slug = normalizeSiteSlug(artist.artistSlug || artist.artistName);
  const siteResult = await sites
    .from("artist_sites")
    .insert({
      artist_id: artist.artistId,
      slug,
      template_key: template.key,
      state: "draft",
    })
    .select("*")
    .single();
  if (siteResult.error) throw new Error(siteResult.error.message);

  try {
    const versionResult = await sites
      .from("artist_site_versions")
      .insert({
        site_id: siteResult.data.id,
        version_number: 1,
        status: "draft",
        config: template.defaults as unknown as Json,
        content_snapshot: snapshot as unknown as Json,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (versionResult.error) throw new Error(versionResult.error.message);

    const pointerResult = await sites
      .from("artist_sites")
      .update({ draft_version_id: versionResult.data.id })
      .eq("id", siteResult.data.id);
    if (pointerResult.error) throw new Error(pointerResult.error.message);

    const rootDomain = process.env.ENSEMBLIS_SITES_ROOT_DOMAIN?.trim().toLowerCase();
    if (rootDomain) {
      const domainResult = await sites.from("artist_site_domains").insert({
        site_id: siteResult.data.id,
        hostname: `${slug}.${rootDomain}`,
        domain_type: "managed",
        verification_status: "verified",
        ssl_status: "active",
        is_primary: true,
        last_verified_at: new Date().toISOString(),
      });
      if (domainResult.error) throw new Error(domainResult.error.message);
    }
  } catch (error) {
    await sites.from("artist_sites").delete().eq("id", siteResult.data.id);
    throw error;
  }

  revalidateSiteSurfaces(slug);
}

export async function refreshArtistSiteDraftAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const { supabase, artist, sites, site } = await requireCurrentSite(siteId);

  let draftVersionId = site.draft_version_id;
  if (!draftVersionId) {
    const draftResult = await sites.rpc("create_artist_site_draft", { target_site_id: site.id });
    if (draftResult.error) throw new Error(draftResult.error.message);
    draftVersionId = draftResult.data;
  }

  const snapshot = await buildArtistSiteSnapshot(supabase, artist);
  const updateResult = await sites
    .from("artist_site_versions")
    .update({ content_snapshot: snapshot as unknown as Json })
    .eq("id", draftVersionId)
    .eq("site_id", site.id)
    .eq("status", "draft");
  if (updateResult.error) throw new Error(updateResult.error.message);

  revalidateSiteSurfaces(site.slug);
}

export async function publishArtistSiteAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const { sites, site } = await requireCurrentSite(siteId);
  if (!site.draft_version_id) throw new Error("Create or refresh a draft before publishing.");

  const result = await sites.rpc("publish_artist_site", {
    target_site_id: site.id,
    target_version_id: site.draft_version_id,
  });
  if (result.error) throw new Error(result.error.message);
  revalidateSiteSurfaces(site.slug);
}

export async function rollbackArtistSiteAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const sourceVersionId = uuid.parse(formData.get("versionId"));
  const { sites, site } = await requireCurrentSite(siteId);
  const result = await sites.rpc("rollback_artist_site", {
    target_site_id: site.id,
    source_version_id: sourceVersionId,
  });
  if (result.error) throw new Error(result.error.message);
  revalidateSiteSurfaces(site.slug);
}

export async function resetDraftThemeAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const { sites, site } = await requireCurrentSite(siteId);
  if (!site.draft_version_id) throw new Error("No draft exists for this site.");
  const result = await sites
    .from("artist_site_versions")
    .update({ config: DEFAULT_SITE_CONFIG as unknown as Json })
    .eq("id", site.draft_version_id)
    .eq("site_id", site.id)
    .eq("status", "draft");
  if (result.error) throw new Error(result.error.message);
  revalidateSiteSurfaces(site.slug);
}
