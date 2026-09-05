import "server-only";

import { asSmartLinksClient } from "@/lib/smart-links/db";
import { createCatalogClient } from "@/lib/supabase/service";
import type { Release } from "@/types/database";
import type { SmartLink, SmartLinkDestination } from "@/types/smart-links-database";

export type SmartLinkRuntime = {
  link: SmartLink;
  release: Pick<Release, "id" | "title" | "release_date" | "artwork_url" | "cover_alt" | "artist_display_name" | "primary_artist_name">;
  mode: "pre_release" | "live";
  destinations: SmartLinkDestination[];
};

function berlinDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function loadSmartLinkRuntime(siteId: string, slug: string): Promise<SmartLinkRuntime | null> {
  const catalog = createCatalogClient();
  const smart = asSmartLinksClient(catalog);
  const { data: link, error: linkError } = await smart
    .from("smart_links")
    .select("*")
    .eq("site_id", siteId)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (linkError) throw new Error(linkError.message);
  if (!link) return null;

  const [{ data: release, error: releaseError }, { data: destinations, error: destinationError }] = await Promise.all([
    catalog
      .from("releases")
      .select("id,title,release_date,artwork_url,cover_alt,artist_display_name,primary_artist_name")
      .eq("id", link.release_id)
      .eq("artist_id", link.artist_id)
      .maybeSingle(),
    smart
      .from("smart_link_destinations")
      .select("*")
      .eq("smart_link_id", link.id)
      .eq("artist_id", link.artist_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);
  if (releaseError) throw new Error(releaseError.message);
  if (destinationError) throw new Error(destinationError.message);
  if (!release) return null;

  const preRelease = Boolean(release.release_date && release.release_date > berlinDate());
  const rows = destinations ?? [];
  const preferred = preRelease
    ? rows.filter((destination) => destination.destination_kind === "pre_save")
    : rows.filter((destination) => destination.destination_kind === "streaming");
  const fallbacks = rows.filter((destination) => destination.destination_kind === "fallback");

  return {
    link,
    release,
    mode: preRelease ? "pre_release" : "live",
    destinations: preferred.length ? [...preferred, ...fallbacks] : fallbacks.length ? fallbacks : rows,
  };
}
