import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { AutoMixDatabase, AutoMixJob } from "@/types/automix-database";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mixRoot(job: AutoMixJob) {
  const lineage = asRecord(asRecord(job.request_payload).plan_lineage);
  return typeof lineage.root_job_id === "string" ? lineage.root_job_id : job.id;
}

function mixSource(job: AutoMixJob) {
  return asRecord(job.request_payload).execution_target === "device" ? "local" : "catalog";
}

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
  const automix = supabase as unknown as SupabaseClient<AutoMixDatabase>;
  const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

  const [releaseResult, trackResult, campaignResult, contentResult, mixResult] = await Promise.all([
    music.from("releases").select("id,title,status,release_type,release_date")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("title", pattern).limit(5),
    growth.from("track_vault").select("id,title,status,version,linked_release_id")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("title", pattern).neq("status", "archived").limit(5),
    marketing.from("campaigns").select("id,name,status,objective")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("name", pattern).neq("status", "archived").limit(5),
    marketing.from("content_items").select("id,title,status,platform")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("title", pattern).neq("status", "Archived").limit(5),
    automix.from("automix_jobs").select("*")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).ilike("name", pattern).order("updated_at", { ascending: false }).limit(10),
  ]);
  const firstError = [releaseResult, trackResult, campaignResult, contentResult, mixResult].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const seenMixRoots = new Set<string>();
  const mixes = (mixResult.data ?? []).filter((job) => {
    const root = mixRoot(job);
    if (seenMixRoots.has(root)) return false;
    seenMixRoots.add(root);
    return true;
  });

  const results = [
    ...(trackResult.data ?? []).map((track) => ({
      id: `track:${track.id}`,
      type: "Track",
      label: track.title,
      detail: `${track.status.replaceAll("_", " ")}${track.version ? ` · ${track.version}` : ""}`,
      href: href(`/studio/music/${track.id}`),
    })),
    ...mixes.map((mix) => ({
      id: `mix:${mixRoot(mix)}`,
      type: "Mix",
      label: mix.name,
      detail: `${mix.track_ids.length} tracks · ${mix.status === "completed" ? "ready" : mix.status}`,
      href: href(`/studio/music/automix?mix=${encodeURIComponent(mixRoot(mix))}&source=${mixSource(mix)}`),
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
