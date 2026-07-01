import { notFound } from "next/navigation";
import { createMediaPreviewMap } from "@/lib/studio/media-previews";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { getPublicReleases } from "@/lib/public-catalog";
import { ReleaseCockpit } from "@/components/studio/release-cockpit";

export default async function ReleaseDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const { supabase } = await requireStudioAdmin();
  const [
    { data: release },
    { data: tracks },
    { data: placement },
    { data: mediaLinks },
    { count: contentCount },
    { count: contactCount },
    { data: externalLinks },
    { data: contentItems },
    { data: metrics },
    { data: soundCloudPending },
    { data: spotifyPending },
  ] = await Promise.all([
    supabase.from("releases").select("*").eq("id", id).single(),
    supabase
      .from("tracks")
      .select("*")
      .eq("release_id", id)
      .order("display_order")
      .order("is_primary", { ascending: false }),
    supabase
      .from("homepage_placements")
      .select("*")
      .eq("release_id", id)
      .maybeSingle(),
    supabase.from("media_links").select("*").eq("release_id", id),
    supabase
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("release_id", id),
    supabase
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("release_id", id),
    supabase.from("release_external_links").select("*").eq("release_id", id),
    supabase.from("content_items").select("*").eq("release_id", id).order("scheduled_at"),
    supabase.from("metric_snapshots").select("*").eq("release_id", id).order("date"),
    supabase.from("soundcloud_tracks").select("*").eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("*").eq("reconcile_status", "pending"),
  ]);
  if (!release) notFound();

  const trackIds = (tracks ?? []).map((track) => track.id);
  const { data: externalTrackIds } = trackIds.length
    ? await supabase.from("track_external_ids").select("*").in("track_id", trackIds)
    : { data: [] };
  const assetIds = [...new Set((mediaLinks ?? []).map((link) => link.media_asset_id))];
  const { data: mediaAssets } = assetIds.length
    ? await supabase.from("media_assets").select("*").in("id", assetIds)
    : { data: [] };
  const mediaPreviewUrls = await createMediaPreviewMap(supabase, mediaAssets ?? []);

  const releaseTerms = new Set([release.title, ...(tracks ?? []).map((track) => track.title)].map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const relevantSoundCloud = (soundCloudPending ?? []).filter((item) => releaseTerms.has(item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const relevantSpotify = (spotifyPending ?? []).filter((item) => releaseTerms.has(item.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const publicReleases = await getPublicReleases();

  return (
      <ReleaseCockpit
        release={release}
        tracks={tracks ?? []}
        placement={placement}
        mediaLinks={mediaLinks ?? []}
        mediaAssets={mediaAssets ?? []}
        mediaPreviewUrls={mediaPreviewUrls}
        externalLinks={externalLinks ?? []}
        externalTrackIds={externalTrackIds ?? []}
        contentCount={contentCount ?? 0}
        contactCount={contactCount ?? 0}
        contentItems={contentItems ?? []}
        metrics={metrics ?? []}
        unmatchedSoundCloud={relevantSoundCloud}
        unmatchedSpotify={relevantSpotify}
        publicReleases={publicReleases}
        tab={tab}
      />
  );
}
