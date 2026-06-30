import Link from "next/link";
import { dismissSoundCloudTrack } from "@/app/studio/catalog-actions";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";

type HealthItem = {
  category: string;
  identity: string;
  source: string;
  syncedAt: string | null;
  status: string;
  reason: string;
  href: string;
  externalId?: string;
};

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function age(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const categories = [
  ["all", "All issues"], ["unmatched", "Unmatched tracks"], ["duplicates", "Duplicate candidates"],
  ["links", "Missing links"], ["media", "Public media"], ["preview", "Preview audio"],
  ["website", "Website gaps"], ["homepage", "Homepage validity"], ["legacy", "Legacy review"],
  ["stale", "Stale sync"], ["metadata", "Metadata"],
] as const;

export default async function DataHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category = "all" } = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const [releasesResult, tracksResult, assetsResult, linksResult, placementsResult, releaseLinksResult, soundCloudResult, spotifyResult, albumsResult] = await Promise.all([
    supabase.from("releases").select("*").eq("owner_id", user.id),
    supabase.from("tracks").select("*").eq("owner_id", user.id),
    supabase.from("media_assets").select("*").eq("owner_id", user.id),
    supabase.from("media_links").select("*").eq("owner_id", user.id),
    supabase.from("homepage_placements").select("*").eq("owner_id", user.id),
    supabase.from("release_external_links").select("*").eq("owner_id", user.id),
    supabase.from("soundcloud_tracks").select("*").eq("owner_id", user.id),
    supabase.from("spotify_tracks").select("*").eq("owner_id", user.id),
    supabase.from("spotify_albums").select("*").eq("owner_id", user.id),
  ]);
  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const assets = assetsResult.data ?? [];
  const mediaLinks = linksResult.data ?? [];
  const placements = placementsResult.data ?? [];
  const releaseLinks = releaseLinksResult.data ?? [];
  const soundCloud = soundCloudResult.data ?? [];
  const spotify = spotifyResult.data ?? [];
  const albums = albumsResult.data ?? [];
  const items: HealthItem[] = [];

  soundCloud.filter((track) => track.reconcile_status === "pending" && !track.linked_track_id).forEach((track) => items.push({
    category: "unmatched", identity: track.title, source: "SoundCloud", syncedAt: track.synced_at, status: "Needs decision",
    reason: "No canonical track is linked. Suggestions use title and duration similarity.", href: `/studio/soundcloud?focus=${track.id}`, externalId: track.id,
  }));
  spotify.filter((track) => track.reconcile_status === "pending" && !track.linked_track_id).forEach((track) => items.push({
    category: "unmatched", identity: track.name, source: "Spotify", syncedAt: track.synced_at, status: "Needs decision",
    reason: track.isrc ? `ISRC ${track.isrc} is available for an auditable match.` : "No canonical track or exact ISRC match is linked.", href: `/studio/spotify?focus=${track.id}`,
  }));

  const duplicateGroups = new Map<string, typeof tracks>();
  tracks.forEach((track) => duplicateGroups.set(normalized(track.title), [...(duplicateGroups.get(normalized(track.title)) ?? []), track]));
  duplicateGroups.forEach((matches) => {
    if (matches.length < 2) return;
    matches.forEach((track) => items.push({ category: "duplicates", identity: track.title, source: "Catalog", syncedAt: track.updated_at, status: "Review", reason: `${matches.length} catalog tracks share the same normalized title. Confirm versions before merging.`, href: `/studio/releases/${track.release_id}?tab=music#tracklist` }));
  });

  releases.forEach((release) => {
    const releaseTracks = tracks.filter((track) => track.release_id === release.id);
    const attached = mediaLinks.filter((link) => link.release_id === release.id);
    const attachedAssets = assets.filter((asset) => attached.some((link) => link.media_asset_id === asset.id));
    const platformLinks = releaseLinks.filter((link) => link.release_id === release.id);
    if (!(release.spotify_url || release.soundcloud_url || release.youtube_url || release.smart_link_url || platformLinks.length)) items.push({ category: "links", identity: release.title, source: "Catalog", syncedAt: release.updated_at, status: "Missing", reason: "No reviewed release-level listening destination exists.", href: `/studio/releases/${release.id}?tab=music#platform-links` });
    if (release.publish_state === "live" && !(release.artwork_url || attachedAssets.some((asset) => asset.asset_type === "cover" && asset.visibility === "public"))) items.push({ category: "media", identity: release.title, source: "Public website", syncedAt: release.updated_at, status: "Blocking", reason: "Live release has no intentional public cover asset.", href: `/studio/releases/${release.id}?tab=media#upload` });
    if (!releaseTracks.some((track) => track.audio_url || track.soundcloud_url || track.spotify_url)) items.push({ category: "preview", identity: release.title, source: "Catalog", syncedAt: release.updated_at, status: "Missing", reason: "No track has preview audio or an external playable URL.", href: `/studio/releases/${release.id}?tab=music#tracklist` });
    const matchingAlbum = albums.find((album) => normalized(album.name) === normalized(release.title));
    if (matchingAlbum && release.publish_state !== "live") items.push({ category: "website", identity: release.title, source: "Spotify", syncedAt: matchingAlbum.synced_at, status: "Platform live / website hidden", reason: "A synced Spotify release matches this draft catalog record.", href: `/studio/releases/${release.id}?tab=website#publishing` });
    if (release.public_release_path && !release.notes?.toLowerCase().includes("reviewed")) items.push({ category: "legacy", identity: release.title, source: "Legacy import", syncedAt: release.updated_at, status: "Review", reason: `Imported from ${release.public_release_path}; verify media and platform links.`, href: `/studio/releases/${release.id}` });
    const missing = [["UPC", release.upc], ["release date", release.release_date], ["label", release.label], ["artwork alt text", release.cover_alt]].filter(([, value]) => !value).map(([label]) => label);
    if (missing.length) items.push({ category: "metadata", identity: release.title, source: "Catalog", syncedAt: release.updated_at, status: "Incomplete", reason: `Missing ${missing.join(", ")}.`, href: `/studio/releases/${release.id}?tab=overview#identity` });
  });

  placements.filter((placement) => placement.enabled && (!placement.default_track_id || !tracks.some((track) => track.id === placement.default_track_id && track.release_id === placement.release_id))).forEach((placement) => items.push({ category: "homepage", identity: releases.find((release) => release.id === placement.release_id)?.title ?? "Unknown release", source: "Homepage", syncedAt: placement.updated_at, status: "Invalid", reason: "The enabled placement has no valid default track from this release.", href: `/studio/releases/${placement.release_id}?tab=website#placement` }));

  const staleBefore = new Date().getTime() - 1000 * 60 * 60 * 24 * 14;
  [...soundCloud.map((item) => ({ name: item.title, source: "SoundCloud", date: item.synced_at, href: "/studio/soundcloud" })), ...spotify.map((item) => ({ name: item.name, source: "Spotify", date: item.synced_at, href: "/studio/spotify" }))]
    .filter((item) => Date.parse(item.date) < staleBefore)
    .forEach((item) => items.push({ category: "stale", identity: item.name, source: item.source, syncedAt: item.date, status: "Stale", reason: "Last sync is more than 14 days old.", href: item.href }));

  const visible = category === "all" ? items : items.filter((item) => item.category === category);
  const counts = new Map(categories.map(([key]) => [key, key === "all" ? items.length : items.filter((item) => item.category === key).length]));

  return (
    <>
      <PageHeader title="Data Health" description="Auditable catalog issues, ordered by their effect on publishing and playback." action={<div className="actions"><Link className="button" href="/studio/soundcloud">SoundCloud sync</Link><Link className="button" href="/studio/spotify">Spotify sync</Link></div>} />
      <nav className="health-filters" aria-label="Data health categories">
        {categories.map(([key, label]) => <Link className={category === key ? "active" : undefined} href={key === "all" ? "/studio/data-health" : `/studio/data-health?category=${key}`} key={key}>{label}<span>{counts.get(key)}</span></Link>)}
      </nav>
      <section className="data-health-table" aria-label="Catalog health issues">
        <div className="health-row health-head"><span>Release or track</span><span>Source / sync</span><span>Why it is here</span><span>Action</span></div>
        {visible.length ? visible.map((item, index) => (
          <article className="health-row" key={`${item.category}-${item.identity}-${index}`}>
            <div><strong>{item.identity}</strong><Status>{item.status}</Status></div>
            <div><span>{item.source}</span><small>{age(item.syncedAt)}</small></div>
            <p>{item.reason}</p>
            <div className="health-actions"><Link className="button" href={item.href}>Review</Link>{item.source === "SoundCloud" && item.externalId ? <form action={dismissSoundCloudTrack}><input type="hidden" name="id" value={item.externalId} /><button className="text-button">Dismiss</button></form> : null}</div>
          </article>
        )) : <div className="empty-state"><h3>No issues in this view</h3><p>The current catalog passes these checks.</p></div>}
      </section>
    </>
  );
}
