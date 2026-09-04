import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const artistId = url.searchParams.get("artist")?.trim() ?? "";
  if (!artistId || query.length < 2) return NextResponse.json({ results: [] });

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const music = asArtistScopedMusicClient(supabase);
  const growth = asGrowthClient(supabase);
  const marketing = asMarketingClient(supabase);
  const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

  const [releaseResult, trackResult, campaignResult, contentResult] = await Promise.all([
    music.from("releases").select("id,title,status,release_type,release_date")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("title", pattern).limit(5),
    growth.from("track_vault").select("id,title,status,version,linked_release_id")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("title", pattern).neq("status", "archived").limit(5),
    marketing.from("campaigns").select("id,name,status,objective")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("name", pattern).neq("status", "archived").limit(5),
    marketing.from("content_items").select("id,title,status,platform")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("title", pattern).neq("status", "Archived").limit(5),
  ]);
  const firstError = [releaseResult, trackResult, campaignResult, contentResult].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const results = [
    ...(trackResult.data ?? []).map((track) => ({
      id: `track:${track.id}`,
      type: "Track",
      label: track.title,
      detail: `${track.status.replaceAll("_", " ")}${track.version ? ` · ${track.version}` : ""}`,
      href: href(`/studio/music/${track.id}`),
    })),
    ...(releaseResult.data ?? []).map((release) => ({
      id: `release:${release.id}`,
      type: "Release",
      label: release.title,
      detail: `${release.release_type} · ${release.status}`,
      href: href(`/studio/releases/${release.id}`),
    })),
    ...(campaignResult.data ?? []).map((campaign) => ({
      id: `campaign:${campaign.id}`,
      type: "Campaign",
      label: campaign.name,
      detail: `${campaign.status} · ${campaign.objective}`,
      href: href(`/studio/campaigns/${campaign.id}`),
    })),
    ...(contentResult.data ?? []).map((content) => ({
      id: `content:${content.id}`,
      type: "Content",
      label: content.title,
      detail: `${content.platform} · ${content.status}`,
      href: href(`/studio/production?edit=${content.id}`),
    })),
  ].slice(0, 12);

  return NextResponse.json({ results });
}
