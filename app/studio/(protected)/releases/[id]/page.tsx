import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ReleaseCockpit } from "@/components/studio/release-cockpit";
import { PageHeader, Status } from "@/components/studio/ui";
import { publishStateLabel } from "@/lib/studio/catalog-labels";

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

  return (
    <>
      <PageHeader
        title={release.title}
        description={`${release.release_type} · ${publishStateLabel(release.publish_state)}`}
        action={<Status>{release.status}</Status>}
      />
      <ReleaseCockpit
        release={release}
        tracks={tracks ?? []}
        placement={placement}
        mediaLinks={mediaLinks ?? []}
        mediaAssets={mediaAssets ?? []}
        externalLinks={externalLinks ?? []}
        externalTrackIds={externalTrackIds ?? []}
        contentCount={contentCount ?? 0}
        contactCount={contactCount ?? 0}
        tab={tab}
      />
    </>
  );
}
