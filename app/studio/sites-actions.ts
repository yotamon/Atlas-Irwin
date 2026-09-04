"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { normalizeSiteSlug } from "@/lib/sites/domain";
import { asSitesClient } from "@/lib/sites/db";
import { buildArtistSiteSnapshot } from "@/lib/sites/snapshot";
import { getLatestSiteTemplate, getSiteTemplate } from "@/lib/sites/templates/registry";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import type { Json } from "@/types/database";

const uuid = z.string().uuid();

type PostgrestErrorLike = { code?: string | null; message?: string | null };

function revalidateSiteSurfaces(siteId: string, slug: string, hostnames: string[] = []) {
  updateTag(`site:${siteId}`);
  updateTag(`site-slug:${slug}`);
  for (const hostname of hostnames) updateTag(`site-host:${hostname}`);
  revalidatePath("/studio/sites");
  revalidatePath(`/sites/${slug}`);
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

  const domainsResult = await sites
    .from("artist_site_domains")
    .select("hostname")
    .eq("site_id", site.id);
  if (domainsResult.error) throw new Error(domainsResult.error.message);

  return {
    supabase,
    user,
    artist,
    sites,
    site,
    hostnames: (domainsResult.data ?? []).map((domain) => domain.hostname),
  };
}

async function createSiteRow(
  sites: ReturnType<typeof asSitesClient>,
  artistId: string,
  preferredSlug: string,
  templateKey: string,
) {
  const suffix = artistId.replace(/-/g, "").slice(0, 8);
  const candidates = [preferredSlug, `${preferredSlug}-${suffix}`];

  for (const slug of candidates) {
    const result = await sites
      .from("artist_sites")
      .insert({ artist_id: artistId, slug, template_key: templateKey, state: "draft" })
      .select("*")
      .single();
    if (!result.error) return result.data;
    const error = result.error as PostgrestErrorLike;
    if (error.code !== "23505") throw new Error(error.message || "Could not create artist site.");
  }

  throw new Error("Could not reserve a unique managed site slug for this artist.");
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
    revalidateSiteSurfaces(existing.data.id, existing.data.slug);
    return;
  }

  const template = getLatestSiteTemplate("editorial-retrofuture");
  const snapshot = await buildArtistSiteSnapshot(supabase, artist);
  const preferredSlug = normalizeSiteSlug(artist.artistSlug || artist.artistName);
  const site = await createSiteRow(sites, artist.artistId, preferredSlug, template.key);

  try {
    const versionResult = await sites
      .from("artist_site_versions")
      .insert({
        site_id: site.id,
        version_number: 1,
        status: "draft",
        template_key: template.key,
        template_version: template.version,
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
      .eq("id", site.id);
    if (pointerResult.error) throw new Error(pointerResult.error.message);

    const rootDomain = process.env.ENSEMBLIS_SITES_ROOT_DOMAIN?.trim().toLowerCase();
    if (rootDomain) {
      const domainResult = await sites.from("artist_site_domains").insert({
        site_id: site.id,
        hostname: `${site.slug}.${rootDomain}`,
        domain_type: "managed",
        verification_status: "pending",
        ssl_status: "pending",
        is_primary: false,
      });
      if (domainResult.error) throw new Error(domainResult.error.message);
    }
  } catch (error) {
    await sites.from("artist_sites").delete().eq("id", site.id);
    throw error;
  }

  revalidateSiteSurfaces(site.id, site.slug);
}

export async function refreshArtistSiteDraftAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const { supabase, artist, sites, site, hostnames } = await requireCurrentSite(siteId);

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

  revalidateSiteSurfaces(site.id, site.slug, hostnames);
}

export async function publishArtistSiteAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const { sites, site, hostnames } = await requireCurrentSite(siteId);
  if (!site.draft_version_id) throw new Error("Create or refresh a draft before publishing.");

  const result = await sites.rpc("publish_artist_site", {
    target_site_id: site.id,
    target_version_id: site.draft_version_id,
  });
  if (result.error) throw new Error(result.error.message);
  revalidateSiteSurfaces(site.id, site.slug, hostnames);
}

export async function rollbackArtistSiteAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const sourceVersionId = uuid.parse(formData.get("versionId"));
  const { sites, site, hostnames } = await requireCurrentSite(siteId);
  const result = await sites.rpc("rollback_artist_site", {
    target_site_id: site.id,
    source_version_id: sourceVersionId,
  });
  if (result.error) throw new Error(result.error.message);
  revalidateSiteSurfaces(site.id, site.slug, hostnames);
}

export async function resetDraftThemeAction(formData: FormData) {
  const siteId = uuid.parse(formData.get("siteId"));
  const { sites, site, hostnames } = await requireCurrentSite(siteId);
  if (!site.draft_version_id) throw new Error("No draft exists for this site.");

  const draftResult = await sites
    .from("artist_site_versions")
    .select("template_key,template_version")
    .eq("id", site.draft_version_id)
    .eq("site_id", site.id)
    .eq("status", "draft")
    .maybeSingle();
  if (draftResult.error) throw new Error(draftResult.error.message);
  if (!draftResult.data) throw new Error("Draft version not found.");

  const template = getSiteTemplate(
    draftResult.data.template_key,
    draftResult.data.template_version,
  );
  const result = await sites
    .from("artist_site_versions")
    .update({ config: template.defaults as unknown as Json })
    .eq("id", site.draft_version_id)
    .eq("site_id", site.id)
    .eq("status", "draft");
  if (result.error) throw new Error(result.error.message);
  revalidateSiteSurfaces(site.id, site.slug, hostnames);
}
